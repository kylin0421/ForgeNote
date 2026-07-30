"""Create source-grounded explainer videos from podcast audio and visual cues.

The transcript LLM places an optional ``visual_prompt`` on selected dialogue
turns. After TTS finishes, those turn anchors are converted to exact timestamps,
rendered with the configured image model, and assembled locally with FFmpeg.
No video-generation API is required.
"""

from __future__ import annotations

import math
import mimetypes
import shutil
import subprocess
import tempfile
import textwrap
from datetime import timedelta
from pathlib import Path
from typing import Any, Iterable, Optional
from urllib.parse import unquote, urlparse

import httpx
from loguru import logger

from forgenote.ai.image_generation import generate_image, resolve_image_model_config
from forgenote.ai.models import DefaultModels, Model

MAX_KEYFRAMES = 12
MIN_KEYFRAME_GAP_SECONDS = 3.0
IDEAL_KEYFRAME_INTERVAL_SECONDS = 16.0
VIDEO_TRANSITION_SECONDS = 0.45


def _as_dict(item: Any) -> dict[str, Any]:
    if isinstance(item, dict):
        return dict(item)
    if hasattr(item, "model_dump"):
        return item.model_dump()
    return {"dialogue": str(item)}


def build_keyframe_plan(
    transcript: Iterable[Any],
    *,
    episode_name: str = "",
    max_keyframes: int = MAX_KEYFRAMES,
    min_gap_seconds: float = MIN_KEYFRAME_GAP_SECONDS,
) -> list[dict[str, Any]]:
    """Convert transcript visual anchors to exact, economical time-indexed cues.

    The transcript model is encouraged to add visual prompts, but compatible
    language models occasionally omit them. A video with one still image for a
    long narration looks broken even though generation technically succeeded,
    so sparse plans are filled from the spoken source text at a conservative
    interval.
    """

    entries = [_as_dict(item) for item in transcript]
    keyframes: list[dict[str, Any]] = []
    seen_prompts: set[str] = set()

    for turn_index, entry in enumerate(entries):
        prompt = str(entry.get("visual_prompt") or "").strip()
        if not prompt or prompt in seen_prompts:
            continue

        raw_time = entry.get("start_time", entry.get("start", 0.0))
        try:
            time_index = max(0.0, float(raw_time or 0.0))
        except (TypeError, ValueError):
            time_index = 0.0

        if keyframes and time_index - keyframes[-1]["time_index"] < min_gap_seconds:
            continue

        keyframes.append(
            {
                "index": len(keyframes) + 1,
                "turn_index": turn_index,
                "time_index": round(time_index, 3),
                "prompt": prompt,
                "prompt_source": "model",
            }
        )
        seen_prompts.add(prompt)
        if len(keyframes) >= max_keyframes:
            break

    timeline_end = 0.0
    for entry in entries:
        for field in ("end_time", "end", "start_time", "start"):
            try:
                timeline_end = max(timeline_end, float(entry.get(field) or 0.0))
            except (TypeError, ValueError):
                continue

    desired_count = min(
        max_keyframes,
        max(1, math.ceil(timeline_end / IDEAL_KEYFRAME_INTERVAL_SECONDS)),
    )

    def coverage_prompt(entry: dict[str, Any]) -> str:
        idea = str(entry.get("dialogue") or episode_name).strip()[:500]
        return (
            "Create a polished editorial educational visual for this spoken idea: "
            f"{idea}. Turn the idea into one concrete visual metaphor or process "
            "diagram with a clear focal object and two to four supporting elements. "
            "Use shapes, arrows, scale, and color rather than visible prose."
        )

    if entries and len(keyframes) < desired_count:
        occupied_turns = {int(item["turn_index"]) for item in keyframes}
        occupied_times = [float(item["time_index"]) for item in keyframes]
        candidate_indices = [
            round(index * (len(entries) - 1) / max(1, desired_count - 1))
            for index in range(desired_count)
        ]
        for turn_index in candidate_indices:
            if turn_index in occupied_turns:
                continue
            entry = entries[turn_index]
            try:
                time_index = max(
                    0.0,
                    float(entry.get("start_time", entry.get("start", 0.0)) or 0.0),
                )
            except (TypeError, ValueError):
                time_index = 0.0
            if any(abs(time_index - item_time) < min_gap_seconds for item_time in occupied_times):
                continue
            keyframes.append(
                {
                    "index": 0,
                    "turn_index": turn_index,
                    "time_index": round(time_index, 3),
                    "prompt": coverage_prompt(entry),
                    "prompt_source": "coverage",
                }
            )
            occupied_turns.add(turn_index)
            occupied_times.append(time_index)
            if len(keyframes) >= desired_count:
                break

    if not keyframes and entries:
        keyframes.append(
            {
                "index": 1,
                "turn_index": 0,
                "time_index": 0.0,
                "prompt": coverage_prompt(entries[0]),
                "prompt_source": "coverage",
            }
        )

    if keyframes:
        keyframes.sort(key=lambda item: (float(item["time_index"]), int(item["turn_index"])))
        for index, keyframe in enumerate(keyframes, start=1):
            keyframe["index"] = index
        keyframes[0]["time_index"] = 0.0
    return keyframes


def _video_prompt(prompt: str) -> str:
    return (
        f"{prompt.strip()}\n\n"
        "Art direction: premium 16:9 editorial educational explainer frame, built "
        "for a coherent sequence rather than a generic stock image. Use a clean "
        "deep-navy or warm-neutral background, restrained cyan/violet accents, "
        "layered depth, generous safe margins, one unmistakable focal concept, and "
        "a consistent modern vector/3D-infographic language. Make the relationship "
        "between objects visually explicit through position, scale, light, arrows, "
        "or flow. Avoid decorative clutter and photorealistic talking heads. "
        "Do not render a logo, watermark, subtitle, paragraph, formula, UI chrome, "
        "or tiny text; captions are added later by ForgeNote."
    )


async def _resolve_default_image_model() -> Model:
    defaults = await DefaultModels.get_instance()
    model_id = getattr(defaults, "default_image_model", None)
    if not model_id:
        raise ValueError(
            "Explainer video requires a default image model. Configure one in Settings -> Models."
        )
    return await Model.get(str(model_id))


def _extension_for_mime(mime_type: str) -> str:
    extension = mimetypes.guess_extension(mime_type or "") or ".png"
    return ".jpg" if extension in {".jpe", ".jpeg"} else extension


async def _materialize_image(
    image_source: str,
    *,
    destination: Path,
    mime_type: str,
) -> Path:
    parsed = urlparse(image_source)
    if parsed.scheme in {"http", "https"}:
        async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
            response = await client.get(image_source)
            response.raise_for_status()
            destination.write_bytes(response.content)
        return destination

    source_path = (
        Path(unquote(parsed.path)) if parsed.scheme == "file" else Path(image_source)
    )
    if source_path.resolve() != destination.resolve():
        shutil.copyfile(source_path, destination)
    return destination


async def generate_keyframe_images(
    keyframes: list[dict[str, Any]],
    *,
    output_dir: Path,
    image_model: Optional[Model] = None,
) -> list[dict[str, Any]]:
    """Render each visual cue with the configured image model."""

    output_dir.mkdir(parents=True, exist_ok=True)
    model = image_model or await _resolve_default_image_model()
    provider, model_name, api_key, base_url = await resolve_image_model_config(model)
    if not api_key:
        raise ValueError(
            f"Image model {provider}/{model_name} has no API key configured"
        )

    rendered: list[dict[str, Any]] = []
    for keyframe in keyframes:
        index = int(keyframe["index"])
        persisted_path: Optional[Path] = None

        def persist_image_bytes(
            image_bytes: bytes, mime_type: str = "image/png"
        ) -> str:
            nonlocal persisted_path
            persisted_path = (
                output_dir / f"keyframe-{index:03d}{_extension_for_mime(mime_type)}"
            )
            persisted_path.write_bytes(image_bytes)
            return str(persisted_path)

        image_source, mime_type = await generate_image(
            provider=provider,
            model_name=model_name,
            api_key=api_key,
            prompt=_video_prompt(str(keyframe["prompt"])),
            base_url=base_url,
            persist_image_bytes=persist_image_bytes,
        )

        image_path = persisted_path
        if image_path is None:
            image_path = (
                output_dir / f"keyframe-{index:03d}{_extension_for_mime(mime_type)}"
            )
            await _materialize_image(
                image_source,
                destination=image_path,
                mime_type=mime_type,
            )

        rendered.append(
            {
                **keyframe,
                "image_file": str(image_path),
                "image_model": model_name,
                "image_provider": provider,
            }
        )
        logger.info(
            "Generated explainer keyframe {}/{} at {:.3f}s",
            index,
            len(keyframes),
            float(keyframe["time_index"]),
        )

    return rendered


def _concat_file_path(path: Path) -> str:
    escaped = path.resolve().as_posix().replace("'", "'\\''")
    return f"file '{escaped}'"


def _srt_timestamp(seconds: float) -> str:
    milliseconds = max(0, round(float(seconds) * 1000))
    value = timedelta(milliseconds=milliseconds)
    total_seconds = int(value.total_seconds())
    hours, remainder = divmod(total_seconds, 3600)
    minutes, whole_seconds = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{whole_seconds:02d},{milliseconds % 1000:03d}"


def _vtt_timestamp(seconds: float) -> str:
    return _srt_timestamp(seconds).replace(",", ".")


def build_subtitle_cues(
    transcript: Iterable[Any],
    *,
    total_duration: float,
) -> list[dict[str, Any]]:
    """Create readable caption cues from the real TTS start and end times."""

    if total_duration <= 0:
        raise ValueError("Podcast audio duration must be greater than zero")

    entries = [_as_dict(item) for item in transcript]
    cues: list[dict[str, Any]] = []
    for index, entry in enumerate(entries):
        dialogue = str(entry.get("dialogue") or "").strip()
        if not dialogue:
            continue

        raw_start = entry.get("start_time", entry.get("start", 0.0))
        try:
            start = min(total_duration, max(0.0, float(raw_start or 0.0)))
        except (TypeError, ValueError):
            start = 0.0

        raw_end = entry.get("end_time", entry.get("end"))
        try:
            end = float(raw_end) if raw_end is not None else 0.0
        except (TypeError, ValueError):
            end = 0.0
        if end <= start:
            next_start = None
            for following in entries[index + 1 :]:
                candidate = following.get("start_time", following.get("start"))
                try:
                    next_start = float(candidate) if candidate is not None else None
                except (TypeError, ValueError):
                    next_start = None
                if next_start is not None and next_start > start:
                    break
            end = next_start if next_start is not None else total_duration

        end = min(total_duration, max(start + 0.1, end))
        lines = textwrap.wrap(
            " ".join(dialogue.split()),
            width=24,
            break_long_words=True,
            break_on_hyphens=False,
        ) or [dialogue]
        caption_pages = [
            "\n".join(line.rstrip() for line in lines[i : i + 2])
            for i in range(0, len(lines), 2)
        ]
        page_duration = (end - start) / len(caption_pages)
        for page_index, caption in enumerate(caption_pages):
            cue_start = start + (page_duration * page_index)
            cue_end = (
                end
                if page_index + 1 == len(caption_pages)
                else cue_start + page_duration
            )
            cues.append(
                {
                    "start_time": cue_start,
                    "end_time": cue_end,
                    "dialogue": caption,
                }
            )

    return cues


def write_srt_subtitles(
    transcript: Iterable[Any],
    *,
    output_path: Path,
    total_duration: float,
) -> Optional[Path]:
    """Write an SRT companion file from the real TTS dialogue timeline."""

    cues = build_subtitle_cues(transcript, total_duration=total_duration)

    if not cues:
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines: list[str] = []
    for cue_number, cue in enumerate(cues, start=1):
        lines.extend(
            [
                str(cue_number),
                (
                    f"{_srt_timestamp(float(cue['start_time']))} --> "
                    f"{_srt_timestamp(float(cue['end_time']))}"
                ),
                str(cue["dialogue"]),
                "",
            ]
        )
    output_path.write_text("\n".join(lines), encoding="utf-8-sig")
    return output_path


def write_webvtt_subtitles(
    transcript: Iterable[Any],
    *,
    output_path: Path,
    total_duration: float,
) -> Optional[Path]:
    """Write a browser-ready WebVTT companion track for the burned captions."""

    cues = build_subtitle_cues(transcript, total_duration=total_duration)
    if not cues:
        return None

    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.extend(
            [
                (
                    f"{_vtt_timestamp(float(cue['start_time']))} --> "
                    f"{_vtt_timestamp(float(cue['end_time']))}"
                ),
                str(cue["dialogue"]),
                "",
            ]
        )
    output_path.write_text("\n".join(lines), encoding="utf-8", newline="\n")
    return output_path


def _ffmpeg_filter_path(path: Path) -> str:
    escaped = path.resolve().as_posix().replace("'", "\\'")
    if len(escaped) >= 2 and escaped[1] == ":":
        escaped = f"{escaped[0]}\\:{escaped[2:]}"
    return escaped


def _subtitle_font_path() -> Optional[Path]:
    candidates = [
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
        Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    ]
    return next((path for path in candidates if path.exists()), None)


def compose_explainer_video(
    *,
    audio_path: Path,
    keyframes: list[dict[str, Any]],
    output_path: Path,
    total_duration: float,
    subtitle_cues: Optional[list[dict[str, Any]]] = None,
    ffmpeg_binary: Optional[str] = None,
) -> Path:
    """Combine timed still frames and podcast audio into a portable MP4."""

    if not keyframes:
        raise ValueError("At least one keyframe is required to compose a video")
    if total_duration <= 0:
        raise ValueError("Podcast audio duration must be greater than zero")

    ffmpeg = ffmpeg_binary or shutil.which("ffmpeg")
    if not ffmpeg:
        raise RuntimeError("FFmpeg is required to compose explainer videos")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path = output_path.with_suffix(".ffconcat")
    lines = ["ffconcat version 1.0"]
    frame_durations: list[float] = []
    for index, keyframe in enumerate(keyframes):
        start = max(0.0, float(keyframe["time_index"]))
        next_start = (
            max(start, float(keyframes[index + 1]["time_index"]))
            if index + 1 < len(keyframes)
            else total_duration
        )
        duration = max(0.1, next_start - start)
        frame_durations.append(duration)
        lines.append(_concat_file_path(Path(str(keyframe["image_file"]))))
        lines.append(f"duration {duration:.3f}")

    lines.append(_concat_file_path(Path(str(keyframes[-1]["image_file"]))))
    manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    command = [ffmpeg, "-y"]
    for keyframe in keyframes:
        command.extend(
            [
                "-loop",
                "1",
                "-framerate",
                "1",
                "-i",
                str(Path(str(keyframe["image_file"]))),
            ]
        )
    command.extend(["-i", str(audio_path)])

    transition_duration = (
        min(
            VIDEO_TRANSITION_SECONDS,
            max(0.12, min(frame_durations) / 3),
        )
        if len(keyframes) > 1
        else 0.0
    )
    filters = []
    for index, duration in enumerate(frame_durations):
        rendered_duration = duration + (
            transition_duration if index + 1 < len(keyframes) else 0.0
        )
        zoom_step = "0.00020" if index % 2 == 0 else "0.00014"
        filters.append(
            f"[{index}:v]"
            "scale=1408:792:force_original_aspect_ratio=increase,"
            "crop=1408:792,"
            f"zoompan=z='min(zoom+{zoom_step},1.045)':"
            "x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':"
            f"d=1:s=1280x720:fps=30,trim=duration={rendered_duration:.3f},"
            f"setpts=PTS-STARTPTS[v{index}]"
        )
    if len(keyframes) == 1:
        filters.append("[v0]null[outv]")
        video_output = "[outv]"
    else:
        video_output = "[v0]"
        transition_offset = frame_durations[0]
        for index in range(1, len(keyframes)):
            next_output = f"[outvxf{index}]"
            filters.append(
                f"{video_output}[v{index}]xfade=transition=fade:"
                f"duration={transition_duration:.3f}:"
                f"offset={transition_offset:.3f}{next_output}"
            )
            video_output = next_output
            transition_offset += frame_durations[index]

    font_path = _subtitle_font_path()
    with tempfile.TemporaryDirectory(
        dir=output_path.parent, prefix=".subtitle-text-"
    ) as subtitle_dir:
        if subtitle_cues:
            next_output = "[outvscrim]"
            filters.append(
                f"{video_output}drawbox=x=0:y=h-154:w=iw:h=154:"
                f"color=black@0.28:t=fill{next_output}"
            )
            video_output = next_output
        for cue_index, cue in enumerate(subtitle_cues or []):
            text_path = Path(subtitle_dir) / f"cue-{cue_index:03d}.txt"
            # FFmpeg treats CRLF as two line breaks in drawtext text files on
            # Windows, which leaves a blank line between caption rows.
            text_path.write_text(
                str(cue["dialogue"]),
                encoding="utf-8",
                newline="\n",
            )
            next_output = f"[outvsub{cue_index}]"
            drawtext_options = [
                f"textfile='{_ffmpeg_filter_path(text_path)}'",
                "reload=0",
                "fontsize=36",
                "fontcolor=white",
                "borderw=2",
                "bordercolor=black@0.85",
                "box=1",
                "boxcolor=black@0.58",
                "boxborderw=14",
                "line_spacing=8",
                "x=(w-text_w)/2",
                "y=h-text_h-38",
                (
                    "enable='gte(t,"
                    f"{float(cue['start_time']):.3f})*lt(t,"
                    f"{float(cue['end_time']):.3f})'"
                ),
            ]
            if font_path is not None:
                drawtext_options.insert(
                    1, f"fontfile='{_ffmpeg_filter_path(font_path)}'"
                )
            filters.append(
                f"{video_output}drawtext={':'.join(drawtext_options)}{next_output}"
            )
            video_output = next_output

        filter_script_path = Path(subtitle_dir) / "filter-complex.txt"
        filter_script_path.write_text(";".join(filters), encoding="utf-8")
        command.extend(
            [
                "-filter_complex_script",
                str(filter_script_path),
                "-map",
                video_output,
                "-map",
                f"{len(keyframes)}:a:0",
                "-r",
                "30",
                "-c:v",
                "libx264",
                "-pix_fmt",
                "yuv420p",
                "-profile:v",
                "high",
                "-level:v",
                "4.0",
                "-tag:v",
                "avc1",
                "-preset",
                "medium",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
                "-af",
                "highpass=f=65,lowpass=f=14000,"
                "loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000",
                "-ar",
                "48000",
                "-ac",
                "2",
                "-t",
                f"{total_duration:.3f}",
                "-shortest",
                "-movflags",
                "+faststart",
                str(output_path),
            ]
        )
        subprocess.run(
            command,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            # FFmpeg can mix UTF-8 media metadata with the Windows process
            # codepage. Capturing bytes avoids a post-success UnicodeDecodeError
            # that would otherwise discard an already-created MP4.
            text=False,
        )
    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("FFmpeg completed without producing a video file")
    return output_path


async def create_explainer_video(
    *,
    episode_name: str,
    timestamped_transcript: Iterable[Any],
    audio_path: Path,
    output_dir: Path,
    total_duration: float,
    image_model: Optional[Model] = None,
) -> tuple[Path, list[dict[str, Any]]]:
    """Generate keyframes and compose the final explainer video."""

    transcript_entries = [_as_dict(item) for item in timestamped_transcript]
    keyframes = build_keyframe_plan(
        transcript_entries,
        episode_name=episode_name,
    )
    rendered_keyframes = await generate_keyframe_images(
        keyframes,
        output_dir=output_dir / "keyframes",
        image_model=image_model,
    )
    subtitle_cues = build_subtitle_cues(
        transcript_entries,
        total_duration=total_duration,
    )
    write_srt_subtitles(
        transcript_entries,
        output_path=output_dir / "explainer-video.srt",
        total_duration=total_duration,
    )
    write_webvtt_subtitles(
        transcript_entries,
        output_path=output_dir / "explainer-video.vtt",
        total_duration=total_duration,
    )
    video_path = compose_explainer_video(
        audio_path=audio_path,
        keyframes=rendered_keyframes,
        output_path=output_dir / "explainer-video.mp4",
        total_duration=total_duration,
        subtitle_cues=subtitle_cues,
    )
    return video_path, rendered_keyframes
