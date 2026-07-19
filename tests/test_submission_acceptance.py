"""Offline acceptance tests mapped to the A3 competition requirements.

These tests deliberately exercise the deterministic orchestration contract so
they can be reproduced without a database or paid model credentials.
"""

import pytest

from api.learning_service import (
    _append_profile_event,
    build_learning_orchestration,
    stream_learning_orchestration,
)
from api.models import LearningOrchestrationRequest
from forgenote.podcasts.video_creator import build_keyframe_plan

EXPECTED_PROFILE_DIMENSIONS = {
    "专业背景",
    "知识基础",
    "学习目标",
    "认知风格",
    "易错点偏好",
    "资源偏好",
}

EXPECTED_AGENT_IDS = {
    "profile-agent",
    "curriculum-agent",
    "collector-agent",
    "resource-agent",
    "practice-agent",
    "path-agent",
    "tutor-agent",
    "evaluation-agent",
    "safety-agent",
}

EXPECTED_ASSET_KINDS = {
    "study_guide",
    "quiz",
    "flashcards",
    "mind_map",
    "reading",
    "code_lab",
    "visual_aid",
}


def _competition_request(**overrides):
    values = {
        "message": "我想系统学习半监督学习，并通过练习和代码验证理解。",
        "course": "人工智能导论",
        "major": "计算机科学与技术",
        "goal": "两周内完成课程项目",
        "learning_history": ["线性代数基础一般", "容易混淆方法的适用边界"],
        "requested_outputs": sorted(EXPECTED_ASSET_KINDS),
    }
    values.update(overrides)
    return LearningOrchestrationRequest(**values)


def test_a3_01_dialogue_builds_six_evidenced_profile_dimensions():
    result = build_learning_orchestration(_competition_request())

    dimensions = {item.name for item in result.profile}
    assert dimensions == EXPECTED_PROFILE_DIMENSIONS
    assert all(item.value.strip() for item in result.profile)
    assert all(item.evidence.strip() for item in result.profile)
    assert all(0 <= item.confidence <= 1 for item in result.profile)


def test_a3_02_generation_exposes_nine_completed_agent_roles():
    result = build_learning_orchestration(_competition_request())

    assert {stage.id for stage in result.trace} == EXPECTED_AGENT_IDS
    assert len({stage.role for stage in result.trace}) == len(EXPECTED_AGENT_IDS)
    assert all(stage.status == "completed" for stage in result.trace)
    assert all(stage.progress == 100 for stage in result.trace)


def test_a3_03_generates_seven_selectable_learning_asset_contracts():
    result = build_learning_orchestration(_competition_request())

    resources = {resource.kind: resource for resource in result.resources}
    assert resources.keys() == EXPECTED_ASSET_KINDS
    assert resources["quiz"].payload["questions"]
    assert resources["flashcards"].payload["cards"]
    assert resources["mind_map"].content.startswith("```mermaid")
    assert resources["code_lab"].format == "Python Notebook"
    assert resources["visual_aid"].payload["status"] == "fallback_prompt"


def test_a3_04_learning_path_is_ordered_and_has_closed_loop_checkpoints():
    result = build_learning_orchestration(_competition_request())

    assert [step.order for step in result.learning_path] == [1, 2, 3, 4]
    assert all(step.objective for step in result.learning_path)
    assert all(step.activities for step in result.learning_path)
    assert all(step.resources for step in result.learning_path)
    assert all(step.checkpoint for step in result.learning_path)
    assert result.evaluation.next_adjustments
    assert result.recommendations


def test_a3_05_missing_selected_source_text_blocks_ungrounded_generation():
    request = _competition_request(requested_outputs=["quiz", "flashcards"])
    result = build_learning_orchestration(
        request,
        collected_resources_override=[],
        generated_resources_override=[],
        has_selected_sources_without_text=True,
    )

    assert result.resources == []
    assert "为避免幻觉" in result.tutor_answer
    assert "没有生成" in result.tutor_answer
    assert result.safety_report.status == "passed"
    assert result.safety_report.checks


def test_a3_06_learning_events_update_the_persistable_profile_source():
    first = _append_profile_event(
        None,
        "chat_message",
        "User asked in notebook chat: 我不懂一致性正则化为什么要求标签保持不变",
    )
    second = _append_profile_event(
        first,
        "source_accept",
        "title=课程讲义; kind=lecture_notes; intent=半监督学习",
    )

    assert "[chat_message]" in second
    assert "[source_accept]" in second
    assert "需要澄清" in second
    assert "已采纳来源" in second


@pytest.mark.asyncio
async def test_a3_07_streaming_reports_agent_progress_before_the_final_result():
    request = _competition_request(
        mode="chat",
        requested_outputs=[],
    )
    events = [event async for event in stream_learning_orchestration(request)]

    stage_events = [event for event in events if event["type"] == "stage"]
    complete_events = [event for event in events if event["type"] == "complete"]
    progress = [event["stage"]["progress"] for event in stage_events]

    assert len(stage_events) == 8
    assert len(complete_events) == 1
    assert progress == sorted(progress)
    assert stage_events[0]["stage"]["status"] == "running"
    assert stage_events[-1]["stage"]["status"] == "completed"
    assert complete_events[0]["result"]["resources"] == []


def test_a3_08_explainer_video_cues_follow_the_real_speech_timeline():
    plan = build_keyframe_plan(
        [
            {
                "start_time": 0.6,
                "dialogue": "先建立半监督学习的整体图景。",
                "visual_prompt": "16:9 educational overview of semi-supervised learning",
            },
            {
                "start_time": 7.25,
                "dialogue": "再说明一致性正则化的训练流程。",
                "visual_prompt": "16:9 process diagram of consistency regularization",
            },
        ],
        episode_name="半监督学习讲解",
    )

    assert [cue["time_index"] for cue in plan] == [0.0, 7.25]
    assert all(cue["prompt"].startswith("16:9") for cue in plan)
