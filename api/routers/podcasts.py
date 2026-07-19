import subprocess
from pathlib import Path
from typing import List, Optional
from urllib.parse import unquote, urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from loguru import logger
from pydantic import BaseModel

from api.podcast_service import (
    PodcastGenerationRequest,
    PodcastGenerationResponse,
    PodcastService,
)

router = APIRouter()


class PodcastEpisodeResponse(BaseModel):
    id: str
    name: str
    notebook_id: Optional[str] = None
    episode_profile: dict
    speaker_profile: dict
    briefing: str
    audio_file: Optional[str] = None
    audio_url: Optional[str] = None
    video_file: Optional[str] = None
    video_url: Optional[str] = None
    keyframes: Optional[List[dict]] = None
    video_error: Optional[str] = None
    transcript: Optional[dict] = None
    outline: Optional[dict] = None
    created: Optional[str] = None
    job_status: Optional[str] = None
    error_message: Optional[str] = None


def _resolve_audio_path(audio_file: str) -> Path:
    if audio_file.startswith("file://"):
        parsed = urlparse(audio_file)
        return Path(unquote(parsed.path))
    return Path(audio_file)


@router.post("/podcasts/generate", response_model=PodcastGenerationResponse)
async def generate_podcast(request: PodcastGenerationRequest):
    """
    Generate a podcast episode using Episode Profiles.
    Returns immediately with job ID for status tracking.
    """
    try:
        job_id = await PodcastService.submit_generation_job(
            episode_profile_name=request.episode_profile,
            speaker_profile_name=request.speaker_profile,
            episode_name=request.episode_name,
            notebook_id=request.notebook_id,
            content=request.content,
            briefing_suffix=request.briefing_suffix,
            generate_video=request.generate_video,
        )

        return PodcastGenerationResponse(
            job_id=job_id,
            status="submitted",
            message=(
                f"Podcast and explainer video generation started for episode '{request.episode_name}'"
                if request.generate_video
                else f"Podcast generation started for episode '{request.episode_name}'"
            ),
            episode_profile=request.episode_profile,
            episode_name=request.episode_name,
        )

    except Exception as e:
        logger.error(f"Error generating podcast: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to generate podcast")


@router.get("/podcasts/jobs/{job_id}")
async def get_podcast_job_status(job_id: str):
    """Get the status of a podcast generation job"""
    try:
        status_data = await PodcastService.get_job_status(job_id)
        return status_data

    except Exception as e:
        logger.error(f"Error fetching podcast job status: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to fetch job status")


@router.get("/podcasts/episodes", response_model=List[PodcastEpisodeResponse])
async def list_podcast_episodes():
    """List all podcast episodes"""
    try:
        episodes = await PodcastService.list_episodes()

        response_episodes = []
        for episode in episodes:
            # Skip incomplete episodes without a command or generated media.
            if (
                not episode.command
                and not episode.audio_file
                and not episode.video_file
            ):
                continue

            # Get job status and error message if available
            job_status = None
            error_message = None
            if episode.command:
                try:
                    detail = await episode.get_job_detail()
                    job_status = detail["status"]
                    error_message = detail["error_message"]
                except Exception:
                    job_status = "unknown"
            else:
                # No command but has audio file = completed import
                job_status = "completed"

            audio_url = None
            if episode.audio_file:
                audio_path = _resolve_audio_path(episode.audio_file)
                if audio_path.exists():
                    audio_url = f"/api/podcasts/episodes/{episode.id}/audio"

            video_url = None
            if episode.video_file:
                video_path = _resolve_audio_path(episode.video_file)
                if video_path.exists():
                    video_url = f"/api/podcasts/episodes/{episode.id}/video"

            response_episodes.append(
                PodcastEpisodeResponse(
                    id=str(episode.id),
                    name=episode.name,
                    notebook_id=episode.notebook_id,
                    episode_profile=episode.episode_profile,
                    speaker_profile=episode.speaker_profile,
                    briefing=episode.briefing,
                    audio_file=episode.audio_file,
                    audio_url=audio_url,
                    video_file=episode.video_file,
                    video_url=video_url,
                    keyframes=episode.keyframes,
                    video_error=episode.video_error,
                    transcript=episode.transcript,
                    outline=episode.outline,
                    created=str(episode.created) if episode.created else None,
                    job_status=job_status,
                    error_message=error_message,
                )
            )

        return response_episodes

    except Exception as e:
        logger.error(f"Error listing podcast episodes: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to list podcast episodes")


@router.get("/podcasts/episodes/{episode_id}", response_model=PodcastEpisodeResponse)
async def get_podcast_episode(episode_id: str):
    """Get a specific podcast episode"""
    try:
        episode = await PodcastService.get_episode(episode_id)

        # Get job status and error message if available
        job_status = None
        error_message = None
        if episode.command:
            try:
                detail = await episode.get_job_detail()
                job_status = detail["status"]
                error_message = detail["error_message"]
            except Exception:
                job_status = "unknown"
        else:
            # No command but has audio file = completed import
            job_status = "completed" if episode.audio_file else "unknown"

        audio_url = None
        if episode.audio_file:
            audio_path = _resolve_audio_path(episode.audio_file)
            if audio_path.exists():
                audio_url = f"/api/podcasts/episodes/{episode.id}/audio"

        video_url = None
        if episode.video_file:
            video_path = _resolve_audio_path(episode.video_file)
            if video_path.exists():
                video_url = f"/api/podcasts/episodes/{episode.id}/video"

        return PodcastEpisodeResponse(
            id=str(episode.id),
            name=episode.name,
            notebook_id=episode.notebook_id,
            episode_profile=episode.episode_profile,
            speaker_profile=episode.speaker_profile,
            briefing=episode.briefing,
            audio_file=episode.audio_file,
            audio_url=audio_url,
            video_file=episode.video_file,
            video_url=video_url,
            keyframes=episode.keyframes,
            video_error=episode.video_error,
            transcript=episode.transcript,
            outline=episode.outline,
            created=str(episode.created) if episode.created else None,
            job_status=job_status,
            error_message=error_message,
        )

    except Exception as e:
        logger.error(f"Error fetching podcast episode: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")


@router.get("/podcasts/episodes/{episode_id}/audio")
async def stream_podcast_episode_audio(episode_id: str):
    """Stream the audio file associated with a podcast episode"""
    try:
        episode = await PodcastService.get_episode(episode_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast episode for audio: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")

    if not episode.audio_file:
        raise HTTPException(status_code=404, detail="Episode has no audio file")

    audio_path = _resolve_audio_path(episode.audio_file)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    return FileResponse(
        audio_path,
        media_type="audio/mpeg",
        filename=audio_path.name,
    )


@router.get("/podcasts/episodes/{episode_id}/audio/wav")
async def export_podcast_episode_audio_wav(episode_id: str):
    """Export a podcast episode as WAV for user download."""
    try:
        episode = await PodcastService.get_episode(episode_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast episode for WAV export: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")

    if not episode.audio_file:
        raise HTTPException(status_code=404, detail="Episode has no audio file")

    audio_path = _resolve_audio_path(episode.audio_file)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    if audio_path.suffix.lower() == ".wav":
        return FileResponse(
            audio_path,
            media_type="audio/wav",
            filename=audio_path.name,
        )

    wav_path = audio_path.with_suffix(".export.wav")
    try:
        if (
            not wav_path.exists()
            or wav_path.stat().st_mtime < audio_path.stat().st_mtime
        ):
            subprocess.run(
                [
                    "ffmpeg",
                    "-y",
                    "-i",
                    str(audio_path),
                    "-ar",
                    "44100",
                    "-ac",
                    "2",
                    str(wav_path),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
    except Exception as e:
        logger.error(f"Failed to convert podcast audio to WAV: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to export WAV audio")

    return FileResponse(
        wav_path,
        media_type="audio/wav",
        filename=f"{audio_path.stem}.wav",
    )


@router.get("/podcasts/episodes/{episode_id}/video")
async def stream_podcast_episode_video(episode_id: str):
    """Stream the locally composed explainer video for a podcast episode."""
    try:
        episode = await PodcastService.get_episode(episode_id)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching podcast episode for video: {str(e)}")
        raise HTTPException(status_code=404, detail="Episode not found")

    if not episode.video_file:
        raise HTTPException(status_code=404, detail="Episode has no explainer video")

    video_path = _resolve_audio_path(episode.video_file)
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found on disk")

    return FileResponse(
        video_path,
        media_type="video/mp4",
        filename=video_path.name,
    )


@router.post("/podcasts/episodes/{episode_id}/retry")
async def retry_podcast_episode(episode_id: str):
    """Retry a failed podcast episode by deleting it and submitting a new job"""
    try:
        episode = await PodcastService.get_episode(episode_id)

        # Validate episode is in a failed state
        detail = await episode.get_job_detail()
        if detail["status"] not in ("failed", "error"):
            raise HTTPException(
                status_code=400,
                detail=f"Episode is not in a failed state (current: {detail['status']})",
            )

        # Extract params for re-submission
        ep_profile_name = episode.episode_profile.get("name")
        sp_profile_name = episode.speaker_profile.get("name")
        episode_name = episode.name
        content = episode.content

        if not ep_profile_name or not sp_profile_name:
            raise HTTPException(
                status_code=400,
                detail="Cannot retry: episode or speaker profile name missing from stored data",
            )

        # Delete audio file if any
        if episode.audio_file:
            audio_path = _resolve_audio_path(episode.audio_file)
            if audio_path.exists():
                try:
                    audio_path.unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete audio file {audio_path}: {e}")

        # Delete the failed episode
        await episode.delete()

        # Submit a new job
        job_id = await PodcastService.submit_generation_job(
            episode_profile_name=ep_profile_name,
            speaker_profile_name=sp_profile_name,
            episode_name=episode_name,
            notebook_id=episode.notebook_id,
            content=content,
            generate_video=bool(
                episode.video_file or episode.keyframes or episode.video_error
            ),
        )

        return {"job_id": job_id, "message": "Retry submitted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrying podcast episode: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to retry episode")


@router.delete("/podcasts/episodes/{episode_id}")
async def delete_podcast_episode(episode_id: str):
    """Delete a podcast episode and its associated audio file"""
    try:
        # Get the episode first to check if it exists and get the audio file path
        episode = await PodcastService.get_episode(episode_id)

        # Delete the physical audio file if it exists
        if episode.audio_file:
            audio_path = _resolve_audio_path(episode.audio_file)
            if audio_path.exists():
                try:
                    audio_path.unlink()
                    logger.info(f"Deleted audio file: {audio_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete audio file {audio_path}: {e}")

        if episode.video_file:
            video_path = _resolve_audio_path(episode.video_file)
            if video_path.exists():
                try:
                    video_path.unlink()
                    logger.info(f"Deleted video file: {video_path}")
                except Exception as e:
                    logger.warning(f"Failed to delete video file {video_path}: {e}")

        for keyframe in episode.keyframes or []:
            image_file = (
                keyframe.get("image_file") if isinstance(keyframe, dict) else None
            )
            if not image_file:
                continue
            image_path = _resolve_audio_path(str(image_file))
            if image_path.exists():
                try:
                    image_path.unlink()
                except Exception as e:
                    logger.warning(f"Failed to delete keyframe {image_path}: {e}")

        # Delete the episode from the database
        await episode.delete()

        logger.info(f"Deleted podcast episode: {episode_id}")
        return {"message": "Episode deleted successfully", "episode_id": episode_id}

    except Exception as e:
        logger.error(f"Error deleting podcast episode: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to delete episode")
