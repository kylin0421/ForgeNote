import time
import uuid
from pathlib import Path
from typing import Any, Optional, Sequence

from loguru import logger
from moviepy import AudioFileClip
from pydantic import BaseModel
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.config import DATA_FOLDER
from open_notebook.ai.provider_registration import register_runtime_ai_providers
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.podcasts.models import (
    EpisodeProfile,
    PodcastEpisode,
    SpeakerProfile,
    _resolve_default_podcast_model_config,
    _resolve_model_config,
)
from open_notebook.utils.command_cancellation import raise_if_command_canceled

try:
    from podcast_creator import configure
    from open_notebook.podcasts.robust_creator import create_podcast_with_repair
except ImportError as e:
    logger.error(f"Failed to import podcast_creator: {e}")
    raise ValueError("podcast_creator library not available")


def build_episode_output_dir(data_folder: str) -> tuple[str, Path]:
    """Build a filesystem-safe output directory path for a podcast episode.

    Uses a UUID as the directory name so the path is safe regardless of
    what the user typed as episode name (spaces, special chars, etc.).

    Returns:
        A tuple of (episode_dir_name, output_dir_path).
    """
    episode_dir_name = str(uuid.uuid4())
    output_dir = Path(f"{data_folder}/podcasts/episodes/{episode_dir_name}")
    return episode_dir_name, output_dir


def full_model_dump(model):
    if isinstance(model, BaseModel):
        return model.model_dump()
    elif isinstance(model, dict):
        return {k: full_model_dump(v) for k, v in model.items()}
    elif isinstance(model, list):
        return [full_model_dump(item) for item in model]
    else:
        return model


def get_audio_duration_seconds(audio_path: Any) -> float:
    path = Path(audio_path)
    if not path.exists():
        return 0.0

    clip = None
    try:
        clip = AudioFileClip(str(path))
        duration = float(clip.duration or 0)
        return duration if duration > 0 else 0.0
    except Exception as exc:
        logger.warning(f"Failed to read podcast clip duration for {path}: {exc}")
        return 0.0
    finally:
        if clip is not None:
            clip.close()


def build_timestamped_transcript(transcript: Any, audio_clips: Sequence[Any] | None) -> list[dict[str, Any]]:
    transcript_items = full_model_dump(transcript) or []
    if not isinstance(transcript_items, list):
        return []

    clips = list(audio_clips or [])
    if not clips:
        return transcript_items

    current_time = 0.0
    timestamped: list[dict[str, Any]] = []
    for index, item in enumerate(transcript_items):
        entry = dict(item) if isinstance(item, dict) else {"dialogue": str(item)}
        duration = get_audio_duration_seconds(clips[index]) if index < len(clips) else 0.0
        if duration > 0:
            start_time = current_time
            end_time = current_time + duration
            entry.update(
                {
                    "start": start_time,
                    "end": end_time,
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration": duration,
                }
            )
            current_time = end_time
        timestamped.append(entry)

    return timestamped


def build_podcast_error_message(
    error: Exception | str,
    resolved_model_summary: str = "",
) -> str:
    error_msg = str(error)
    error_lower = error_msg.lower()

    if "invalid json output" in error_lower or "expecting value" in error_lower:
        error_msg += (
            "\n\nNOTE: This error commonly occurs with GPT-5 models that use extended thinking. "
            "The model may be putting all output inside <think> tags, leaving nothing to parse. "
            "Try using gpt-4o, gpt-4o-mini, or gpt-4-turbo instead in your episode profile."
        )

    if (
        "allocationquota.freetieronly" in error_lower
        or "free quota has been exhausted" in error_lower
        or ("dashscope" in error_lower and "http 403" in error_lower)
    ):
        error_msg += (
            "\n\nDashScope 配额提示：当前文字转语音模型的免费额度已用完，或账号启用了仅使用免费额度。"
            "请在 DashScope 控制台开通付费/关闭 FreeTierOnly，或在播客角色配置中切换到仍有额度的语音模型。"
        )

    if (
        ("failed to generate speech" in error_lower or "tts=" in resolved_model_summary.lower())
        and ("http 404" in error_lower or "404 not found" in error_lower)
    ):
        error_msg += (
            "\n\n语音模型提示：当前文字转语音模型无法在所选供应商端点找到。"
            "请检查播客角色配置里的语音模型是否属于对应 provider，或切换到可用的 TTS 模型。"
            "例如日志中的 tts=openai/mimo-v2.5-tts 通常表示模型名和 OpenAI 端点不匹配，"
            "需要改成 OpenAI 支持的 TTS 模型，或把该模型配置到 Xiaomi MiMo provider。"
        )

    if resolved_model_summary and resolved_model_summary not in error_msg:
        error_msg += f"\n\n{resolved_model_summary}"

    return error_msg


class PodcastGenerationInput(CommandInput):
    episode_profile: str
    speaker_profile: str
    episode_name: str
    content: str
    notebook_id: Optional[str] = None
    briefing_suffix: Optional[str] = None


class PodcastGenerationOutput(CommandOutput):
    success: bool
    episode_id: Optional[str] = None
    audio_file_path: Optional[str] = None
    transcript: Optional[dict] = None
    outline: Optional[dict] = None
    processing_time: float
    error_message: Optional[str] = None


@command("generate_podcast", app="open_notebook", retry={"max_attempts": 1})
async def generate_podcast_command(
    input_data: PodcastGenerationInput,
) -> PodcastGenerationOutput:
    """
    Real podcast generation using podcast-creator library with Episode Profiles
    """
    start_time = time.time()
    register_runtime_ai_providers()
    resolved_model_summary = ""

    try:
        command_id = (
            str(input_data.execution_context.command_id)
            if input_data.execution_context
            else None
        )
        await raise_if_command_canceled(command_id)
        logger.info(
            f"Starting podcast generation for episode: {input_data.episode_name}"
        )
        logger.info(f"Using episode profile: {input_data.episode_profile}")

        # 1. Load Episode and Speaker profiles from SurrealDB
        episode_profile = await EpisodeProfile.get_by_name(input_data.episode_profile)
        if not episode_profile:
            raise ValueError(
                f"Episode profile '{input_data.episode_profile}' not found"
            )

        speaker_profile = await SpeakerProfile.get_by_name(
            episode_profile.speaker_config
        )
        if not speaker_profile:
            raise ValueError(
                f"Speaker profile '{episode_profile.speaker_config}' not found"
            )

        logger.info(f"Loaded episode profile: {episode_profile.name}")
        logger.info(f"Loaded speaker profile: {speaker_profile.name}")

        # 2. Validate that model registry fields are populated
        if not episode_profile.outline_llm:
            raise ValueError(
                f"Episode profile '{episode_profile.name}' has no outline model configured. "
                "Please update the profile to select an outline model."
            )
        if not episode_profile.transcript_llm:
            raise ValueError(
                f"Episode profile '{episode_profile.name}' has no transcript model configured. "
                "Please update the profile to select a transcript model."
            )
        if not speaker_profile.voice_model:
            raise ValueError(
                f"Speaker profile '{speaker_profile.name}' has no voice model configured. "
                "Please update the profile to select a voice model."
            )

        # 3. Resolve model configs with credentials
        outline_provider, outline_model_name, outline_config = (
            await episode_profile.resolve_outline_config()
        )
        transcript_provider, transcript_model_name, transcript_config = (
            await episode_profile.resolve_transcript_config()
        )
        tts_provider, tts_model_name, tts_config = (
            await speaker_profile.resolve_tts_config()
        )

        logger.info(
            f"Resolved models - outline: {outline_provider}/{outline_model_name}, "
            f"transcript: {transcript_provider}/{transcript_model_name}, "
            f"tts: {tts_provider}/{tts_model_name}"
        )
        resolved_model_summary = (
            "Resolved models: "
            f"outline={outline_provider}/{outline_model_name}; "
            f"transcript={transcript_provider}/{transcript_model_name}; "
            f"tts={tts_provider}/{tts_model_name}"
        )

        # 4. Load all profiles and configure podcast-creator
        episode_profiles = await repo_query("SELECT * FROM episode_profile")
        speaker_profiles = await repo_query("SELECT * FROM speaker_profile")

        # Transform the surrealdb array into a dictionary for podcast-creator
        episode_profiles_dict = {
            profile["name"]: profile for profile in episode_profiles
        }
        speaker_profiles_dict = {
            profile["name"]: profile for profile in speaker_profiles
        }

        # 5. Inject resolved model configs into profile dicts
        # Resolve ALL episode profiles (podcast-creator validates all).
        # Remove profiles that fail resolution to prevent validation errors.
        for ep_name in list(episode_profiles_dict.keys()):
            ep_dict = episode_profiles_dict[ep_name]
            try:
                if ep_dict.get("outline_llm"):
                    prov, model, conf = await _resolve_model_config(
                        str(ep_dict["outline_llm"])
                    )
                    ep_dict["outline_provider"] = prov
                    ep_dict["outline_model"] = model
                    ep_dict["outline_config"] = conf
                else:
                    prov, model, conf = await _resolve_default_podcast_model_config(
                        ep_name
                    )
                    ep_dict["outline_provider"] = prov
                    ep_dict["outline_model"] = model
                    ep_dict["outline_config"] = conf
                if ep_dict.get("transcript_llm"):
                    prov, model, conf = await _resolve_model_config(
                        str(ep_dict["transcript_llm"])
                    )
                    ep_dict["transcript_provider"] = prov
                    ep_dict["transcript_model"] = model
                    ep_dict["transcript_config"] = conf
                else:
                    prov, model, conf = await _resolve_default_podcast_model_config(
                        ep_name
                    )
                    ep_dict["transcript_provider"] = prov
                    ep_dict["transcript_model"] = model
                    ep_dict["transcript_config"] = conf
            except Exception as e:
                logger.warning(
                    f"Failed to resolve models for episode profile '{ep_name}', "
                    f"removing from config to prevent validation errors: {e}"
                )
                del episode_profiles_dict[ep_name]

        # Resolve TTS for ALL speaker profiles (podcast-creator validates all).
        # Remove profiles that fail resolution to prevent validation errors.
        for sp_name in list(speaker_profiles_dict.keys()):
            sp_dict = speaker_profiles_dict[sp_name]
            if sp_dict.get("voice_model"):
                try:
                    prov, model, conf = await _resolve_model_config(
                        str(sp_dict["voice_model"])
                    )
                    sp_dict["tts_provider"] = prov
                    sp_dict["tts_model"] = model
                    sp_dict["tts_config"] = conf
                except Exception as e:
                    logger.warning(
                        f"Failed to resolve TTS for speaker profile '{sp_name}', "
                        f"removing from config to prevent validation errors: {e}"
                    )
                    del speaker_profiles_dict[sp_name]
                    continue

            # Per-speaker TTS overrides
            for speaker in sp_dict.get("speakers", []):
                if speaker.get("voice_model"):
                    try:
                        prov, model, conf = await _resolve_model_config(
                            str(speaker["voice_model"])
                        )
                        speaker["tts_provider"] = prov
                        speaker["tts_model"] = model
                        speaker["tts_config"] = conf
                    except Exception as e:
                        logger.warning(
                            f"Failed to resolve per-speaker TTS for '{speaker.get('name')}': {e}"
                        )

        # 6. Generate briefing
        briefing = episode_profile.default_briefing
        if input_data.briefing_suffix:
            briefing += f"\n\nAdditional instructions: {input_data.briefing_suffix}"

        episode_profile_snapshot = full_model_dump(episode_profile.model_dump())
        episode_profile_snapshot.update(
            {
                "outline_provider": outline_provider,
                "outline_model": outline_model_name,
                "transcript_provider": transcript_provider,
                "transcript_model": transcript_model_name,
            }
        )
        speaker_profile_snapshot = full_model_dump(speaker_profile.model_dump())
        speaker_profile_snapshot.update(
            {
                "tts_provider": tts_provider,
                "tts_model": tts_model_name,
            }
        )

        # Create the record for the episode and associate with the ongoing command
        episode = PodcastEpisode(
            name=input_data.episode_name,
            episode_profile=episode_profile_snapshot,
            speaker_profile=speaker_profile_snapshot,
            command=ensure_record_id(input_data.execution_context.command_id)
            if input_data.execution_context
            else None,
            briefing=briefing,
            content=input_data.content,
            notebook_id=input_data.notebook_id,
            audio_file=None,
            transcript=None,
            outline=None,
        )
        await episode.save()

        configure("speakers_config", {"profiles": speaker_profiles_dict})
        configure("episode_config", {"profiles": episode_profiles_dict})

        logger.info("Configured podcast-creator with episode and speaker profiles")

        logger.info(f"Generated briefing (length: {len(briefing)} chars)")

        # 7. Create output directory using UUID for filesystem-safe paths
        episode_dir_name, output_dir = build_episode_output_dir(DATA_FOLDER)
        output_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"Created output directory: {output_dir}")

        # 8. Generate podcast using podcast-creator
        logger.info("Starting podcast generation with podcast-creator...")
        await raise_if_command_canceled(command_id)

        result = await create_podcast_with_repair(
            content=input_data.content,
            briefing=briefing,
            episode_name=episode_dir_name,
            output_dir=str(output_dir),
            speaker_config=speaker_profile.name,
            episode_profile=episode_profile.name,
        )
        await raise_if_command_canceled(command_id)

        episode.audio_file = (
            str(result.get("final_output_file_path")) if result else None
        )
        timestamped_transcript = (
            build_timestamped_transcript(
                result.get("transcript"),
                result.get("audio_clips"),
            )
            if result and result.get("transcript")
            else None
        )
        episode.transcript = {
            "transcript": timestamped_transcript
        }
        episode.outline = full_model_dump(result["outline"]) if result else None
        await episode.save()

        processing_time = time.time() - start_time
        logger.info(
            f"Successfully generated podcast episode: {episode.id} in {processing_time:.2f}s"
        )

        return PodcastGenerationOutput(
            success=True,
            episode_id=str(episode.id),
            audio_file_path=str(result.get("final_output_file_path"))
            if result
            else None,
            transcript={"transcript": timestamped_transcript}
            if timestamped_transcript
            else None,
            outline=full_model_dump(result["outline"])
            if result.get("outline")
            else None,
            processing_time=processing_time,
        )

    except ValueError:
        raise

    except Exception as e:
        logger.error(f"Podcast generation failed: {e}")
        logger.exception(e)

        raise RuntimeError(
            build_podcast_error_message(e, resolved_model_summary)
        ) from e
