"""Tests for the credentials API endpoint."""

from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient

from api import credentials_service


@pytest.fixture
def client():
    """Create test client after environment variables have been cleared by conftest."""
    from api.main import app

    return TestClient(app)


class TestCredentialCascadeDelete:
    """Tests for #651 - deleting credential cascade-deletes linked models."""

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_cascade_delete_linked_models(self, mock_get, client):
        """Deleting credential without options cascade-deletes linked models."""
        mock_model1 = AsyncMock()
        mock_model1.id = "model:1"
        mock_model1.provider = "openai"
        mock_model1.name = "gpt-4"

        mock_model2 = AsyncMock()
        mock_model2.id = "model:2"
        mock_model2.provider = "openai"
        mock_model2.name = "gpt-3.5-turbo"

        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(
            return_value=[mock_model1, mock_model2]
        )
        mock_cred.delete = AsyncMock()
        mock_get.return_value = mock_cred

        response = client.delete("/api/credentials/cred:123")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 2
        assert data["message"] == "Credential deleted successfully"

        mock_model1.delete.assert_awaited_once()
        mock_model2.delete.assert_awaited_once()
        mock_cred.delete.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_delete_credential_no_linked_models(self, mock_get, client):
        """Deleting credential with no linked models works cleanly."""
        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(return_value=[])
        mock_cred.delete = AsyncMock()
        mock_get.return_value = mock_cred

        response = client.delete("/api/credentials/cred:123")

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 0
        mock_cred.delete.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("api.routers.credentials.Credential.get")
    async def test_migrate_models_instead_of_delete(self, mock_get, client):
        """Passing migrate_to reassigns models instead of deleting them."""
        mock_model = AsyncMock()
        mock_model.id = "model:1"
        mock_model.credential = "cred:123"
        mock_model.save = AsyncMock()

        mock_cred = AsyncMock()
        mock_cred.get_linked_models = AsyncMock(return_value=[mock_model])
        mock_cred.delete = AsyncMock()

        mock_target_cred = AsyncMock()
        mock_target_cred.id = "cred:456"

        # First call returns cred to delete, second returns target
        mock_get.side_effect = [mock_cred, mock_target_cred]

        response = client.delete(
            "/api/credentials/cred:123?migrate_to=cred:456"
        )

        assert response.status_code == 200
        data = response.json()
        assert data["deleted_models"] == 0  # Models were migrated, not deleted
        mock_model.save.assert_awaited_once()
        assert mock_model.credential == "cred:456"
        mock_cred.delete.assert_awaited_once()


class TestCredentialModelDiscovery:
    """Tests for credential-backed model discovery."""

    @pytest.mark.asyncio
    async def test_openai_discovery_respects_base_url(self, monkeypatch):
        """OpenAI model discovery should call the configured API base URL."""

        requests = []

        class FakeAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, url, headers=None, timeout=None):
                requests.append(
                    {
                        "url": url,
                        "headers": headers,
                        "timeout": timeout,
                    }
                )
                return httpx.Response(
                    200,
                    json={"data": [{"id": "custom-openai-model"}]},
                    request=httpx.Request("GET", url, headers=headers or {}),
                )

        monkeypatch.setattr(credentials_service.httpx, "AsyncClient", FakeAsyncClient)

        models = await credentials_service.discover_with_config(
            "openai",
            {
                "api_key": "sk-test",
                "base_url": "https://llm-gateway.example.com/v1",
            },
        )

        assert models[0] == {
            "name": "custom-openai-model",
            "provider": "openai",
            "model_type": "language",
            "description": None,
        }
        assert {model["name"] for model in models[1:]} == {
            "gpt-image-1",
            "dall-e-3",
        }
        assert requests == [
            {
                "url": "https://llm-gateway.example.com/v1/models",
                "headers": {"Authorization": "Bearer sk-test"},
                "timeout": 30.0,
            }
        ]

    @pytest.mark.asyncio
    async def test_model_discovery_base_url_can_include_models_path(self, monkeypatch):
        """Model discovery should not append /models twice."""

        requests = []

        class FakeAsyncClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return None

            async def get(self, url, headers=None, timeout=None):
                requests.append(url)
                return httpx.Response(
                    200,
                    json={"data": [{"id": "model-a"}]},
                    request=httpx.Request("GET", url, headers=headers or {}),
                )

        monkeypatch.setattr(credentials_service.httpx, "AsyncClient", FakeAsyncClient)

        await credentials_service.discover_with_config(
            "openai_compatible",
            {
                "api_key": "sk-test",
                "base_url": "https://llm-gateway.example.com/v1/models/",
            },
        )

        assert requests == ["https://llm-gateway.example.com/v1/models"]


class TestCredentialNumCtx:
    """Tests for the Ollama num_ctx override threaded into esperanto config."""

    def test_num_ctx_included_when_set(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(
            name="Local Ollama",
            provider="ollama",
            modalities=["language", "embedding"],
            base_url="http://localhost:11434",
            num_ctx=32768,
        )
        config = cred.to_esperanto_config()
        assert config["num_ctx"] == 32768
        assert config["base_url"] == "http://localhost:11434"

    def test_num_ctx_absent_when_unset(self):
        from open_notebook.domain.credential import Credential

        cred = Credential(
            name="Local Ollama",
            provider="ollama",
            base_url="http://localhost:11434",
        )
        assert "num_ctx" not in cred.to_esperanto_config()


class TestAudioProviderWiring:
    """Tests for the new audio providers (Mistral STT/TTS, Deepgram TTS, xAI TTS)."""

    def test_classify_voxtral_and_aura(self):
        from open_notebook.ai.model_discovery import classify_model_type

        # Mistral Voxtral: TTS model must not be mis-detected as STT
        assert classify_model_type("voxtral-mini-tts-2603", "mistral") == "text_to_speech"
        assert classify_model_type("voxtral-mini-latest", "mistral") == "speech_to_text"
        assert classify_model_type("voxtral-small-latest", "mistral") == "speech_to_text"
        # Existing Mistral classification still holds
        assert classify_model_type("mistral-large-latest", "mistral") == "language"
        assert classify_model_type("mistral-embed", "mistral") == "embedding"
        # Deepgram Aura voices
        assert classify_model_type("aura-2-thalia-en", "deepgram") == "text_to_speech"
        # Xiaomi MiMo TTS
        assert classify_model_type("mimo-v2.5-tts", "mimo") == "text_to_speech"

    def test_provider_modalities_include_audio(self):
        from api.credentials_service import PROVIDER_MODALITIES

        assert "speech_to_text" in PROVIDER_MODALITIES["mistral"]
        assert "text_to_speech" in PROVIDER_MODALITIES["mistral"]
        assert "text_to_speech" in PROVIDER_MODALITIES["xai"]
        assert "text_to_speech" in PROVIDER_MODALITIES["dashscope"]
        assert "speech_to_text" in PROVIDER_MODALITIES["dashscope"]
        assert PROVIDER_MODALITIES["deepgram"] == ["text_to_speech"]
        assert PROVIDER_MODALITIES["mimo"] == ["text_to_speech"]

    def test_deepgram_has_env_and_test_model(self):
        from api.credentials_service import PROVIDER_ENV_CONFIG
        from open_notebook.ai.connection_tester import TEST_MODELS

        assert PROVIDER_ENV_CONFIG["deepgram"]["required"] == ["DEEPGRAM_API_KEY"]
        assert TEST_MODELS["deepgram"][1] == "text_to_speech"
        assert PROVIDER_ENV_CONFIG["mimo"]["required_any"] == [
            "MIMO_API_KEY",
            "XIAOMI_MIMO_API_KEY",
        ]
        assert TEST_MODELS["mimo"] == ("mimo-v2.5-tts", "text_to_speech")


class TestModelRuntimeSpecs:
    """Tests for provider/runtime/protocol inference used by model settings."""

    def test_qwen_audio_models_are_classified_from_compatible_listings(self):
        from open_notebook.ai.model_discovery import classify_model_type

        assert (
            classify_model_type("qwen3-tts-instruct-flash", "openai_compatible")
            == "text_to_speech"
        )
        assert (
            classify_model_type("qwen3-asr-flash-2026-02-10", "openai_compatible")
            == "speech_to_text"
        )
        assert (
            classify_model_type("mimo-v2.5-tts", "openai_compatible")
            == "text_to_speech"
        )

    def test_qwen_batch_tts_routes_to_dashscope_protocol(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "text_to_speech",
            "qwen3-tts-instruct-flash",
        )

        assert spec.runtime_provider == "dashscope"
        assert spec.api_protocol == "dashscope-http-tts"
        assert spec.batch_tts_supported is True
        assert spec.warnings == []

    def test_qwen_realtime_tts_routes_to_dashscope_protocol(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "text_to_speech",
            "qwen3-tts-flash-realtime",
        )

        assert spec.runtime_provider == "dashscope"
        assert spec.api_protocol == "dashscope-realtime-tts"
        assert spec.batch_tts_supported is True
        assert spec.warnings == []

    def test_qwen_batch_asr_routes_to_openai_compatible_protocol(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "speech_to_text",
            "qwen3-asr-flash-2026-02-10",
            {"base_url": "https://example.maas.aliyuncs.com/compatible-mode/v1"},
        )

        assert spec.runtime_provider == "dashscope-asr"
        assert spec.api_protocol == "dashscope-compatible-asr"
        assert spec.warnings == []

    def test_qwen_realtime_asr_reports_file_transcription_warning(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "speech_to_text",
            "qwen3-asr-flash-realtime-2026-02-10",
            {"base_url": "https://example.maas.aliyuncs.com/compatible-mode/v1"},
        )

        assert spec.runtime_provider == "dashscope-asr"
        assert spec.api_protocol == "dashscope-realtime-asr"
        assert spec.warnings

    def test_dashscope_asr_adapter_uses_chat_completions(self):
        import io

        import httpx

        from open_notebook.ai.dashscope_asr import DashScopeSpeechToTextModel

        class FakeClient:
            def __init__(self):
                self.last_url = None
                self.last_payload = None

            def post(self, url, headers=None, json=None):
                self.last_url = url
                self.last_payload = json
                return httpx.Response(
                    200,
                    json={"choices": [{"message": {"content": "hello there"}}]},
                    request=httpx.Request("POST", url),
                )

        model = DashScopeSpeechToTextModel(
            model_name="qwen3-asr-flash",
            config={
                "api_key": "sk-test",
                "base_url": "https://example.maas.aliyuncs.com/compatible-mode/v1",
            },
        )
        fake_client = FakeClient()
        model.client = fake_client
        audio = io.BytesIO(b"fake audio")
        audio.name = "test.mp3"

        result = model.transcribe(audio, language="en")

        assert fake_client.last_url.endswith("/chat/completions")
        assert fake_client.last_payload["model"] == "qwen3-asr-flash"
        assert fake_client.last_payload["messages"][0]["content"][0]["type"] == "input_audio"
        input_audio = fake_client.last_payload["messages"][0]["content"][0]["input_audio"]
        assert input_audio["data"].startswith("data:audio/mpeg;base64,")
        assert fake_client.last_payload["asr_options"]["language"] == "en"
        assert fake_client.last_payload["stream"] is False
        assert result.text == "hello there"

    def test_qwen_vc_realtime_tts_reports_pipeline_warning(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "text_to_speech",
            "qwen3-tts-vc-realtime-2026-01-15",
        )

        assert spec.runtime_provider == "dashscope"
        assert spec.api_protocol == "dashscope-voice-conversion"
        assert spec.batch_tts_supported is False
        assert spec.warnings

    def test_mimo_tts_routes_to_mimo_protocol(self):
        from open_notebook.ai.model_specs import build_model_runtime_spec

        spec = build_model_runtime_spec(
            "openai",
            "text_to_speech",
            "mimo-v2.5-tts",
        )

        assert spec.runtime_provider == "mimo"
        assert spec.api_protocol == "mimo-chat-audio-tts"
        assert spec.batch_tts_supported is True
        assert spec.warnings == []

    def test_mimo_adapter_uses_chat_audio_protocol(self):
        import base64

        from open_notebook.ai.mimo_tts import MiMoTextToSpeechModel

        audio = b"RIFF-test-audio"

        class FakeClient:
            def __init__(self):
                self.last_url = None
                self.last_headers = None
                self.last_payload = None

            def post(self, url, headers=None, json=None):
                self.last_url = url
                self.last_headers = headers
                self.last_payload = json
                return httpx.Response(
                    200,
                    json={
                        "choices": [
                            {
                                "message": {
                                    "audio": {
                                        "data": base64.b64encode(audio).decode("ascii"),
                                        "format": "wav",
                                    }
                                }
                            }
                        ]
                    },
                )

        model = MiMoTextToSpeechModel(
            model_name="mimo-v2.5-tts",
            api_key="test-key",
            base_url="https://api.xiaomimimo.com/v1",
        )
        fake_client = FakeClient()
        model.client = fake_client

        response = model.generate_speech("你好，欢迎学习。", voice="alloy")

        assert fake_client.last_url == "https://api.xiaomimimo.com/v1/chat/completions"
        assert fake_client.last_headers["api-key"] == "test-key"
        assert fake_client.last_payload["model"] == "mimo-v2.5-tts"
        assert fake_client.last_payload["audio"] == {
            "format": "wav",
            "voice": "mimo_default",
        }
        assert fake_client.last_payload["messages"][-1] == {
            "role": "assistant",
            "content": "你好，欢迎学习。",
        }
        assert response.provider == "mimo"
        assert response.audio_data == audio
        assert response.content_type == "audio/wav"

    def test_dashscope_realtime_adapter_helpers(self):
        import io
        import wave

        from open_notebook.ai.dashscope_tts import DashScopeTextToSpeechModel

        model = DashScopeTextToSpeechModel(
            model_name="qwen3-tts-flash-realtime",
            api_key="test-key",
            base_url="https://dashscope.aliyuncs.com/api/v1",
        )

        assert model._realtime_url() == (
            "wss://dashscope.aliyuncs.com/api-ws/v1/realtime"
            "?model=qwen3-tts-flash-realtime"
        )
        wav_bytes = model._wav_from_pcm(b"\x00\x00" * model.REALTIME_SAMPLE_RATE)
        with wave.open(io.BytesIO(wav_bytes), "rb") as wav_file:
            assert wav_file.getframerate() == model.REALTIME_SAMPLE_RATE
            assert wav_file.getnchannels() == 1
            assert wav_file.getsampwidth() == 2
            assert wav_file.getnframes() == model.REALTIME_SAMPLE_RATE

    @pytest.mark.asyncio
    async def test_dashscope_realtime_adapter_streams_audio(self, monkeypatch):
        import base64
        import io
        import json
        import wave

        import websockets

        from open_notebook.ai.dashscope_tts import DashScopeTextToSpeechModel

        pcm_audio = b"\x00\x00" * 24000

        class FakeWebSocket:
            def __init__(self):
                self.sent = []
                self.events = iter(
                    [
                        {"type": "session.created", "session": {"id": "sess_test"}},
                        {"type": "session.updated", "session": {"id": "sess_test"}},
                        {
                            "type": "response.audio.delta",
                            "delta": base64.b64encode(pcm_audio).decode("ascii"),
                            "response_id": "resp_test",
                        },
                        {"type": "response.audio.done"},
                        {"type": "response.done", "response": {"status": "completed"}},
                        {"type": "session.finished"},
                    ]
                )

            async def send(self, message):
                self.sent.append(json.loads(message))

            async def recv(self):
                return json.dumps(next(self.events))

        fake_socket = FakeWebSocket()

        class FakeConnect:
            async def __aenter__(self):
                return fake_socket

            async def __aexit__(self, exc_type, exc, tb):
                return False

        def fake_connect(*args, **kwargs):
            return FakeConnect()

        monkeypatch.setattr(websockets, "connect", fake_connect)

        model = DashScopeTextToSpeechModel(
            model_name="qwen3-tts-flash-realtime",
            api_key="test-key",
            base_url="https://dashscope.aliyuncs.com/api/v1",
        )

        response = await model.agenerate_speech(
            "Hello from realtime TTS",
            voice="Cherry",
            max_audio_attempts=1,
        )

        assert response.content_type == "audio/wav"
        assert response.metadata["realtime_tts"]["api_protocol"] == "dashscope-realtime-tts"
        assert response.metadata["realtime_tts"]["session_id"] == "sess_test"
        sent_types = [event["type"] for event in fake_socket.sent]
        assert sent_types == [
            "session.update",
            "input_text_buffer.append",
            "input_text_buffer.commit",
            "session.finish",
        ]

        with wave.open(io.BytesIO(response.audio_data), "rb") as wav_file:
            assert wav_file.getframerate() == 24000
            assert wav_file.getnframes() == 24000


class TestAudioMatrixWiring:
    """Tests for completing the audio matrix (Google/Vertex TTS, Google/ElevenLabs STT)."""

    def test_provider_modalities_matrix(self):
        from api.credentials_service import PROVIDER_MODALITIES

        for m in ("speech_to_text", "text_to_speech"):
            assert m in PROVIDER_MODALITIES["google"]
        assert "text_to_speech" in PROVIDER_MODALITIES["vertex"]
        assert "speech_to_text" in PROVIDER_MODALITIES["elevenlabs"]

    def test_classify_matrix(self):
        from open_notebook.ai.model_discovery import classify_model_type

        # Gemini TTS preview is classifiable; plain Gemini STT name stays language
        assert classify_model_type("gemini-3.1-flash-tts-preview", "google") == "text_to_speech"
        assert classify_model_type("gemini-2.0-flash", "google") == "language"
        # ElevenLabs Scribe STT must not be caught by the TTS "eleven" pattern
        assert classify_model_type("scribe_v1", "elevenlabs") == "speech_to_text"
        assert classify_model_type("eleven_multilingual_v2", "elevenlabs") == "text_to_speech"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
