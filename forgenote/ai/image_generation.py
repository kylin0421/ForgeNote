"""Image-generation helpers for OpenAI and DashScope-compatible providers."""

import base64
import os
from typing import Any, Callable, Optional

import httpx

from forgenote.ai.key_provider import get_api_key, provision_provider_keys


ImagePersistor = Callable[[bytes, str], str]


def normalize_dashscope_image_base_url(base_url: Optional[str]) -> str:
    """Convert DashScope/OpenAI-compatible URLs to DashScope native API base."""
    if not base_url:
        return "https://dashscope.aliyuncs.com/api/v1"
    normalized = base_url.rstrip("/")
    for suffix in ("/compatible-mode/v1", "/api/v1"):
        if normalized.endswith(suffix):
            normalized = normalized[: -len(suffix)]
            break
    return f"{normalized}/api/v1"


def looks_like_dashscope_image_endpoint(base_url: Optional[str]) -> bool:
    value = (base_url or "").lower()
    return "dashscope.aliyuncs.com" in value or "maas.aliyuncs.com" in value


def is_dashscope_image_model(model_name: str, provider: str, base_url: Optional[str]) -> bool:
    name = (model_name or "").lower()
    provider_name = (provider or "").lower()
    return (
        provider_name == "dashscope"
        or looks_like_dashscope_image_endpoint(base_url)
        or name.startswith(("qwen-image", "wanx", "flux", "stable-diffusion"))
    )


async def resolve_image_model_config(model) -> tuple[str, str, Optional[str], Optional[str]]:
    """Return provider, model name, API key, and model credential base URL."""
    provider = (getattr(model, "provider", None) or "openai").strip()
    model_name = getattr(model, "name", None) or "gpt-image-1"
    credential = None
    base_url = None

    if hasattr(model, "get_credential_obj"):
        credential = await model.get_credential_obj()
        if credential:
            base_url = credential.base_url

    if credential and credential.api_key:
        api_key = credential.api_key.get_secret_value()
    else:
        await provision_provider_keys(provider)
        api_key = await get_api_key(provider)

    return provider, model_name, api_key, base_url


async def generate_image(
    *,
    provider: str,
    model_name: str,
    api_key: str,
    prompt: str,
    base_url: Optional[str] = None,
    persist_image_bytes: Optional[ImagePersistor] = None,
    timeout: int = 120,
) -> tuple[str, str]:
    """Generate one image and return image URL/path plus MIME type."""
    if is_dashscope_image_model(model_name, provider, base_url):
        return await generate_dashscope_image(
            model_name=model_name,
            api_key=api_key,
            prompt=prompt,
            base_url=base_url,
            timeout=timeout,
        )

    return await generate_openai_image(
        provider=provider,
        model_name=model_name,
        api_key=api_key,
        prompt=prompt,
        base_url=base_url,
        persist_image_bytes=persist_image_bytes,
        timeout=timeout,
    )


async def generate_openai_image(
    *,
    provider: str,
    model_name: str,
    api_key: str,
    prompt: str,
    base_url: Optional[str] = None,
    persist_image_bytes: Optional[ImagePersistor] = None,
    timeout: int = 120,
) -> tuple[str, str]:
    if not base_url:
        base_url = (
            os.environ.get("OPENAI_COMPATIBLE_BASE_URL")
            if provider in {"openai_compatible", "openai-compatible"}
            else os.environ.get("OPENAI_API_BASE")
        ) or "https://api.openai.com/v1"
    base_url = base_url.rstrip("/")

    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{base_url}/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "prompt": prompt,
                "size": "1024x1024",
                "n": 1,
            },
        )
        response.raise_for_status()
        data = response.json()

    image_item = (data.get("data") or [{}])[0]
    b64_json = image_item.get("b64_json")
    if b64_json:
        if not persist_image_bytes:
            raise ValueError("Image generation returned base64 data but no persistor is configured")
        return persist_image_bytes(base64.b64decode(b64_json), "image/png"), "image/png"

    image_url = image_item.get("url")
    if image_url:
        return str(image_url), "image/png"

    raise ValueError("Image generation returned no image data")


async def generate_dashscope_image(
    *,
    model_name: str,
    api_key: str,
    prompt: str,
    base_url: Optional[str] = None,
    timeout: int = 120,
) -> tuple[str, str]:
    native_base_url = normalize_dashscope_image_base_url(base_url)
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(
            f"{native_base_url}/services/aigc/multimodal-generation/generation",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": model_name,
                "input": {
                    "messages": [
                        {
                            "role": "user",
                            "content": [{"text": prompt}],
                        }
                    ]
                },
                "parameters": {
                    "size": "1328*1328",
                    "n": 1,
                },
            },
        )
        response.raise_for_status()
        data = response.json()

    for choice in (data.get("output") or {}).get("choices") or []:
        message = choice.get("message") or {}
        for item in message.get("content") or []:
            if item.get("image"):
                return str(item["image"]), "image/png"

    raise ValueError(f"DashScope image generation returned no image URL: {data}")


def image_generation_target(provider: str, model_name: str, base_url: Optional[str]) -> str:
    if is_dashscope_image_model(model_name, provider, base_url):
        return f"{normalize_dashscope_image_base_url(base_url)}/services/aigc/multimodal-generation/generation"

    resolved_base_url = (
        base_url
        or (
            os.environ.get("OPENAI_COMPATIBLE_BASE_URL")
            if provider in {"openai_compatible", "openai-compatible"}
            else os.environ.get("OPENAI_API_BASE")
        )
        or "https://api.openai.com/v1"
    )
    return f"{resolved_base_url.rstrip('/')}/images/generations"
