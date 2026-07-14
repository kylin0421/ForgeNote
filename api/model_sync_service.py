"""Model setting synchronization helpers."""

from typing import Optional

from forgenote.ai.model_specs import build_model_runtime_spec
from forgenote.ai.models import Model
from forgenote.database.repository import ensure_record_id, repo_query


BUILT_IN_SPEAKER_PROFILE_NAMES = ["business_panel", "solo_expert", "tech_experts"]
BUILT_IN_EPISODE_PROFILE_NAMES = [
    "business_analysis",
    "solo_expert",
    "tech_discussion",
]


async def sync_speaker_profiles_to_tts(
    model_id: Optional[str],
    previous_model_id: Optional[str] = None,
) -> None:
    """Sync default TTS into speaker profiles managed by model settings.

    Built-in podcast speaker profiles are always managed by the default TTS
    setting. Custom profiles are synchronized only when they are unconfigured
    or still point to the previous default, so explicit custom overrides are
    preserved.
    """
    if not model_id:
        return

    model = await Model.get(model_id)
    spec = build_model_runtime_spec(model.provider, model.type, model.name)

    where_clause = "name IN $profile_names OR voice_model IS NONE"
    params = {
        "model_id": ensure_record_id(model_id),
        "runtime_provider": spec.runtime_provider,
        "model_name": model.name,
        "profile_names": BUILT_IN_SPEAKER_PROFILE_NAMES,
    }
    if previous_model_id:
        where_clause += " OR voice_model = $previous_model_id"
        params["previous_model_id"] = ensure_record_id(previous_model_id)

    await repo_query(
        f"""
        UPDATE speaker_profile
        SET
            voice_model = $model_id,
            tts_provider = $runtime_provider,
            tts_model = $model_name
        WHERE {where_clause}
        """,
        params,
    )


async def sync_episode_profiles_to_podcast_model(
    model_id: Optional[str],
    previous_model_id: Optional[str] = None,
) -> None:
    """Sync default podcast model into built-in episode profiles.

    Built-in podcast episode profiles are managed by the default podcast
    model setting. Custom profiles are synchronized only when they are
    unconfigured or still point to the previous default, preserving explicit
    custom overrides.
    """
    if not model_id:
        return

    where_clause = """
        name IN $profile_names
        OR outline_llm IS NONE
        OR transcript_llm IS NONE
    """
    params = {
        "model_id": ensure_record_id(model_id),
        "profile_names": BUILT_IN_EPISODE_PROFILE_NAMES,
    }
    if previous_model_id:
        where_clause += """
            OR outline_llm = $previous_model_id
            OR transcript_llm = $previous_model_id
        """
        params["previous_model_id"] = ensure_record_id(previous_model_id)

    await repo_query(
        f"""
        UPDATE episode_profile
        SET
            outline_llm = $model_id,
            transcript_llm = $model_id,
            outline_provider = NONE,
            outline_model = NONE,
            transcript_provider = NONE,
            transcript_model = NONE
        WHERE {where_clause}
        """,
        params,
    )
