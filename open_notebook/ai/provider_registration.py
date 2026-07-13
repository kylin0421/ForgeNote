"""Runtime AI provider registration and provider routing helpers."""

from esperanto import AIFactory

from open_notebook.ai.model_specs import (
    DASHSCOPE_ASR_CLASS,
    DASHSCOPE_ASR_PROVIDER,
    DASHSCOPE_TTS_CLASS,
    DASHSCOPE_TTS_PROVIDER,
    MIMO_TTS_CLASS,
    MIMO_TTS_PROVIDER,
    build_model_runtime_spec,
)


def register_runtime_ai_providers() -> None:
    """Register ZhiXue-local providers with Esperanto."""
    stt_providers = AIFactory._provider_modules.setdefault("speech_to_text", {})
    stt_providers[DASHSCOPE_ASR_PROVIDER] = DASHSCOPE_ASR_CLASS

    tts_providers = AIFactory._provider_modules.setdefault("text_to_speech", {})
    tts_providers[DASHSCOPE_TTS_PROVIDER] = DASHSCOPE_TTS_CLASS
    tts_providers[MIMO_TTS_PROVIDER] = MIMO_TTS_CLASS


def resolve_runtime_provider(
    provider: str,
    model_type: str,
    model_name: str,
    config: dict | None = None,
) -> str:
    """Map stored model providers to the provider Esperanto must instantiate."""
    register_runtime_ai_providers()
    return build_model_runtime_spec(
        provider=provider,
        model_type=model_type,
        model_name=model_name,
        config=config,
    ).runtime_provider
