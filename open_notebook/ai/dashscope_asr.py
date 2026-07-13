"""DashScope/Qwen speech-to-text provider for Esperanto."""

import base64
import os
from pathlib import Path
from typing import Any, BinaryIO, Dict, List, Optional, Union

import httpx

from esperanto.common_types import Model, TranscriptionResponse
from esperanto.providers.stt.base import SpeechToTextModel


def normalize_dashscope_compatible_base_url(base_url: Optional[str]) -> str:
    """Return the DashScope OpenAI-compatible base URL."""
    if not base_url:
        return "https://dashscope.aliyuncs.com/compatible-mode/v1"
    value = base_url.rstrip("/")
    if value.endswith("/models"):
        value = value[: -len("/models")]
    return value


class DashScopeSpeechToTextModel(SpeechToTextModel):
    """Qwen ASR adapter using DashScope's OpenAI-compatible chat API."""

    def __init__(
        self,
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None,
        **kwargs,
    ):
        config = dict(config or {})
        config.update(kwargs)

        self.model_name = model_name or self._get_default_model()
        self.api_key = (
            api_key
            or config.get("api_key")
            or os.getenv("DASHSCOPE_API_KEY")
            or os.getenv("OPENAI_COMPATIBLE_API_KEY_STT")
            or os.getenv("OPENAI_COMPATIBLE_API_KEY")
        )
        if not self.api_key:
            raise ValueError("DashScope API key not found")

        self.base_url = normalize_dashscope_compatible_base_url(
            base_url
            or config.get("base_url")
            or os.getenv("OPENAI_COMPATIBLE_BASE_URL_STT")
            or os.getenv("OPENAI_COMPATIBLE_BASE_URL")
        )
        self.timeout = config.get("timeout", 300.0)
        self.config = {
            key: value
            for key, value in config.items()
            if key not in {"api_key", "base_url", "timeout"}
        }
        self._config = {"model_name": self.model_name, **self.config}
        self._create_http_clients()

    @property
    def provider(self) -> str:
        return "dashscope-asr"

    def _get_default_model(self) -> str:
        return "qwen3-asr-flash"

    def _get_models(self) -> List[Model]:
        return [
            Model(
                id=self.model_name or self._get_default_model(),
                owned_by="dashscope",
                context_window=None,
            )
        ]

    def _get_headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _read_audio(self, audio_file: Union[str, BinaryIO]) -> str:
        if isinstance(audio_file, str):
            path = Path(audio_file)
            data = path.read_bytes()
            suffix = path.suffix.lower().lstrip(".")
        else:
            position = None
            try:
                position = audio_file.tell()
            except Exception:
                pass
            data = audio_file.read()
            if position is not None:
                try:
                    audio_file.seek(position)
                except Exception:
                    pass
            suffix = Path(getattr(audio_file, "name", "audio.mp3") or "audio.mp3").suffix.lower().lstrip(".")

        audio_format = (suffix or "mp3").lower()
        mime_type = {
            "mp3": "audio/mpeg",
            "mpeg": "audio/mpeg",
            "wav": "audio/wav",
            "m4a": "audio/mp4",
            "mp4": "audio/mp4",
            "flac": "audio/flac",
            "ogg": "audio/ogg",
            "webm": "audio/webm",
        }.get(audio_format, f"audio/{audio_format}")
        encoded = base64.b64encode(data).decode("ascii")
        return f"data:{mime_type};base64,{encoded}"

    def _payload(
        self,
        audio_file: Union[str, BinaryIO],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> Dict[str, Any]:
        audio_data = self._read_audio(audio_file)
        asr_options: Dict[str, Any] = {"enable_itn": True}
        if language:
            asr_options["language"] = language

        payload: Dict[str, Any] = {
            "model": self.get_model_name(),
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "input_audio",
                            "input_audio": {
                                "data": audio_data,
                            },
                        },
                    ],
                }
            ],
            "stream": False,
            "asr_options": asr_options,
        }
        if prompt:
            payload["asr_options"]["context"] = prompt
        return payload

    def _handle_error(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            data = response.json()
            message = (
                data.get("error", {}).get("message")
                or data.get("message")
                or data.get("code")
                or response.text
            )
        except Exception:
            message = response.text
        raise RuntimeError(f"DashScope ASR API error: HTTP {response.status_code}: {message}")

    def _build_response(self, data: Dict[str, Any], language: Optional[str]) -> TranscriptionResponse:
        choices = data.get("choices") or []
        message = (choices[0].get("message") if choices else {}) or {}
        content = message.get("content") or data.get("text") or ""
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    parts.append(str(item.get("text") or item.get("content") or ""))
                else:
                    parts.append(str(item))
            content = "".join(parts)

        return TranscriptionResponse(
            text=str(content).strip(),
            language=language,
            model=self.get_model_name(),
            provider=self.provider,
        )

    def transcribe(
        self,
        audio_file: Union[str, BinaryIO],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> TranscriptionResponse:
        response = self.client.post(
            f"{self.base_url}/chat/completions",
            headers=self._get_headers(),
            json=self._payload(audio_file, language, prompt),
        )
        self._handle_error(response)
        return self._build_response(response.json(), language)

    async def atranscribe(
        self,
        audio_file: Union[str, BinaryIO],
        language: Optional[str] = None,
        prompt: Optional[str] = None,
    ) -> TranscriptionResponse:
        response = await self.async_client.post(
            f"{self.base_url}/chat/completions",
            headers=self._get_headers(),
            json=self._payload(audio_file, language, prompt),
        )
        self._handle_error(response)
        return self._build_response(response.json(), language)
