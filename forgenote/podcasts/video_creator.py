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


def compose_explainer_video(
    *,
    audio_path: Path,
    keyframes: list[dict[str, Any]],
    output_path: Path,
    total_duration: float,
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
    for index, keyframe in enumerate(keyframes):
        start = max(0.0, float(keyframe["time_index"]))
        next_start = (
            max(start, float(keyframes[index + 1]["time_index"]))
            if index + 1 < len(keyframes)
            else total_duration
        )
        duration = max(0.1, next_start - start)
        lines.append(_concat_file_path(Path(str(keyframe["image_file"]))))
        lines.append(f"duration {duration:.3f}")

    lines.append(_concat_file_path(Path(str(keyframes[-1]["image_file"]))))
    manifest_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

    command = [
        ffmpeg,
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(manifest_path),
        "-i",
        str(audio_path),
        "-vf",
        (
            "scale=1280:720:force_original_aspect_ratio=decrease,"
            "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=white,format=yuv420p"
        ),
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
        "-shortest",
        "-movflags",
        "+faststart",
        str(output_path),
    ]
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

    keyframes = build_keyframe_plan(
        timestamped_transcript,
        episode_name=episode_name,
    )
    rendered_keyframes = await generate_keyframe_images(
        keyframes,
        output_dir=output_dir / "keyframes",
        image_model=image_model,
    )
    video_path = compose_explainer_video(
        audio_path=audio_path,
        keyframes=rendered_keyframes,
        output_path=output_dir / "explainer-video.mp4",
        total_duration=total_duration,
    )
    return video_path, rendered_keyframes
