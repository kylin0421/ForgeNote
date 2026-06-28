import pytest

from api.learning_service import (
    _normalize_generated_resources,
    _normalize_generated_markdown,
    _source_grounded_fallback_resources,
    build_learning_orchestration,
    collect_learning_resources,
    stream_learning_orchestration,
)
from api.models import LearningOrchestrationRequest
from api.web_search import WebSearchResult


async def fake_search_web(query: str, limit: int = 5):
    return [
        WebSearchResult(
            title=f"{query} result {index}",
            url=f"https://example.com/{index}?q={query}",
            snippet="A search result snippet",
            query=query,
        )
        for index in range(1, min(limit, 2) + 1)
    ]


def test_normalize_generated_markdown_repairs_table_rows():
    content = "\n".join(
        [
            "# Section",
            "",
            "| Concept | Difference |",
            "|----------|------------|",
            "| **Self-supervised vs unsupervised*",
            "* | Uses pretext labels instead of direct human labels. |",
        ]
    )

    normalized = _normalize_generated_markdown(content)

    assert (
        "| **Self-supervised vs unsupervised** | "
        "Uses pretext labels instead of direct human labels. |"
    ) in normalized
    assert "*\n* |" not in normalized


def test_normalize_generated_markdown_keeps_table_cell_minus_inline():
    content = "\n".join(
        [
            "| Concept | Difference |",
            "| --- | --- |",
            "| generation - contrast | Keep this on one table row. |",
        ]
    )

    normalized = _normalize_generated_markdown(content)

    assert "| generation - contrast | Keep this on one table row. |" in normalized


def test_normalize_generated_resources_derives_type_from_kind():
    resources = _normalize_generated_resources(
        {
            "resources": [
                {
                    "kind": "quiz",
                    "type": "Diagnostic",
                    "title": "SSL quiz",
                    "agent": "resource-agent",
                    "format": "interactive",
                    "summary": "Check understanding.",
                    "content": "Question content",
                    "tags": [],
                    "payload": {
                        "questions": [
                            {
                                "id": "q1",
                                "prompt": "Question?",
                                "options": ["A", "B", "C", "D"],
                                "answer_index": 0,
                                "explanation": "Because source says so.",
                            }
                        ]
                    },
                }
            ]
        },
        {
            "message": "generate quiz",
            "course": "SSL",
            "major": "CS",
            "goal": "review",
            "history": "none",
        },
        ["quiz"],
        "source context",
    )

    assert resources[0].type != "Diagnostic"
    assert resources[0].type == "小测验"


def test_learning_orchestration_meets_competition_requirements():
    result = build_learning_orchestration(
        LearningOrchestrationRequest(
            message="我想两周内学会监督学习，线性代数基础一般，需要讲解、练习和代码案例。",
            course="人工智能导论",
            major="计算机科学与技术",
            goal="完成分类实验",
            learning_history=["线性代数基础一般", "容易混淆梯度下降"],
        )
    )

    assert len(result.profile) >= 6
    assert len(result.collected_resources) >= 5
    assert len(result.resources) >= 5
    assert any(stage.id == "collector-agent" for stage in result.trace)
    assert any(
        resource.adoption_status == "user_upload"
        for resource in result.collected_resources
    )
    assert any(resource.type == "代码实操案例" for resource in result.resources)
    assert any(stage.id == "safety-agent" for stage in result.trace)
    assert result.safety_report.status == "passed"


def test_learning_orchestration_only_returns_requested_outputs():
    result = build_learning_orchestration(
        LearningOrchestrationRequest(
            message="我只想先做测验和知识闪卡。",
            course="机器学习",
            requested_outputs=["quiz", "flashcards"],
        )
    )

    assert [resource.kind for resource in result.resources] == [
        "quiz",
        "flashcards",
    ]
    assert {resource.type for resource in result.resources} == {"小测验", "知识闪卡"}
    assert result.resources[0].payload["questions"]
    assert result.resources[1].payload["cards"]


def test_source_grounded_fallback_uses_source_terms():
    source_context = """
## Source 1: Classic SSL paper
Semi-supervised learning uses a small labeled set together with a larger unlabeled set.
Consistency regularization trains the model to make stable predictions under perturbations.
Pseudo-labeling converts confident model predictions on unlabeled examples into training targets.
Entropy minimization encourages decision boundaries to avoid high-density regions.
"""
    resources = _source_grounded_fallback_resources(
        {
            "message": "生成经典 SSL 论文的 quiz 和闪卡",
            "course": "经典 SSL 论文",
            "major": "计算机科学",
            "goal": "理解半监督学习方法",
            "history": "暂无",
        },
        ["quiz", "flashcards"],
        source_context,
    )

    combined = " ".join(
        [
            resources[0].content,
            str(resources[0].payload),
            resources[1].content,
            str(resources[1].payload),
        ]
    )

    assert "Consistency regularization" in combined
    assert "Pseudo-labeling" in combined
    assert "学习画像" not in combined
    assert "先 Quiz 再长文档" not in combined


def test_source_grounded_mind_map_ignores_learning_profile_block():
    source_context = """
## Source 1: 学习画像
ID: source:profile
Topics: learning_profile

# 学习画像
易错点：等待 Quiz、对话、资料采纳和生成资产后的学习信号更新。

## Source 2: Classic SSL paper
Contrastive learning aligns augmented views of the same image.
Masked language modeling predicts hidden tokens from context.
"""
    resources = _source_grounded_fallback_resources(
        {
            "message": "generate SSL mind map",
            "course": "Classic SSL papers",
            "major": "CS",
            "goal": "understand self-supervised learning",
            "history": "none",
        },
        ["mind_map"],
        source_context,
    )

    content = resources[0].content
    assert content.startswith("mindmap")
    assert "learning_profile" not in content
    assert "学习画像" not in content
    assert "Contrastive learning" in content
    assert "Masked language modeling" in content


def test_learning_orchestration_generates_long_study_guide():
    result = build_learning_orchestration(
        LearningOrchestrationRequest(
            message="我需要一份完整讲解文档。",
            course="机器学习",
            requested_outputs=["study_guide"],
        )
    )

    guide = result.resources[0]
    assert guide.kind == "study_guide"
    assert len(guide.content) > 900
    assert "## 6. 自检清单" in guide.content


def test_learning_chat_mode_does_not_dump_generated_assets():
    result = build_learning_orchestration(
        LearningOrchestrationRequest(
            message="我应该先复习哪个知识点？",
            course="机器学习",
            mode="chat",
            requested_outputs=[],
        )
    )

    assert result.resources == []
    assert result.collected_resources == []
    assert any(stage.id == "tutor-agent" for stage in result.trace)
    assert all(stage.id != "resource-agent" for stage in result.trace)


@pytest.mark.asyncio
async def test_learning_collect_uses_web_search_results(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    resources = await collect_learning_resources(
        {
            "message": "我需要机器学习资料",
            "course": "机器学习",
            "major": "计算机科学",
            "goal": "复习",
            "history": "暂无",
        }
    )

    assert any(resource.provider == "DuckDuckGo HTML" for resource in resources)
    assert any(resource.url and "example.com" in resource.url for resource in resources)
    web_resources = [resource for resource in resources if resource.url]
    assert all(resource.source_type == "Agentic Web Search" for resource in web_resources)
    assert all(resource.quality_score is not None for resource in web_resources)
    assert all(resource.resource_kind for resource in web_resources)
    assert all(resource.learning_value for resource in web_resources)


@pytest.mark.asyncio
async def test_learning_stream_reports_stage_progress_and_final_result(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    request = LearningOrchestrationRequest(
        message="我需要机器学习复习计划，并希望系统推荐资源。",
        course="机器学习",
    )

    events = []
    async for event in stream_learning_orchestration(request):
        events.append(event)

    stage_events = [event for event in events if event["type"] == "stage"]
    complete_events = [event for event in events if event["type"] == "complete"]

    assert stage_events
    assert complete_events
    assert stage_events[0]["stage"]["status"] == "running"
    assert complete_events[0]["result"]["collected_resources"]
    assert complete_events[0]["result"]["resources"]
