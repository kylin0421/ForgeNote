from unittest.mock import AsyncMock

import pytest

from api.learning_service import (
    _blog_resource_from_markdown,
    _generate_resources_from_sources,
    _learning_generation_prompt,
)
from api.models import LearningOrchestrationRequest
from forgenote.ai.models import DefaultModels, ModelManager


def _context() -> dict[str, str]:
    return {
        "message": "写一篇能真正帮助我理解注意力机制的教学博客",
        "course": "Transformer 注意力机制",
        "major": "计算机科学",
        "goal": "能够独立手算一次注意力",
        "history": "已经知道 Q、K、V 的名称",
        "target_language": "简体中文",
    }


def test_blog_prompt_requires_publishable_grounded_article():
    prompt = _learning_generation_prompt(
        _context(),
        ["blog"],
        "## Source 1: Attention paper\nScaled dot-product attention.",
    )

    assert "<blog_quality_contract>" in prompt
    assert "1200-2200 个中文字符" in prompt
    assert "直觉模型 → 来源中的机制/公式" in prompt
    assert "逐步算例或具体案例" in prompt
    assert "payload.provenance" in prompt


def test_blog_markdown_repairs_heading_spacing_and_keeps_source_provenance():
    resource = _blog_resource_from_markdown(
        "#为什么要缩放？\n\n##直觉\n\n点积过大时需要缩放。",
        _context(),
        "## Source 1: Attention paper\n\nScaled dot-product attention.",
    )

    assert resource.title == "为什么要缩放？"
    assert resource.content.startswith("# 为什么要缩放？")
    assert "\n## 直觉" in resource.content
    assert resource.payload["provenance"] == ["Attention paper"]


@pytest.mark.asyncio
async def test_blog_generation_uses_specialized_route_and_writing_temperature(
    monkeypatch,
):
    captured: dict[str, object] = {}

    class BlogModel:
        async def ainvoke(self, _messages):
            return type(
                "Message",
                (),
                {
                    "content": (
                        "# 为什么注意力要缩放？\n\n"
                        "从来源公式出发解释缩放点积注意力。\n\n"
                        "## 直觉\n\n来源支持的完整正文。"
                    )
                },
            )()

    async def fake_provision(_content, _model_id, default_type, **kwargs):
        captured["default_type"] = default_type
        captured["kwargs"] = kwargs
        return BlogModel()

    monkeypatch.setattr(
        "api.learning_service.provision_langchain_model",
        fake_provision,
    )

    resources = await _generate_resources_from_sources(
        _context(),
        LearningOrchestrationRequest(
            message=_context()["message"],
            course=_context()["course"],
            mode="generate",
            requested_outputs=["blog"],
        ),
        "## Source 1: Attention paper\nScaled dot-product attention.",
    )

    assert captured["default_type"] == "asset_blog"
    assert captured["kwargs"] == {"max_tokens": 6144, "temperature": 0.45}
    assert resources[0].kind == "blog"
    assert resources[0].title == "为什么注意力要缩放？"
    assert resources[0].payload["provenance"] == ["Attention paper"]


@pytest.mark.asyncio
async def test_blog_model_slot_precedes_general_asset_fallback():
    manager = ModelManager()
    manager.get_defaults = AsyncMock(
        return_value=DefaultModels(
            default_blog_model="model:writer",
            default_learning_asset_model="model:flash",
        )
    )
    writer_model = object()
    manager.get_model = AsyncMock(return_value=writer_model)

    selected = await manager.get_default_model("asset_blog")

    assert selected is writer_model
    manager.get_model.assert_awaited_once_with("model:writer")
