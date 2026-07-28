import asyncio
import json
from types import SimpleNamespace

import pytest

from api.learning_service import (
    _LEARNING_WORKFLOW_TIMERS,
    _update_learning_workflow_progress,
    generate_learning_profile_interview,
)
from api.models import (
    LearningProfileInterviewRequest,
    LearningProfileInterviewTurn,
)


def profile_payload(*, question_prompt: str, complete: bool = False):
    values = {
        "major": "计算机专业大二",
        "goal": "两周后独立完成机器学习课程项目",
        "knowledge": "理解线性回归，但正则化基础较弱",
        "learning_history": "看过课程视频，缺少系统练习",
        "cognitive_style": "先看实例再理解推导",
        "mistakes": "容易混淆 L1 与 L2",
        "pace": "",
        "resource_preference": "",
    }
    return {
        "assistant_message": "你已经说明了目标和当前卡点。",
        "question": None
        if complete
        else {
            "id": "adaptive-pace",
            "dimension": "pace",
            "eyebrow": "学习节奏",
            "prompt": question_prompt,
            "helper": "这会决定学习路径的颗粒度。",
            "suggestions": ["每天 30 分钟", "周末集中学习"],
        },
        "profile": [
            {
                "key": key,
                "value": value,
                "evidence": f"学生关于 {key} 的回答" if value else "",
                "confidence": 0.8 if value else 0.0,
            }
            for key, value in values.items()
        ],
        "complete": complete,
        "search_goal": "机器学习正则化课程项目资料",
    }


@pytest.mark.asyncio
async def test_profile_interview_calls_llm_with_prior_answers(monkeypatch):
    captured_messages = []

    class FakeModel:
        async def ainvoke(self, messages):
            captured_messages.append(messages)
            return SimpleNamespace(
                content=json.dumps(
                    profile_payload(
                        question_prompt="你每天能投入多久来攻克刚才提到的正则化难点？"
                    ),
                    ensure_ascii=False,
                )
            )

    async def fake_provision(*args, **kwargs):
        assert args[2] == "profile_interview"
        assert kwargs["structured"] == {"type": "json"}
        return FakeModel()

    monkeypatch.setattr(
        "api.learning_service.provision_langchain_model",
        fake_provision,
    )
    request = LearningProfileInterviewRequest(
        learning_record_id="notebook:adaptive",
        topic="机器学习",
        turns=[
            LearningProfileInterviewTurn(
                question_id="goal-1",
                dimension="goal",
                question="你希望学到什么程度？",
                answer="两周后完成项目，但正则化一直没学懂。",
            )
        ],
    )

    response = await generate_learning_profile_interview(request)

    assert len(captured_messages) == 1
    assert "两周后完成项目" in captured_messages[0][1].content
    assert response.question is not None
    assert "刚才提到的正则化难点" in response.question.prompt
    assert len(response.covered_dimensions) == 6
    assert response.complete is False


@pytest.mark.asyncio
async def test_workflow_progress_records_each_step_duration(monkeypatch):
    updates = []

    async def fake_repo_query(query, params):
        updates.append(params["progress"])
        return []

    monkeypatch.setattr("api.learning_service.repo_query", fake_repo_query)
    command_id = "command:timed-workflow"
    _LEARNING_WORKFLOW_TIMERS.pop(command_id, None)

    await _update_learning_workflow_progress(
        command_id,
        "collect",
        "profile-agent",
        "正在分析画像",
        10,
    )
    await asyncio.sleep(0.01)
    await _update_learning_workflow_progress(
        command_id,
        "collect",
        "curriculum-agent",
        "正在拆解课程",
        35,
        {"profile-agent"},
    )
    await asyncio.sleep(0.01)
    await _update_learning_workflow_progress(
        command_id,
        "collect",
        None,
        "已完成",
        100,
        {
            "profile-agent",
            "curriculum-agent",
            "collector-agent",
            "safety-agent",
        },
    )

    first_profile_step = updates[0]["steps"][0]
    second_profile_step = updates[1]["steps"][0]
    current_curriculum_step = updates[1]["steps"][1]
    final_progress = updates[-1]

    assert first_profile_step["status"] == "running"
    assert first_profile_step["started_at"]
    assert second_profile_step["status"] == "completed"
    assert second_profile_step["duration_seconds"] is not None
    assert current_curriculum_step["status"] == "running"
    assert current_curriculum_step["elapsed_seconds"] is not None
    assert final_progress["duration_seconds"] is not None
    assert all(
        step["duration_seconds"] is not None
        for step in final_progress["steps"]
    )
    assert command_id not in _LEARNING_WORKFLOW_TIMERS
