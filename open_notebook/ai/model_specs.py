"""Model runtime specification helpers.

The model table stores the user-facing provider, model name, and modality.
Runtime callers need a little more detail: which Esperanto provider to
instantiate, which API protocol is actually being used, and whether a model is
compatible with batch workflows such as podcast TTS.
"""

from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional


DASHSCOPE_TTS_PROVIDER = "dashscope"
DASHSCOPE_TTS_CLASS = "open_notebook.ai.dashscope_tts:DashScopeTextToSpeechModel"
MIMO_TTS_PROVIDER = "mimo"
MIMO_TTS_CLASS = "open_notebook.ai.mimo_tts:MiMoTextToSpeechModel"

QWEN_TTS_PREFIXES = ("qwen3-tts", "qwen-tts", "cosyvoice")
QWEN_ASR_PREFIXES = ("qwen3-asr", "qwen-asr")
MIMO_TTS_PREFIXES = ("mimo-v2.5-tts", "mimo-tts")
DASHSCOPE_BATCH_TTS_PREFIXES = (
    "qwen3-tts-flash",
    "qwen3-tts-instruct-flash",
    "qwen-tts",
    "qwen-tts-latest",
    "cosyvoice",
)


@dataclass(frozen=True)
class ModelRuntimeSpec:
    """Resolved runtime model metadata returned by APIs and used by callers."""

    provider: str
    runtime_provider: str
    api_protocol: str
    model_type: str
    model_name: str
    batch_tts_supported: bool = True
    warnings: Optional[List[str]] = None

    def __post_init__(self) -> None:
        if self.warnings is None:
            object.__setattr__(self, "warnings", [])

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def normalize_runtime_provider(provider: str) -> str:
    """Normalize stored provider IDs to Esperanto provider IDs."""
    provider = (provider or "").strip().lower()
    if provider == "openai_compatible":
        return "openai-compatible"
    return provider.replace("_", "-")


def _name(model_name: str) -> str:
    return (model_name or "").strip().lower()


def _base_url(config: Optional[Dict[str, Any]]) -> str:
    return str((config or {}).get("base_url") or "").lower()


def looks_like_dashscope_tts(model_name: str, config: Optional[Dict[str, Any]] = None) -> bool:
    """Return True when a TTS model should use the DashScope native adapter."""
    name = _name(model_name)
    if name.startswith(QWEN_TTS_PREFIXES):
        return True
    base_url = _base_url(config)
    return "dashscope.aliyuncs.com" in base_url or "maas.aliyuncs.com" in base_url


def looks_like_mimo_tts(model_name: str, config: Optional[Dict[str, Any]] = None) -> bool:
    """Return True when a TTS model should use the Xiaomi MiMo adapter."""
    name = _name(model_name)
    if name.startswith(MIMO_TTS_PREFIXES) or (name.startswith("mimo") and "tts" in name):
        return True
    return "xiaomimimo.com" in _base_url(config)


def infer_provider_specific_model_type(model_name: str, provider: str) -> Optional[str]:
    """Classify cross-provider models whose names reveal modality.

    Some marketplaces expose Qwen audio models through OpenAI-compatible model
    listings. Classifying these before provider-generic rules prevents them from
    being registered as language models.
    """
    name = _name(model_name)
    provider = (provider or "").strip().lower()
    if provider in {"openai", "openai_compatible", "dashscope", "mimo"}:
        if name.startswith(MIMO_TTS_PREFIXES) or (name.startswith("mimo") and "tts" in name):
            return "text_to_speech"
        if name.startswith(QWEN_ASR_PREFIXES):
            return "speech_to_text"
        if name.startswith(QWEN_TTS_PREFIXES):
            return "text_to_speech"
    return None


def _dashscope_tts_protocol(model_name: str) -> tuple[str, bool, List[str]]:
    name = _name(model_name)
    warnings: List[str] = []

    if "-vc" in name:
        warnings.append(
            "This looks like a DashScope voice-conversion model; podcast TTS expects text-to-speech."
        )
        return "dashscope-voice-conversion", False, warnings

    if "-vd" in name:
        warnings.append(
            "This looks like a DashScope video-dubbing model; podcast TTS expects text-to-speech."
        )
        return "dashscope-video-dubbing", False, warnings

    if "realtime" in name:
        return "dashscope-realtime-tts", True, warnings

    if name.startswith(DASHSCOPE_BATCH_TTS_PREFIXES):
        return "dashscope-http-tts", True, warnings

    warnings.append(
        "This Qwen/CosyVoice TTS model is routed to DashScope, but batch podcast compatibility is unknown."
    )
    return "dashscope-http-tts", True, warnings


def build_model_runtime_spec(
    provider: str,
    model_type: str,
    model_name: str,
    config: Optional[Dict[str, Any]] = None,
) -> ModelRuntimeSpec:
    """Resolve stored model fields into a runtime model spec."""
    stored_provider = (provider or "").strip().lower()
    runtime_provider = normalize_runtime_provider(stored_provider)
    api_protocol = runtime_provider
    batch_tts_supported = True
    warnings: List[str] = []

    if model_type == "text_to_speech" and looks_like_mimo_tts(model_name, config):
        runtime_provider = MIMO_TTS_PROVIDER
        api_protocol = "mimo-chat-audio-tts"
    elif model_type == "text_to_speech" and looks_like_dashscope_tts(model_name, config):
        runtime_provider = DASHSCOPE_TTS_PROVIDER
        api_protocol, batch_tts_supported, warnings = _dashscope_tts_protocol(model_name)
    elif stored_provider == "azure":
        api_protocol = "azure-openai"
    elif stored_provider == "openai_compatible":
        api_protocol = "openai-compatible"
    elif stored_provider == "dashscope":
        api_protocol = "dashscope-compatible"

    return ModelRuntimeSpec(
        provider=stored_provider,
        runtime_provider=runtime_provider,
        api_protocol=api_protocol,
        model_type=model_type,
        model_name=model_name,
        batch_tts_supported=batch_tts_supported,
        warnings=warnings,
    )
