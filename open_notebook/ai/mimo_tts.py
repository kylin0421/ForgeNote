"""Xiaomi MiMo text-to-speech provider for Esperanto."""

import base64
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import httpx

from esperanto.providers.tts.base import AudioResponse, Model, TextToSpeechModel, Voice


MIMO_DEFAULT_BASE_URL = "https://api.xiaomimimo.com/v1"

MIMO_TTS_VOICES: Dict[str, Voice] = {
    "mimo_default": Voice(
        name="MiMo default",
        id="mimo_default",
        gender="UNSPECIFIED",
        language_code="multilingual",
        description="Cluster default voice",
    ),
    "冰糖": Voice(
        name="冰糖",
        id="冰糖",
        gender="FEMALE",
        language_code="zh",
        description="Chinese female voice",
    ),
    "茉莉": Voice(
        name="茉莉",
        id="茉莉",
        gender="FEMALE",
        language_code="zh",
        description="Chinese female voice",
    ),
    "苏打": Voice(
        name="苏打",
        id="苏打",
        gender="MALE",
        language_code="zh",
        description="Chinese male voice",
    ),
    "白桦": Voice(
        name="白桦",
        id="白桦",
        gender="MALE",
        language_code="zh",
        description="Chinese male voice",
    ),
    "Mia": Voice(
        name="Mia",
        id="Mia",
        gender="FEMALE",
        language_code="en",
        description="English female voice",
    ),
    "Chloe": Voice(
        name="Chloe",
        id="Chloe",
        gender="FEMALE",
        language_code="en",
        description="English female voice",
    ),
    "Milo": Voice(
        name="Milo",
        id="Milo",
        gender="MALE",
        language_code="en",
        description="English male voice",
    ),
    "Dean": Voice(
        name="Dean",
        id="Dean",
        gender="MALE",
        language_code="en",
        description="English male voice",
    ),
}

OPENAI_TO_MIMO_VOICE = {
    "alloy": "mimo_default",
    "nova": "冰糖",
    "shimmer": "茉莉",
    "coral": "Chloe",
    "echo": "苏打",
    "onyx": "白桦",
    "fable": "Mia",
    "ash": "Dean",
    "ballad": "Mia",
    "sage": "Dean",
    "verse": "Milo",
}


def normalize_mimo_base_url(base_url: Optional[str]) -> str:
    """Normalize MiMo base URLs to the OpenAI-compatible /v1 root."""
    if not base_url:
        return MIMO_DEFAULT_BASE_URL

    normalized = base_url.rstrip("/")
    if normalized.endswith("/chat/completions"):
        normalized = normalized[: -len("/chat/completions")]
    if normalized.endswith("/v1"):
        return normalized
    return f"{normalized}/v1"


class MiMoTextToSpeechModel(TextToSpeechModel):
    """Xiaomi MiMo TTS provider using the chat completions audio protocol."""

    PROVIDER = "mimo"
    DEFAULT_MODEL = "mimo-v2.5-tts"
    DEFAULT_VOICE = "mimo_default"
    DEFAULT_FORMAT = "wav"

    def __init__(
        self,
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs: Any,
    ):
        api_key = (
            api_key
            or os.getenv("MIMO_API_KEY")
            or os.getenv("XIAOMI_MIMO_API_KEY")
        )
        if not api_key:
            raise ValueError(
                "MiMo API key not found. Configure a credential or set MIMO_API_KEY."
            )

        super().__init__(
            model_name=model_name or self.DEFAULT_MODEL,
            api_key=api_key,
            base_url=normalize_mimo_base_url(base_url),
            config=kwargs,
        )
        self.base_url = normalize_mimo_base_url(self.base_url)
        self._create_http_clients()

    @property
    def provider(self) -> str:
        return self.PROVIDER

    @property
    def available_voices(self) -> Dict[str, Voice]:
        voices = dict(MIMO_TTS_VOICES)
        for alias, target in OPENAI_TO_MIMO_VOICE.items():
            target_voice = voices[target]
            voices[alias] = Voice(
                name=f"{alias} ({target_voice.name})",
                id=alias,
                gender=target_voice.gender,
                language_code=target_voice.language_code,
                description=f"Alias mapped to MiMo voice {target_voice.id}",
            )
        return voices

    def _get_models(self) -> List[Model]:
        return [
            Model(
                id="mimo-v2.5-tts",
                owned_by="xiaomi",
                context_window=None,
                type="text_to_speech",
            ),
            Model(
                id="mimo-v2.5-tts-voicedesign",
                owned_by="xiaomi",
                context_window=None,
                type="text_to_speech",
            ),
            Model(
                id="mimo-v2.5-tts-voiceclone",
                owned_by="xiaomi",
                context_window=None,
                type="text_to_speech",
            ),
        ]

    def _generation_url(self) -> str:
        return f"{self.base_url}/chat/completions"

    def _headers(self) -> Dict[str, str]:
        return {
            "api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def _resolve_voice(self, voice: Optional[str]) -> str:
        if not voice:
            return self.DEFAULT_VOICE
        voice = str(voice).strip()
        return OPENAI_TO_MIMO_VOICE.get(voice, OPENAI_TO_MIMO_VOICE.get(voice.lower(), voice))

    def _is_voice_design_model(self) -> bool:
        return "voicedesign" in (self.model_name or "").lower()

    def _is_voice_clone_model(self) -> bool:
        return "voiceclone" in (self.model_name or "").lower()

    def _build_payload(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        response_format = kwargs.pop(
            "response_format",
            kwargs.pop("format", self._config.get("response_format", self.DEFAULT_FORMAT)),
        )
        instruction = (
            kwargs.pop("instructions", None)
            or kwargs.pop("style", None)
            or self._config.get("instructions")
            or self._config.get("style")
        )

        messages = []
        if instruction:
            messages.append({"role": "user", "content": str(instruction)})
        elif self._is_voice_design_model():
            voice_prompt = kwargs.pop("voice_prompt", None) or voice
            messages.append({"role": "user", "content": str(voice_prompt or "")})

        messages.append({"role": "assistant", "content": text})

        audio: Dict[str, Any] = {"format": response_format}
        if not self._is_voice_design_model():
            audio["voice"] = self._resolve_voice(voice)
        if self._is_voice_clone_model() and not str(audio.get("voice", "")).startswith("data:"):
            raise ValueError(
                "MiMo voiceclone requires voice to be a data:{MIME_TYPE};base64,... audio sample."
            )

        for key in ("speed", "optimize_text_preview"):
            if key in kwargs:
                audio[key] = kwargs.pop(key)

        payload: Dict[str, Any] = {
            "model": self.model_name or self.DEFAULT_MODEL,
            "messages": messages,
            "audio": audio,
        }
        payload.update(kwargs)
        return payload

    def _handle_error(self, response: httpx.Response) -> None:
        if response.status_code < 400:
            return
        try:
            body = response.json()
            message = body.get("message") or body.get("error", {}).get("message")
            code = body.get("code") or body.get("error", {}).get("code")
            detail = f"{code}: {message}" if code and message else message or body
        except Exception:
            detail = response.text or f"HTTP {response.status_code}"
        raise RuntimeError(f"MiMo API error: HTTP {response.status_code}: {detail}")

    def _audio_from_response(self, data: Dict[str, Any]) -> tuple[bytes, str]:
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError(f"MiMo response did not contain choices: {data}")

        choice = choices[0] or {}
        message = choice.get("message") or choice.get("delta") or {}
        audio = message.get("audio") or choice.get("audio") or {}
        encoded_audio = audio.get("data")
        if not encoded_audio:
            raise RuntimeError(f"MiMo response did not contain audio data: {data}")

        audio_format = str(audio.get("format") or self.DEFAULT_FORMAT).lower()
        content_type = {
            "wav": "audio/wav",
            "mp3": "audio/mpeg",
            "mpeg": "audio/mpeg",
            "pcm16": "audio/L16",
        }.get(audio_format, f"audio/{audio_format}")
        return base64.b64decode(encoded_audio), content_type

    def _post_generation(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = self.client.post(
            self._generation_url(),
            headers=self._headers(),
            json=payload,
        )
        self._handle_error(response)
        return response.json()

    async def _apost_generation(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        response = await self.async_client.post(
            self._generation_url(),
            headers=self._headers(),
            json=payload,
        )
        self._handle_error(response)
        return response.json()

    def _save_output(self, output_file: Optional[Union[str, Path]], audio_bytes: bytes) -> None:
        if not output_file:
            return
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(audio_bytes)

    def _response(
        self,
        audio_bytes: bytes,
        content_type: str,
        voice: Optional[str],
        metadata: Dict[str, Any],
    ) -> AudioResponse:
        return AudioResponse(
            audio_data=audio_bytes,
            content_type=content_type,
            model=self.model_name,
            voice=self._resolve_voice(voice),
            provider=self.PROVIDER,
            metadata=metadata,
        )

    def generate_speech(
        self,
        text: str,
        voice: Optional[str] = None,
        output_file: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> AudioResponse:
        try:
            self.validate_parameters(text, voice or self.DEFAULT_VOICE, self.model_name)
            payload = self._build_payload(text, voice, dict(kwargs))
            data = self._post_generation(payload)
            audio_bytes, content_type = self._audio_from_response(data)
            self._save_output(output_file, audio_bytes)
            return self._response(
                audio_bytes,
                content_type,
                voice,
                {"request": payload, "response": data},
            )
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Failed to generate speech: {e}") from e

    async def agenerate_speech(
        self,
        text: str,
        voice: Optional[str] = None,
        output_file: Optional[Union[str, Path]] = None,
        **kwargs: Any,
    ) -> AudioResponse:
        try:
            self.validate_parameters(text, voice or self.DEFAULT_VOICE, self.model_name)
            payload = self._build_payload(text, voice, dict(kwargs))
            data = await self._apost_generation(payload)
            audio_bytes, content_type = self._audio_from_response(data)
            self._save_output(output_file, audio_bytes)
            return self._response(
                audio_bytes,
                content_type,
                voice,
                {"request": payload, "response": data},
            )
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Failed to generate speech: {e}") from e
