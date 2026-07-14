"""DashScope/Qwen text-to-speech provider for Esperanto."""

import asyncio
import base64
import io
import json
import os
import re
import uuid
import wave
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx

from esperanto.providers.tts.base import AudioResponse, Model, TextToSpeechModel, Voice

from forgenote.ai.model_specs import build_model_runtime_spec


DASHSCOPE_TTS_VOICES: Dict[str, Voice] = {
    "Cherry": Voice(
        name="Cherry",
        id="Cherry",
        gender="FEMALE",
        language_code="multilingual",
        description="Sunny, positive, friendly, and natural young woman",
    ),
    "Serena": Voice(
        name="Serena",
        id="Serena",
        gender="FEMALE",
        language_code="multilingual",
        description="Gentle young woman",
    ),
    "Ethan": Voice(
        name="Ethan",
        id="Ethan",
        gender="MALE",
        language_code="multilingual",
        description="Warm, energetic, and vibrant male voice",
    ),
    "Chelsie": Voice(
        name="Chelsie",
        id="Chelsie",
        gender="FEMALE",
        language_code="multilingual",
        description="Animated virtual girlfriend style",
    ),
    "Maia": Voice(
        name="Maia",
        id="Maia",
        gender="FEMALE",
        language_code="multilingual",
        description="Intellectual and gentle female voice",
    ),
    "Kai": Voice(
        name="Kai",
        id="Kai",
        gender="MALE",
        language_code="multilingual",
        description="Soothing male voice",
    ),
    "Ryan": Voice(
        name="Ryan",
        id="Ryan",
        gender="MALE",
        language_code="multilingual",
        description="Rhythmic and dramatic male voice",
    ),
    "Neil": Voice(
        name="Neil",
        id="Neil",
        gender="MALE",
        language_code="multilingual",
        description="Clear professional anchor voice",
    ),
}

OPENAI_TO_DASHSCOPE_VOICE = {
    "alloy": "Cherry",
    "nova": "Cherry",
    "shimmer": "Serena",
    "echo": "Ethan",
    "onyx": "Ryan",
    "fable": "Maia",
    "ash": "Ethan",
    "ballad": "Maia",
    "coral": "Cherry",
    "sage": "Neil",
    "verse": "Kai",
}

CJK_RE = re.compile(f"[{chr(0x4E00)}-{chr(0x9FFF)}]")
SENTENCE_SPLIT_RE = re.compile(r"[^。！？!?；;\n]+[。！？!?；;]?\s*|\n+")
SOFT_SPLIT_RE = re.compile(r"[^，,、:：\n]+[，,、:：]?\s*|\n+")


def normalize_dashscope_base_url(base_url: Optional[str]) -> str:
    """Convert OpenAI-compatible Model Studio URLs to DashScope HTTP URLs."""
    if not base_url:
        return "https://dashscope.aliyuncs.com/api/v1"

    normalized = base_url.rstrip("/")
    if normalized.startswith(("ws://", "wss://")):
        return normalized
    if "/compatible-mode/v1" in normalized:
        return normalized.replace("/compatible-mode/v1", "/api/v1")
    if normalized.endswith("/api/v1"):
        return normalized
    if normalized.endswith("/api"):
        return f"{normalized}/v1"
    if "/api/v1/" in normalized:
        return normalized.split("/api/v1/", 1)[0] + "/api/v1"
    return f"{normalized}/api/v1"


class DashScopeTextToSpeechModel(TextToSpeechModel):
    """DashScope TTS provider for Qwen batch and realtime models."""

    PROVIDER = "dashscope"
    DEFAULT_MODEL = "qwen3-tts-flash"
    DEFAULT_VOICE = "Cherry"
    DEFAULT_LANGUAGE_TYPE = "Auto"
    DEFAULT_MAX_AUDIO_ATTEMPTS = 4
    DEFAULT_MAX_INPUT_CHARS = 520
    REALTIME_SAMPLE_RATE = 24000
    REALTIME_CHANNELS = 1
    REALTIME_SAMPLE_WIDTH = 2

    def __init__(
        self,
        model_name: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        **kwargs: Any,
    ):
        api_key = api_key or os.getenv("DASHSCOPE_API_KEY")
        if not api_key:
            raise ValueError(
                "DashScope API key not found. Configure a credential or set DASHSCOPE_API_KEY."
            )

        super().__init__(
            model_name=model_name or self.DEFAULT_MODEL,
            api_key=api_key,
            base_url=normalize_dashscope_base_url(base_url),
            config=kwargs,
        )
        self.base_url = normalize_dashscope_base_url(self.base_url)
        self._create_http_clients()

    @property
    def provider(self) -> str:
        return self.PROVIDER

    @property
    def available_voices(self) -> Dict[str, Voice]:
        voices = dict(DASHSCOPE_TTS_VOICES)
        for alias, target in OPENAI_TO_DASHSCOPE_VOICE.items():
            target_voice = voices[target]
            voices[alias] = Voice(
                name=f"{alias} ({target_voice.name})",
                id=alias,
                gender=target_voice.gender,
                language_code=target_voice.language_code,
                description=f"Alias mapped to DashScope voice {target_voice.id}",
            )
        return voices

    def _get_models(self) -> List[Model]:
        return [
            Model(id="qwen3-tts-flash", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen3-tts-flash-realtime", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen3-tts-instruct-flash", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen3-tts-instruct-flash-realtime", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen-tts", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen-tts-realtime", owned_by="alibaba", context_window=None, type="text_to_speech"),
            Model(id="qwen-tts-latest", owned_by="alibaba", context_window=None, type="text_to_speech"),
        ]

    def _generation_url(self) -> str:
        return f"{self.base_url}/services/aigc/multimodal-generation/generation"

    def _runtime_spec(self):
        return build_model_runtime_spec(
            "dashscope",
            "text_to_speech",
            self.model_name or self.DEFAULT_MODEL,
            {"base_url": self.base_url},
        )

    def _ensure_supported_tts_model(self):
        spec = self._runtime_spec()
        if not spec.batch_tts_supported:
            detail = " ".join(spec.warnings) or spec.api_protocol
            raise RuntimeError(
                f"Model '{self.model_name}' uses {spec.api_protocol}, which is not "
                f"compatible with the podcast TTS pipeline. {detail} "
                "Choose qwen3-tts-flash, qwen3-tts-instruct-flash, or their "
                "ordinary -realtime variants for podcasts."
            )
        return spec

    def _is_realtime_model(self) -> bool:
        return self._runtime_spec().api_protocol == "dashscope-realtime-tts"

    def _headers(self) -> Dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _event(self, event_type: str, **payload: Any) -> Dict[str, Any]:
        return {
            "event_id": f"event_{uuid.uuid4().hex}",
            "type": event_type,
            **payload,
        }

    def _realtime_url(self, model_name: Optional[str] = None) -> str:
        resolved_model = model_name or self.model_name or self.DEFAULT_MODEL
        parsed = urlparse(self.base_url)
        scheme = "wss" if parsed.scheme in {"", "http", "https", "wss"} else "ws"
        path = parsed.path or ""
        if "/api-ws/v1/realtime" in path:
            path = path.split("/api-ws/v1/realtime", 1)[0] + "/api-ws/v1/realtime"
        else:
            path = "/api-ws/v1/realtime"

        query = dict(parse_qsl(parsed.query, keep_blank_values=True))
        query["model"] = resolved_model
        return urlunparse((scheme, parsed.netloc, path, "", urlencode(query), ""))

    def _realtime_headers(self) -> Dict[str, str]:
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "user-agent": "ForgeNote/1.0",
        }
        workspace = (
            self._config.get("workspace_id")
            or self._config.get("workspace")
            or self._config.get("dashscope_workspace")
            or self._config.get("dashscope_workspace_id")
            or self._config.get("X-DashScope-WorkSpace")
        )
        if workspace:
            headers["X-DashScope-WorkSpace"] = str(workspace)
        return headers

    def _build_realtime_session(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
    ) -> Dict[str, Any]:
        mode = kwargs.pop("realtime_mode", kwargs.pop("mode", "commit"))
        session: Dict[str, Any] = {
            "voice": self._resolve_voice(voice),
            "mode": mode,
            "language_type": kwargs.pop("language_type", self._infer_language_type(text)),
            "response_format": "pcm",
            "sample_rate": self.REALTIME_SAMPLE_RATE,
        }

        model_name = (self.model_name or self.DEFAULT_MODEL).lower()
        instructions = kwargs.pop("instructions", None)
        optimize_instructions = kwargs.pop("optimize_instructions", None)
        if instructions and "instruct" in model_name:
            session["instructions"] = instructions
            if optimize_instructions is not None:
                session["optimize_instructions"] = bool(optimize_instructions)

        # Qwen realtime only supports PCM/24k for ordinary realtime models. Drop
        # batch-only controls so OpenAI-style kwargs do not fail validation.
        for key in (
            "response_format",
            "sample_rate",
            "speech_rate",
            "volume",
            "pitch_rate",
            "seed",
        ):
            kwargs.pop(key, None)
        return session

    def _wav_from_pcm(
        self,
        pcm_bytes: bytes,
        sample_rate: int = REALTIME_SAMPLE_RATE,
        channels: int = REALTIME_CHANNELS,
        sample_width: int = REALTIME_SAMPLE_WIDTH,
    ) -> bytes:
        output = io.BytesIO()
        with wave.open(output, "wb") as wav_file:
            wav_file.setnchannels(channels)
            wav_file.setsampwidth(sample_width)
            wav_file.setframerate(sample_rate)
            wav_file.writeframes(pcm_bytes)
        return output.getvalue()

    async def _ws_send_event(self, websocket: Any, event: Dict[str, Any]) -> None:
        await websocket.send(json.dumps(event, ensure_ascii=False))

    async def _ws_receive_event(self, websocket: Any, timeout: float) -> Dict[str, Any]:
        raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"DashScope realtime returned non-JSON event: {raw}") from exc

    def _raise_realtime_error(self, event: Dict[str, Any]) -> None:
        error = event.get("error") or {}
        code = error.get("code") or event.get("code") or "error"
        message = error.get("message") or event.get("message") or event
        raise RuntimeError(f"DashScope realtime error: {code}: {message}")

    async def _wait_for_realtime_event(
        self,
        websocket: Any,
        expected_types: set[str],
        timeout: float,
    ) -> Dict[str, Any]:
        while True:
            event = await self._ws_receive_event(websocket, timeout)
            event_type = event.get("type")
            if event_type == "error":
                self._raise_realtime_error(event)
            if event_type in expected_types:
                return event

    async def _finish_realtime_session(self, websocket: Any, timeout: float) -> None:
        try:
            await self._ws_send_event(websocket, self._event("session.finish"))
            await self._wait_for_realtime_event(
                websocket,
                {"session.finished"},
                min(timeout, 10.0),
            )
        except Exception:
            return

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
        raise RuntimeError(f"DashScope API error: HTTP {response.status_code}: {detail}")

    def _should_retry_with_instruct(self, response: httpx.Response) -> bool:
        model_name = (self.model_name or "").lower()
        if not model_name.startswith("qwen3-tts-flash") or "realtime" in model_name:
            return False
        if response.status_code != 400:
            return False
        try:
            body = response.json()
        except Exception:
            return False
        message = str(body.get("message") or "").lower()
        return (
            body.get("code") == "InvalidParameter"
            and "invalid text" in message
            and "invalid audio" in message
        )

    def _fallback_model_name(self) -> str:
        return "qwen3-tts-instruct-flash"

    def _fallback_payload(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        return {
            **payload,
            "model": self._fallback_model_name(),
        }

    def _resolve_voice(self, voice: Optional[str]) -> str:
        if not voice:
            return self.DEFAULT_VOICE
        voice = str(voice).strip()
        return OPENAI_TO_DASHSCOPE_VOICE.get(voice, OPENAI_TO_DASHSCOPE_VOICE.get(voice.lower(), voice))

    def _infer_language_type(self, text: str) -> str:
        cjk_count = len(CJK_RE.findall(text))
        latin_count = len(re.findall(r"[A-Za-z]", text))
        if cjk_count and latin_count < max(3, cjk_count // 8):
            return "Chinese"
        if latin_count and not cjk_count:
            return "English"
        return self.DEFAULT_LANGUAGE_TYPE

    def _build_payload(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        model_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        resolved_model = model_name or self.model_name or self.DEFAULT_MODEL
        parameters: Dict[str, Any] = {}
        input_data: Dict[str, Any] = {
            "text": text,
            "voice": self._resolve_voice(voice),
            "language_type": kwargs.pop("language_type", self._infer_language_type(text)),
        }

        for key in ("instructions", "optimize_instructions"):
            if key in kwargs:
                parameters[key] = kwargs.pop(key)

        payload: Dict[str, Any] = {
            "model": resolved_model,
            "input": input_data,
        }
        parameters.update(kwargs)
        if parameters:
            payload["parameters"] = parameters
        return payload

    def _payload_for_attempt(self, payload: Dict[str, Any], attempt: int) -> Dict[str, Any]:
        if attempt == 0:
            return payload
        retry_payload = {
            **payload,
            "input": dict(payload.get("input") or {}),
            "parameters": dict(payload.get("parameters") or {}),
        }
        if retry_payload["parameters"].get("instructions"):
            retry_payload["parameters"]["optimize_instructions"] = True
        if not retry_payload["parameters"]:
            retry_payload.pop("parameters", None)
        return retry_payload

    def _estimate_audio_duration(self, audio_bytes: bytes, content_type: str) -> Optional[float]:
        is_wav = "wav" in (content_type or "").lower() or audio_bytes.startswith(b"RIFF")
        if not is_wav:
            return None
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
                frame_rate = wav_file.getframerate()
                if not frame_rate:
                    return None
                return wav_file.getnframes() / float(frame_rate)
        except Exception:
            return None

    def _minimum_expected_duration(self, text: str) -> float:
        cjk_chars = len(CJK_RE.findall(text))
        latin_words = len(re.findall(r"[A-Za-z0-9]+", text))
        expected_seconds = cjk_chars * 0.10 + latin_words * 0.22
        return max(0.5, expected_seconds * 0.55)

    def _is_audio_too_short(
        self, text: str, audio_bytes: bytes, content_type: str
    ) -> Tuple[bool, Optional[float], float]:
        duration = self._estimate_audio_duration(audio_bytes, content_type)
        minimum = self._minimum_expected_duration(text)
        if duration is None:
            return False, None, minimum
        return duration < minimum, duration, minimum

    def _max_audio_attempts(self, kwargs: Dict[str, Any]) -> int:
        configured = kwargs.pop(
            "max_audio_attempts",
            self._config.get("max_audio_attempts", self.DEFAULT_MAX_AUDIO_ATTEMPTS),
        )
        try:
            return max(1, int(configured))
        except (TypeError, ValueError):
            return self.DEFAULT_MAX_AUDIO_ATTEMPTS

    def _max_input_chars(self, kwargs: Dict[str, Any]) -> int:
        configured = kwargs.pop(
            "max_input_chars",
            self._config.get("max_input_chars", self.DEFAULT_MAX_INPUT_CHARS),
        )
        try:
            return max(100, min(600, int(configured)))
        except (TypeError, ValueError):
            return self.DEFAULT_MAX_INPUT_CHARS

    def _join_text_parts(self, left: str, right: str) -> str:
        if not left:
            return right
        if left[-1].isascii() and right[:1].isascii():
            return f"{left} {right}"
        return f"{left}{right}"

    def _hard_split_text(self, text: str, max_chars: int) -> List[str]:
        return [
            text[start : start + max_chars].strip()
            for start in range(0, len(text), max_chars)
            if text[start : start + max_chars].strip()
        ]

    def _split_oversized_unit(self, text: str, max_chars: int) -> List[str]:
        if len(text) <= max_chars:
            return [text]
        chunks: List[str] = []
        current = ""
        parts = [
            match.group(0).strip()
            for match in SOFT_SPLIT_RE.finditer(text)
            if match.group(0).strip()
        ] or [text]

        for part in parts:
            if len(part) > max_chars:
                if current:
                    chunks.append(current)
                    current = ""
                chunks.extend(self._hard_split_text(part, max_chars))
                continue

            candidate = self._join_text_parts(current, part)
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                current = part

        if current:
            chunks.append(current)
        return chunks

    def _split_text_for_tts(self, text: str, max_chars: int) -> List[str]:
        normalized = re.sub(r"\s+", " ", text).strip()
        if len(normalized) <= max_chars:
            return [normalized]

        chunks: List[str] = []
        current = ""
        units = [
            match.group(0).strip()
            for match in SENTENCE_SPLIT_RE.finditer(normalized)
            if match.group(0).strip()
        ] or [normalized]

        for unit in units:
            if len(unit) > max_chars:
                for part in self._split_oversized_unit(unit, max_chars):
                    candidate = self._join_text_parts(current, part)
                    if len(candidate) <= max_chars:
                        current = candidate
                    else:
                        if current:
                            chunks.append(current)
                        current = part
                continue

            candidate = self._join_text_parts(current, unit)
            if len(candidate) <= max_chars:
                current = candidate
            else:
                if current:
                    chunks.append(current)
                current = unit

        if current:
            chunks.append(current)
        return chunks

    def _combine_wav_chunks(
        self, audio_chunks: List[Tuple[bytes, str, Optional[float]]]
    ) -> Tuple[bytes, str, Optional[float]]:
        if len(audio_chunks) == 1:
            audio_bytes, content_type, duration = audio_chunks[0]
            return audio_bytes, content_type, duration

        params = None
        frames: List[bytes] = []
        duration_total = 0.0
        duration_known = True

        for audio_bytes, content_type, duration in audio_chunks:
            is_wav = "wav" in (content_type or "").lower() or audio_bytes.startswith(b"RIFF")
            if not is_wav:
                raise RuntimeError(
                    "DashScope returned non-WAV audio for a split TTS request; "
                    "cannot safely concatenate chunks"
                )
            with wave.open(io.BytesIO(audio_bytes), "rb") as wav_file:
                chunk_params = (
                    wav_file.getnchannels(),
                    wav_file.getsampwidth(),
                    wav_file.getframerate(),
                    wav_file.getcomptype(),
                    wav_file.getcompname(),
                )
                if params is None:
                    params = chunk_params
                elif params != chunk_params:
                    raise RuntimeError(
                        "DashScope returned incompatible WAV chunks; cannot concatenate"
                    )
                frames.append(wav_file.readframes(wav_file.getnframes()))
                if duration is None:
                    duration_known = False
                else:
                    duration_total += duration

        assert params is not None
        output = io.BytesIO()
        with wave.open(output, "wb") as out_file:
            out_file.setnchannels(params[0])
            out_file.setsampwidth(params[1])
            out_file.setframerate(params[2])
            out_file.setcomptype(params[3], params[4])
            out_file.writeframes(b"".join(frames))
        return output.getvalue(), "audio/wav", duration_total if duration_known else None

    async def _agenerate_realtime_audio_once(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        max_input_chars: int,
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        import websockets

        model_used = self.model_name or self.DEFAULT_MODEL
        timeout = float(
            kwargs.pop(
                "realtime_timeout",
                self._config.get("realtime_timeout", 60),
            )
        )
        text_chunks = self._split_text_for_tts(text, max_input_chars)
        session = self._build_realtime_session(text, voice, kwargs)
        audio_parts: List[bytes] = []
        response_ids: List[str] = []
        session_id: Optional[str] = None

        connect_kwargs = {
            "additional_headers": self._realtime_headers(),
            "max_size": None,
            "ping_interval": 20,
            "ping_timeout": 20,
        }
        async with websockets.connect(
            self._realtime_url(model_used),
            **connect_kwargs,
        ) as websocket:
            created = await self._wait_for_realtime_event(
                websocket,
                {"session.created"},
                timeout,
            )
            session_id = ((created.get("session") or {}).get("id") or None)

            await self._ws_send_event(
                websocket,
                self._event("session.update", session=session),
            )
            await self._wait_for_realtime_event(
                websocket,
                {"session.updated"},
                timeout,
            )

            for chunk in text_chunks:
                await self._ws_send_event(
                    websocket,
                    self._event("input_text_buffer.append", text=chunk),
                )

            await self._ws_send_event(
                websocket,
                self._event("input_text_buffer.commit"),
            )

            audio_done = False
            while True:
                try:
                    event = await self._ws_receive_event(
                        websocket,
                        min(timeout, 10.0) if audio_done else timeout,
                    )
                except asyncio.TimeoutError as exc:
                    if audio_done:
                        break
                    raise RuntimeError("Timed out waiting for DashScope realtime TTS audio") from exc

                event_type = event.get("type")
                if event_type == "error":
                    self._raise_realtime_error(event)
                if event_type == "response.audio.delta":
                    encoded_audio = event.get("delta")
                    if encoded_audio:
                        audio_parts.append(base64.b64decode(encoded_audio))
                    response_id = event.get("response_id")
                    if response_id and response_id not in response_ids:
                        response_ids.append(response_id)
                    continue
                if event_type == "response.audio.done":
                    audio_done = True
                    continue
                if event_type == "response.done":
                    response = event.get("response") or {}
                    status = response.get("status")
                    if status and status != "completed":
                        raise RuntimeError(
                            f"DashScope realtime response did not complete: {response}"
                        )
                    break
                if event_type == "session.finished":
                    break

            await self._finish_realtime_session(websocket, timeout)

        pcm_bytes = b"".join(audio_parts)
        if not pcm_bytes:
            raise RuntimeError("DashScope realtime response did not contain audio data")

        duration = len(pcm_bytes) / float(
            self.REALTIME_SAMPLE_RATE
            * self.REALTIME_CHANNELS
            * self.REALTIME_SAMPLE_WIDTH
        )
        metadata = {
            "realtime_tts": {
                "api_protocol": "dashscope-realtime-tts",
                "model": model_used,
                "session_id": session_id,
                "response_ids": response_ids,
                "text_chunk_count": len(text_chunks),
                "response_format": "pcm",
                "sample_rate": self.REALTIME_SAMPLE_RATE,
                "wav_wrapped": True,
            }
        }
        return (
            self._wav_from_pcm(pcm_bytes),
            "audio/wav",
            metadata,
            model_used,
            duration,
        )

    async def _agenerate_realtime_text_audio(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        max_attempts: int,
        max_input_chars: int,
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        best: Optional[Tuple[bytes, str, Dict[str, Any], str, Optional[float]]] = None
        for attempt in range(max_attempts):
            candidate = await self._agenerate_realtime_audio_once(
                text,
                voice,
                dict(kwargs),
                max_input_chars,
            )
            audio_bytes, content_type, metadata, model_used, duration = candidate
            too_short, duration, minimum = self._is_audio_too_short(
                text,
                audio_bytes,
                content_type,
            )
            metadata["audio_validation"] = {
                "attempt": attempt + 1,
                "max_attempts": max_attempts,
                "duration_seconds": duration,
                "minimum_expected_seconds": minimum,
                "too_short": too_short,
            }
            candidate = (audio_bytes, content_type, metadata, model_used, duration)
            best = self._best_attempt(best, candidate)
            if not too_short:
                return candidate
        assert best is not None
        best[2]["audio_validation"]["returned_shortest_acceptable"] = False
        return best

    def _generate_realtime_text_audio(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        max_attempts: int,
        max_input_chars: int,
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(
                self._agenerate_realtime_text_audio(
                    text,
                    voice,
                    kwargs,
                    max_attempts,
                    max_input_chars,
                )
            )
        raise RuntimeError(
            "DashScope realtime TTS cannot use sync generate_speech inside an "
            "active event loop; call agenerate_speech instead."
        )

    def _generate_text_audio(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        max_attempts: int,
        max_input_chars: int,
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        text_chunks = self._split_text_for_tts(text, max_input_chars)
        if len(text_chunks) == 1:
            payload = self._build_payload(text_chunks[0], voice, dict(kwargs))
            return self._generate_audio_with_guard(
                text_chunks[0], payload, max_attempts
            )

        audio_chunks: List[Tuple[bytes, str, Optional[float]]] = []
        chunk_metadata = []
        model_used = self.model_name or self.DEFAULT_MODEL
        for index, chunk_text in enumerate(text_chunks):
            payload = self._build_payload(chunk_text, voice, dict(kwargs))
            audio_bytes, content_type, metadata, model_used, duration = (
                self._generate_audio_with_guard(chunk_text, payload, max_attempts)
            )
            audio_chunks.append((audio_bytes, content_type, duration))
            chunk_metadata.append(
                {
                    "index": index,
                    "characters": len(chunk_text),
                    "duration_seconds": duration,
                    "audio_validation": metadata.get("audio_validation"),
                    "request_id": metadata.get("request_id"),
                }
            )

        audio_bytes, content_type, duration = self._combine_wav_chunks(audio_chunks)
        metadata = {
            "split_tts": {
                "chunk_count": len(text_chunks),
                "max_input_chars": max_input_chars,
                "chunks": chunk_metadata,
            }
        }
        return audio_bytes, content_type, metadata, model_used, duration

    async def _agenerate_text_audio(
        self,
        text: str,
        voice: Optional[str],
        kwargs: Dict[str, Any],
        max_attempts: int,
        max_input_chars: int,
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        text_chunks = self._split_text_for_tts(text, max_input_chars)
        if len(text_chunks) == 1:
            payload = self._build_payload(text_chunks[0], voice, dict(kwargs))
            return await self._agenerate_audio_with_guard(
                text_chunks[0], payload, max_attempts
            )

        audio_chunks: List[Tuple[bytes, str, Optional[float]]] = []
        chunk_metadata = []
        model_used = self.model_name or self.DEFAULT_MODEL
        for index, chunk_text in enumerate(text_chunks):
            payload = self._build_payload(chunk_text, voice, dict(kwargs))
            audio_bytes, content_type, metadata, model_used, duration = (
                await self._agenerate_audio_with_guard(
                    chunk_text, payload, max_attempts
                )
            )
            audio_chunks.append((audio_bytes, content_type, duration))
            chunk_metadata.append(
                {
                    "index": index,
                    "characters": len(chunk_text),
                    "duration_seconds": duration,
                    "audio_validation": metadata.get("audio_validation"),
                    "request_id": metadata.get("request_id"),
                }
            )

        audio_bytes, content_type, duration = self._combine_wav_chunks(audio_chunks)
        metadata = {
            "split_tts": {
                "chunk_count": len(text_chunks),
                "max_input_chars": max_input_chars,
                "chunks": chunk_metadata,
            }
        }
        return audio_bytes, content_type, metadata, model_used, duration

    def _best_attempt(
        self,
        current: Optional[Tuple[bytes, str, Dict[str, Any], str, Optional[float]]],
        candidate: Tuple[bytes, str, Dict[str, Any], str, Optional[float]],
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        if current is None:
            return candidate
        current_duration = current[4] or 0.0
        candidate_duration = candidate[4] or 0.0
        if candidate_duration > current_duration:
            return candidate
        return current

    def _generate_audio_with_guard(
        self, text: str, payload: Dict[str, Any], max_attempts: int
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        best: Optional[Tuple[bytes, str, Dict[str, Any], str, Optional[float]]] = None
        for attempt in range(max_attempts):
            attempt_payload = self._payload_for_attempt(payload, attempt)
            data, model_used = self._post_generation(attempt_payload)
            audio_bytes, content_type = self._audio_from_response(data)
            too_short, duration, minimum = self._is_audio_too_short(
                text, audio_bytes, content_type
            )
            metadata = {
                **data,
                "audio_validation": {
                    "attempt": attempt + 1,
                    "max_attempts": max_attempts,
                    "duration_seconds": duration,
                    "minimum_expected_seconds": minimum,
                    "too_short": too_short,
                },
            }
            candidate = (audio_bytes, content_type, metadata, model_used, duration)
            best = self._best_attempt(best, candidate)
            if not too_short:
                return candidate
        assert best is not None
        best[2]["audio_validation"]["returned_shortest_acceptable"] = False
        return best

    async def _agenerate_audio_with_guard(
        self, text: str, payload: Dict[str, Any], max_attempts: int
    ) -> Tuple[bytes, str, Dict[str, Any], str, Optional[float]]:
        best: Optional[Tuple[bytes, str, Dict[str, Any], str, Optional[float]]] = None
        for attempt in range(max_attempts):
            attempt_payload = self._payload_for_attempt(payload, attempt)
            data, model_used = await self._apost_generation(attempt_payload)
            audio_bytes, content_type = await self._aaudio_from_response(data)
            too_short, duration, minimum = self._is_audio_too_short(
                text, audio_bytes, content_type
            )
            metadata = {
                **data,
                "audio_validation": {
                    "attempt": attempt + 1,
                    "max_attempts": max_attempts,
                    "duration_seconds": duration,
                    "minimum_expected_seconds": minimum,
                    "too_short": too_short,
                },
            }
            candidate = (audio_bytes, content_type, metadata, model_used, duration)
            best = self._best_attempt(best, candidate)
            if not too_short:
                return candidate
        assert best is not None
        best[2]["audio_validation"]["returned_shortest_acceptable"] = False
        return best

    def _save_output(self, output_file: Optional[Union[str, Path]], audio_bytes: bytes) -> None:
        if not output_file:
            return
        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(audio_bytes)

    def _post_generation(self, payload: Dict[str, Any]) -> tuple[Dict[str, Any], str]:
        response = self.client.post(
            self._generation_url(),
            headers=self._headers(),
            json=payload,
        )
        model_used = payload["model"]
        if self._should_retry_with_instruct(response):
            payload = self._fallback_payload(payload)
            model_used = payload["model"]
            response = self.client.post(
                self._generation_url(),
                headers=self._headers(),
                json=payload,
            )
        self._handle_error(response)
        return response.json(), model_used

    async def _apost_generation(self, payload: Dict[str, Any]) -> tuple[Dict[str, Any], str]:
        response = await self.async_client.post(
            self._generation_url(),
            headers=self._headers(),
            json=payload,
        )
        model_used = payload["model"]
        if self._should_retry_with_instruct(response):
            payload = self._fallback_payload(payload)
            model_used = payload["model"]
            response = await self.async_client.post(
                self._generation_url(),
                headers=self._headers(),
                json=payload,
            )
        self._handle_error(response)
        return response.json(), model_used

    def _audio_from_response(self, data: Dict[str, Any]) -> tuple[bytes, str]:
        status_code = data.get("status_code")
        if status_code and int(status_code) >= 400:
            raise RuntimeError(
                f"DashScope API error: {data.get('code') or status_code}: {data.get('message') or data}"
            )

        audio = ((data.get("output") or {}).get("audio") or {})
        encoded_audio = audio.get("data")
        if encoded_audio:
            return base64.b64decode(encoded_audio), "audio/wav"

        audio_url = audio.get("url")
        if not audio_url:
            raise RuntimeError(f"DashScope response did not contain audio data or url: {data}")

        response = self.client.get(audio_url, follow_redirects=True)
        self._handle_error(response)
        return response.content, response.headers.get("content-type") or "audio/wav"

    async def _aaudio_from_response(self, data: Dict[str, Any]) -> tuple[bytes, str]:
        status_code = data.get("status_code")
        if status_code and int(status_code) >= 400:
            raise RuntimeError(
                f"DashScope API error: {data.get('code') or status_code}: {data.get('message') or data}"
            )

        audio = ((data.get("output") or {}).get("audio") or {})
        encoded_audio = audio.get("data")
        if encoded_audio:
            return base64.b64decode(encoded_audio), "audio/wav"

        audio_url = audio.get("url")
        if not audio_url:
            raise RuntimeError(f"DashScope response did not contain audio data or url: {data}")

        response = await self.async_client.get(audio_url, follow_redirects=True)
        self._handle_error(response)
        return response.content, response.headers.get("content-type") or "audio/wav"

    def _response(
        self,
        audio_bytes: bytes,
        content_type: str,
        voice: Optional[str],
        metadata: Dict[str, Any],
        model_used: Optional[str] = None,
        duration: Optional[float] = None,
    ) -> AudioResponse:
        return AudioResponse(
            audio_data=audio_bytes,
            duration=duration,
            content_type=content_type,
            model=model_used or self.model_name,
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
            spec = self._ensure_supported_tts_model()
            self.validate_parameters(text, voice or self.DEFAULT_VOICE, self.model_name)
            kwargs = dict(kwargs)
            max_attempts = self._max_audio_attempts(kwargs)
            max_input_chars = self._max_input_chars(kwargs)
            if spec.api_protocol == "dashscope-realtime-tts":
                audio_bytes, content_type, metadata, model_used, duration = (
                    self._generate_realtime_text_audio(
                        text,
                        voice,
                        kwargs,
                        max_attempts,
                        max_input_chars,
                    )
                )
            else:
                audio_bytes, content_type, metadata, model_used, duration = (
                    self._generate_text_audio(
                        text, voice, kwargs, max_attempts, max_input_chars
                    )
                )
            self._save_output(output_file, audio_bytes)
            return self._response(
                audio_bytes, content_type, voice, metadata, model_used, duration
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
            spec = self._ensure_supported_tts_model()
            self.validate_parameters(text, voice or self.DEFAULT_VOICE, self.model_name)
            kwargs = dict(kwargs)
            max_attempts = self._max_audio_attempts(kwargs)
            max_input_chars = self._max_input_chars(kwargs)
            if spec.api_protocol == "dashscope-realtime-tts":
                audio_bytes, content_type, metadata, model_used, duration = (
                    await self._agenerate_realtime_text_audio(
                        text,
                        voice,
                        kwargs,
                        max_attempts,
                        max_input_chars,
                    )
                )
            else:
                audio_bytes, content_type, metadata, model_used, duration = (
                    await self._agenerate_text_audio(
                        text, voice, kwargs, max_attempts, max_input_chars
                    )
                )
            self._save_output(output_file, audio_bytes)
            return self._response(
                audio_bytes, content_type, voice, metadata, model_used, duration
            )
        except RuntimeError:
            raise
        except Exception as e:
            raise RuntimeError(f"Failed to generate speech: {e}") from e
