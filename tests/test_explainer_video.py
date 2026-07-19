import shutil
import subprocess
from pathlib import Path

import pytest

from api.podcast_service import PodcastGenerationRequest
from commands.podcast_commands import get_audio_duration_seconds
from forgenote.podcasts.robust_creator import (
    _build_transcript_repair_prompt,
    create_visual_transcript_parser,
)
from forgenote.podcasts.video_creator import (
    build_keyframe_plan,
    build_subtitle_cues,
    compose_explainer_video,
    generate_keyframe_images,
    write_srt_subtitles,
)


def test_visual_transcript_parser_keeps_script_and_optional_image_prompts():
    parser = create_visual_transcript_parser(["讲师"])
    result = parser.invoke(
        """
        {
          "transcript": [
            {
              "speaker": "讲师",
              "dialogue": "先看整体结构。",
              "visual_prompt": "16:9 overview diagram of the learning loop"
            },
            {
              "speaker": "讲师",
              "dialogue": "接着解释第一步。",
              "visual_prompt": null
            }
          ]
        }
        """
    )

    assert result.transcript[0].dialogue == "先看整体结构。"
    assert (
        result.transcript[0].visual_prompt
        == "16:9 overview diagram of the learning loop"
    )
    assert result.transcript[1].visual_prompt is None


def test_transcript_repair_contract_preserves_visual_prompt_field():
    prompt = _build_transcript_repair_prompt(
        original_prompt="Generate the segment",
        invalid_output="{}",
        speaker_names=["A", "B"],
    )

    assert '"visual_prompt"' in prompt
    assert "16:9 educational image prompt" in prompt


def test_keyframe_plan_uses_real_turn_timestamps_and_limits_visual_churn():
    transcript = [
        {
            "start_time": 1.2,
            "dialogue": "开场",
            "visual_prompt": "course overview",
        },
        {
            "start_time": 2.0,
            "dialogue": "相邻台词",
            "visual_prompt": "too close to the previous cue",
        },
        {
            "start_time": 8.75,
            "dialogue": "新概念",
            "visual_prompt": "process diagram",
        },
        {
            "start_time": 16.0,
            "dialogue": "重复画面",
            "visual_prompt": "process diagram",
        },
    ]

    plan = build_keyframe_plan(transcript)

    assert [cue["time_index"] for cue in plan] == [0.0, 8.75]
    assert [cue["turn_index"] for cue in plan] == [0, 2]
    assert [cue["index"] for cue in plan] == [1, 2]


def test_keyframe_plan_has_source_text_fallback_when_model_returns_no_cue():
    plan = build_keyframe_plan(
        [{"start_time": 0, "dialogue": "解释半监督学习中的一致性约束。"}],
        episode_name="半监督学习",
    )

    assert len(plan) == 1
    assert plan[0]["time_index"] == 0.0
    assert "一致性约束" in plan[0]["prompt"]


def test_srt_subtitles_use_real_dialogue_timestamps(tmp_path):
    subtitle_path = write_srt_subtitles(
        [
            {
                "start_time": 0.0,
                "end_time": 2.345,
                "dialogue": "先看整体结构。",
            },
            {
                "start_time": 2.345,
                "end_time": 5.75,
                "dialogue": "再解释关键步骤。",
            },
        ],
        output_path=tmp_path / "explainer-video.srt",
        total_duration=5.75,
    )

    assert subtitle_path is not None
    content = subtitle_path.read_text(encoding="utf-8-sig")
    assert "00:00:00,000 --> 00:00:02,345" in content
    assert "00:00:02,345 --> 00:00:05,750" in content
    assert "先看整体结构。" in content


def test_srt_subtitles_skip_empty_dialogue(tmp_path):
    result = write_srt_subtitles(
        [{"start_time": 0.0, "end_time": 1.0, "dialogue": "  "}],
        output_path=tmp_path / "explainer-video.srt",
        total_duration=1.0,
    )

    assert result is None
    assert not (tmp_path / "explainer-video.srt").exists()


def test_subtitle_cues_wrap_long_dialogue_across_the_turn_duration():
    cues = build_subtitle_cues(
        [
            {
                "start_time": 10.0,
                "end_time": 18.0,
                "dialogue": (
                    "这是一个用于验证字幕自动换行和分段逻辑的较长中文讲解句子，它需要在视频底部保持清晰可读，"
                    "并且在内容继续展开时自动切换到下一条字幕，避免单个画面承载过多文字。"
                ),
            }
        ],
        total_duration=20.0,
    )

    assert len(cues) == 2
    assert cues[0]["start_time"] == 10.0
    assert cues[-1]["end_time"] == 18.0
    assert all(len(str(cue["dialogue"]).splitlines()) <= 2 for cue in cues)


@pytest.mark.asyncio
async def test_keyframe_images_are_persisted_with_model_provenance(
    tmp_path, monkeypatch
):
    async def fake_resolve(_model):
        return "mock-provider", "mock-image-model", "secret", None

    async def fake_generate_image(**kwargs):
        destination = kwargs["persist_image_bytes"](b"image-bytes", "image/png")
        return destination, "image/png"

    monkeypatch.setattr(
        "forgenote.podcasts.video_creator.resolve_image_model_config",
        fake_resolve,
    )
    monkeypatch.setattr(
        "forgenote.podcasts.video_creator.generate_image",
        fake_generate_image,
    )

    rendered = await generate_keyframe_images(
        [{"index": 1, "turn_index": 0, "time_index": 0.0, "prompt": "diagram"}],
        output_dir=tmp_path,
        image_model=object(),
    )

    assert Path(rendered[0]["image_file"]).read_bytes() == b"image-bytes"
    assert rendered[0]["image_model"] == "mock-image-model"
    assert rendered[0]["image_provider"] == "mock-provider"


def test_ffmpeg_composition_uses_keyframe_durations_and_podcast_audio(
    tmp_path, monkeypatch
):
    audio_path = tmp_path / "episode.mp3"
    audio_path.write_bytes(b"audio")
    first = tmp_path / "frame-1.png"
    second = tmp_path / "frame-2.png"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    output_path = tmp_path / "explainer.mp4"
    subtitle_cues = [{"start_time": 0.0, "end_time": 10.0, "dialogue": "字幕"}]
    calls = []

    def fake_run(command, **kwargs):
        filter_flag = command.index("-filter_complex_script")
        filter_graph = Path(command[filter_flag + 1]).read_text(encoding="utf-8")
        subtitle_text_files = list(tmp_path.glob(".subtitle-text-*/cue-000.txt"))
        assert len(subtitle_text_files) == 1
        assert b"\r\n" not in subtitle_text_files[0].read_bytes()
        calls.append((command, kwargs, filter_graph))
        Path(command[-1]).write_bytes(b"mp4")

    monkeypatch.setattr(
        "forgenote.podcasts.video_creator.shutil.which", lambda _: "ffmpeg"
    )
    monkeypatch.setattr("forgenote.podcasts.video_creator.subprocess.run", fake_run)

    result = compose_explainer_video(
        audio_path=audio_path,
        keyframes=[
            {"time_index": 0.0, "image_file": str(first)},
            {"time_index": 4.25, "image_file": str(second)},
        ],
        output_path=output_path,
        total_duration=10.0,
        subtitle_cues=subtitle_cues,
    )

    manifest = output_path.with_suffix(".ffconcat").read_text(encoding="utf-8")
    assert "duration 4.250" in manifest
    assert "duration 5.750" in manifest
    assert str(audio_path) in calls[0][0]
    filter_flag = calls[0][0].index("-filter_complex_script")
    assert filter_flag > 0
    filter_graph = calls[0][2]
    assert "concat=n=2:v=1:a=0[outv]" in filter_graph
    assert "drawtext=" in filter_graph
    assert "enable='gte(t,0.000)*lt(t,10.000)'" in filter_graph
    assert "[outvsub0]" in filter_graph
    assert calls[0][0][calls[0][0].index("-map") + 1] == "[outvsub0]"
    assert calls[0][0].count("-loop") == 2
    assert calls[0][0][calls[0][0].index("-pix_fmt") + 1] == "yuv420p"
    assert calls[0][0][calls[0][0].index("-profile:v") + 1] == "high"
    assert calls[0][0][calls[0][0].index("-level:v") + 1] == "4.0"
    assert calls[0][0][calls[0][0].index("-tag:v") + 1] == "avc1"
    duration_flag = calls[0][0].index("-t")
    assert calls[0][0][duration_flag + 1] == "10.000"
    assert calls[0][0][-1] == str(output_path)
    assert result.read_bytes() == b"mp4"


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="FFmpeg is not installed")
def test_real_ffmpeg_builds_playable_mp4_without_video_api(tmp_path):
    project_root = Path(__file__).resolve().parents[1]
    audio_path = project_root / "forgenote" / "ai" / "assets" / "test_speech.mp3"
    frame_one = project_root / "docs" / "assets" / "screenshot-learning-workspace.png"
    frame_two = project_root / "docs" / "assets" / "screenshot-model-settings.png"
    duration = get_audio_duration_seconds(audio_path)
    output_path = tmp_path / "real-explainer.mp4"
    subtitle_cues = build_subtitle_cues(
        [
            {
                "start_time": 0.0,
                "end_time": duration,
                "dialogue": "字幕与讲解音频使用同一时间轴。",
            }
        ],
        total_duration=duration,
    )

    result = compose_explainer_video(
        audio_path=audio_path,
        keyframes=[
            {"time_index": 0.0, "image_file": str(frame_one)},
            {
                "time_index": max(0.1, duration / 2),
                "image_file": str(frame_two),
            },
        ],
        output_path=output_path,
        total_duration=duration,
        subtitle_cues=subtitle_cues,
    )

    assert duration > 0
    assert result.exists()
    assert result.stat().st_size > 1_000

    ffprobe = shutil.which("ffprobe")
    if ffprobe is not None:
        probe = subprocess.run(
            [
                ffprobe,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=pix_fmt,profile,codec_tag_string",
                "-of",
                "default=noprint_wrappers=1",
                str(result),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        assert "profile=High" in probe.stdout
        assert "codec_tag_string=avc1" in probe.stdout
        assert "pix_fmt=yuv420p" in probe.stdout


def test_podcast_request_keeps_video_generation_opt_in():
    regular = PodcastGenerationRequest(
        episode_profile="study",
        speaker_profile="solo",
        episode_name="regular",
        content="course material",
    )
    explainer = regular.model_copy(update={"generate_video": True})

    assert regular.generate_video is False
    assert explainer.generate_video is True
