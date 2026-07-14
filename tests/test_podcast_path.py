"""
Tests for podcast episode directory path generation.

Verifies that episode output directories use UUID-based names
instead of raw episode names, preventing filesystem issues with
spaces and special characters (GitHub issue #663).
"""

import uuid
from pathlib import PurePosixPath

from commands.podcast_commands import (
    build_episode_output_dir,
    build_podcast_error_message,
    build_timestamped_transcript,
)
from forgenote.podcasts.robust_creator import (
    clean_transcript_json_output,
    limit_transcript_turns,
)


class TestBuildEpisodeOutputDir:
    """Test the actual production helper that builds episode output paths."""

    def test_directory_name_is_valid_uuid(self):
        dir_name, _ = build_episode_output_dir("/data")
        parsed = uuid.UUID(dir_name)
        assert str(parsed) == dir_name

    def test_path_structure(self):
        dir_name, output_dir = build_episode_output_dir("/data")
        assert output_dir.as_posix() == f"/data/podcasts/episodes/{dir_name}"

    def test_no_collision_between_calls(self):
        dir1, _ = build_episode_output_dir("/data")
        dir2, _ = build_episode_output_dir("/data")
        assert dir1 != dir2

    def test_path_is_independent_of_episode_name(self):
        """The returned path must never contain user-supplied episode names.

        Since build_episode_output_dir does not accept an episode name at all,
        any name the user types is structurally excluded from the path.
        """
        problematic_names = [
            "My Episode Name",
            "Episode: Part 1",
            'test "quotes"',
            "path/traversal",
            "café résumé",
            "   spaces   ",
            "?*<>|",
        ]
        for name in problematic_names:
            _, output_dir = build_episode_output_dir("/data")
            path_str = str(output_dir)
            # The episode name must not appear anywhere in the path
            assert name not in path_str
            # UUID paths contain only hex digits and hyphens after the base
            dir_component = output_dir.name
            assert all(c in "0123456789abcdef-" for c in dir_component), (
                f"Unexpected chars in directory name: {dir_component}"
            )

    def test_path_works_on_posix(self):
        dir_name, output_dir = build_episode_output_dir("/data")
        posix = PurePosixPath(output_dir.as_posix())
        assert posix.parts == ("/", "data", "podcasts", "episodes", dir_name)

    def test_directory_can_be_created(self, tmp_path):
        """Create the directory on the real filesystem."""
        _, output_dir = build_episode_output_dir(str(tmp_path))
        output_dir.mkdir(parents=True, exist_ok=True)
        assert output_dir.exists()
        assert output_dir.is_dir()


def test_dashscope_quota_error_includes_actionable_guidance():
    message = build_podcast_error_message(
        "DashScope API error: HTTP 403: AllocationQuota.FreeTierOnly: "
        "The free quota has been exhausted.",
        "Resolved models: outline=openai/a; transcript=openai/b; tts=dashscope/qwen3-tts-flash",
    )

    assert "DashScope 配额提示" in message
    assert "FreeTierOnly" in message
    assert "tts=dashscope/qwen3-tts-flash" in message


def test_invalid_json_error_still_includes_model_guidance():
    message = build_podcast_error_message(
        "Invalid json output",
        "Resolved models: outline=openai/gpt-5; transcript=openai/gpt-5; tts=openai/tts",
    )

    assert "extended thinking" in message
    assert "Resolved models:" in message


def test_clean_transcript_json_output_handles_thinking_wrapper_and_suffix():
    raw = (
        "<thinking>plan the dialogue</thinking> "
        '{"transcript":[{"speaker":"Johny Bing","dialogue":"开始。"}]} '
        "For troubleshooting, visit: https://docs.langchain.com/errors"
    )

    assert clean_transcript_json_output(raw) == (
        '{"transcript":[{"speaker":"Johny Bing","dialogue":"开始。"}]}'
    )


def test_clean_transcript_json_output_extracts_outline_after_xml_preface():
    raw = """
<segresult>
Segment 1: 课程回顾
</segresult>
<outline>
{"segments":[{"name":"课程回顾","description":"复习核心概念","size":"short"}]}
</outline>
"""

    assert clean_transcript_json_output(raw) == (
        '{"segments":[{"name":"课程回顾","description":"复习核心概念","size":"short"}]}'
    )


def test_limit_transcript_turns_discards_compatible_model_overflow():
    dialogue = [f"turn-{index}" for index in range(8)]

    assert limit_transcript_turns(dialogue, 3) == ["turn-0", "turn-1", "turn-2"]


def test_tts_404_error_includes_model_provider_guidance():
    message = build_podcast_error_message(
        "Failed to generate speech: OpenAI API error: HTTP 404: 404 Not Found",
        "Resolved models: outline=openai/a; transcript=openai/b; tts=openai/mimo-v2.5-tts",
    )

    assert "语音模型提示" in message
    assert "tts=openai/mimo-v2.5-tts" in message
    assert "provider" in message


def test_build_timestamped_transcript_uses_clip_durations(monkeypatch):
    monkeypatch.setattr(
        "commands.podcast_commands.get_audio_duration_seconds",
        lambda path: {"clip0.mp3": 1.25, "clip1.mp3": 2.5}[str(path)],
    )

    transcript = [
        {"speaker": "A", "dialogue": "Short line."},
        {"speaker": "B", "dialogue": "A much longer line."},
    ]

    timestamped = build_timestamped_transcript(transcript, ["clip0.mp3", "clip1.mp3"])

    assert timestamped[0]["start"] == 0
    assert timestamped[0]["end"] == 1.25
    assert timestamped[1]["start"] == 1.25
    assert timestamped[1]["end"] == 3.75
    assert timestamped[1]["duration"] == 2.5
