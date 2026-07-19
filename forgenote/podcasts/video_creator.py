"""Create source-grounded explainer videos from podcast audio and visual cues.

The transcript LLM places an optional ``visual_prompt`` on selected dialogue
turns. After TTS finishes, those turn anchors are converted to exact timestamps,
rendered with the configured image model, and assembled locally with FFmpeg.
No video-generation API is required.
"""

from __future__ import annotations

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
    """Convert transcript visual anchors to exact, economical time-indexed cues."""

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
            }
        )
        seen_prompts.add(prompt)
        if len(keyframes) >= max_keyframes:
            break

    if not keyframes and entries:
        topic = str(entries[0].get("dialogue") or episode_name).strip()[:500]
        keyframes.append(
            {
                "index": 1,
                "turn_index": 0,
                "time_index": 0.0,
                "prompt": (
                    "Create a clean 16:9 educational textbook illustration that introduces "
                    f"this lesson: {topic}. Use a clear focal concept, ample whitespace, "
                    "consistent blue accent colors, and no long visible text."
                ),
            }
        )

    if keyframes:
        keyframes[0]["time_index"] = 0.0
    return keyframes


def _video_prompt(prompt: str) -> str:
    return (
        f"{prompt.strip()}\n\n"
        "Output requirements: 16:9 landscape frame for an educational explainer video; "
        "clean textbook illustration; consistent neutral background and blue accents; "
        "strong visual hierarchy; no logo, watermark, subtitle, paragraph, or tiny text."
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

    filters = []
    for index, duration in enumerate(frame_durations):
        filters.append(
            f"[{index}:v]"
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white,"
            f"fps=30,trim=duration={duration:.3f},setpts=PTS-STARTPTS[v{index}]"
        )
    filters.append(
        "".join(f"[v{index}]" for index in range(len(keyframes)))
        + f"concat=n={len(keyframes)}:v=1:a=0[outv]"
    )
    video_output = "[outv]"
    font_path = _subtitle_font_path()
    with tempfile.TemporaryDirectory(
        dir=output_path.parent, prefix=".subtitle-text-"
    ) as subtitle_dir:
        for cue_index, cue in enumerate(subtitle_cues or []):
            text_path = Path(subtitle_dir) / f"cue-{cue_index:03d}.txt"
            text_path.write_text(str(cue["dialogue"]), encoding="utf-8")
            next_output = f"[outvsub{cue_index}]"
            drawtext_options = [
                f"textfile='{_ffmpeg_filter_path(text_path)}'",
                "reload=0",
                "fontsize=34",
                "fontcolor=white",
                "borderw=2",
                "bordercolor=black@0.85",
                "box=1",
                "boxcolor=black@0.45",
                "boxborderw=12",
                "line_spacing=8",
                "x=(w-text_w)/2",
                "y=h-text_h-42",
                (
                    "enable='between(t,"
                    f"{float(cue['start_time']):.3f},"
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
                "-preset",
                "medium",
                "-crf",
                "20",
                "-c:a",
                "aac",
                "-b:a",
                "192k",
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
            text=True,
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
    video_path = compose_explainer_video(
        audio_path=audio_path,
        keyframes=rendered_keyframes,
        output_path=output_dir / "explainer-video.mp4",
        total_duration=total_duration,
        subtitle_cues=subtitle_cues,
    )
    return video_path, rendered_keyframes
