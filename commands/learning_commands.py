import json
import time
from typing import List, Literal, Optional

from surreal_commands import CommandInput, CommandOutput, command

from api.learning_service import build_learning_orchestration_with_search
from api.models import (
    LearningCollectedResource,
    LearningOrchestrationRequest,
    LearningOutputKind,
    LearningResource,
    LearningSupplementalMaterial,
)
from open_notebook.domain.notebook import Note, Notebook
from open_notebook.utils.command_cancellation import raise_if_command_canceled


class LearningResourceSearchInput(CommandInput):
    message: str
    mode: Literal["collect"] = "collect"
    course: str
    major: Optional[str] = None
    goal: Optional[str] = None
    learning_history: List[str] = []
    requested_outputs: List[str] = []
    accepted_resource_ids: List[str] = []
    supplemental_materials: List[LearningSupplementalMaterial] = []
    learning_record_id: Optional[str] = None
    target_language: Optional[str] = None
    image_model: Optional[str] = None
    auto_update_profile: bool = True
    use_profile_source: bool = True


class LearningResourceSearchOutput(CommandOutput):
    success: bool
    collected_resources: List[LearningCollectedResource] = []
    response: Optional[dict] = None
    resources_found: int = 0
    processing_time: float
    error_message: Optional[str] = None


class LearningAssetGenerationInput(CommandInput):
    output_kind: LearningOutputKind
    message: str
    mode: Literal["generate"] = "generate"
    course: str
    major: Optional[str] = None
    goal: Optional[str] = None
    learning_history: List[str] = []
    accepted_resource_ids: List[str] = []
    supplemental_materials: List[LearningSupplementalMaterial] = []
    learning_record_id: str
    target_language: Optional[str] = None
    image_model: Optional[str] = None
    auto_update_profile: bool = True
    use_profile_source: bool = True


class LearningAssetGenerationOutput(CommandOutput):
    success: bool
    output_kind: LearningOutputKind
    note_id: Optional[str] = None
    title: Optional[str] = None
    processing_time: float
    error_message: Optional[str] = None


LEARNING_ASSET_KIND_LABELS = {
    "study_guide": "课程学习讲解",
    "quiz": "小测验",
    "flashcards": "知识闪卡",
    "mind_map": "思维导图",
    "reading": "拓展阅读材料",
    "code_lab": "代码实操案例",
    "visual_aid": "辅助理解图片",
}


def learning_asset_kind_label(kind: str) -> str:
    return LEARNING_ASSET_KIND_LABELS.get(kind, kind)


def _request_from_input(input_data: LearningResourceSearchInput) -> LearningOrchestrationRequest:
    payload = input_data.model_dump(exclude={"execution_context"})
    payload["mode"] = "collect"
    payload["requested_outputs"] = []
    return LearningOrchestrationRequest(**payload)


def _asset_request_from_input(
    input_data: LearningAssetGenerationInput,
) -> LearningOrchestrationRequest:
    payload = input_data.model_dump(exclude={"execution_context", "output_kind"})
    payload["mode"] = "generate"
    payload["requested_outputs"] = [input_data.output_kind]
    return LearningOrchestrationRequest(**payload)


def serialize_learning_asset_note(resource: LearningResource) -> str:
    metadata = resource.model_dump()
    kind_label = learning_asset_kind_label(resource.kind)
    metadata["type"] = kind_label
    visible_content = "\n".join(
        [
            f"# {resource.title}",
            f"资产类型：{kind_label}",
            f"类型：{kind_label}",
            f"格式：{resource.format}",
            f"智能体：{resource.agent}",
            "",
            "## 摘要",
            resource.summary,
            "",
            "## 内容",
            resource.content,
            "",
            f"标签：{'、'.join(resource.tags)}",
        ]
    )
    return "\n".join(
        [
            "<!-- learning-asset",
            json.dumps(metadata, ensure_ascii=False),
            "-->",
            "",
            visible_content,
        ]
    )


async def create_learning_asset_note(
    notebook_id: str,
    resource: LearningResource,
) -> str:
    await Notebook.get(notebook_id)
    note = Note(
        title=resource.title,
        content=serialize_learning_asset_note(resource),
        note_type="ai",
    )
    await note.save()
    await note.add_to_notebook(notebook_id)
    return note.id or ""


@command("collect_learning_resources", app="open_notebook", retry={"max_attempts": 1})
async def collect_learning_resources_command(
    input_data: LearningResourceSearchInput,
) -> LearningResourceSearchOutput:
    start_time = time.time()
    command_id = (
        str(input_data.execution_context.command_id)
        if input_data.execution_context
        else None
    )

    try:
        await raise_if_command_canceled(command_id)
        response = await build_learning_orchestration_with_search(
            _request_from_input(input_data),
            command_id=command_id,
        )
        await raise_if_command_canceled(command_id)

        return LearningResourceSearchOutput(
            success=True,
            collected_resources=response.collected_resources,
            response=response.model_dump(),
            resources_found=len(
                [resource for resource in response.collected_resources if resource.url]
            ),
            processing_time=time.time() - start_time,
        )
    except ValueError as e:
        return LearningResourceSearchOutput(
            success=False,
            collected_resources=[],
            resources_found=0,
            processing_time=time.time() - start_time,
            error_message=str(e),
        )


@command("generate_learning_asset", app="open_notebook", retry={"max_attempts": 1})
async def generate_learning_asset_command(
    input_data: LearningAssetGenerationInput,
) -> LearningAssetGenerationOutput:
    start_time = time.time()
    command_id = (
        str(input_data.execution_context.command_id)
        if input_data.execution_context
        else None
    )

    try:
        await raise_if_command_canceled(command_id)
        response = await build_learning_orchestration_with_search(
            _asset_request_from_input(input_data),
            command_id=command_id,
        )
        await raise_if_command_canceled(command_id)

        resource = next(
            (
                item
                for item in response.resources
                if item.kind == input_data.output_kind
            ),
            response.resources[0] if response.resources else None,
        )
        if resource is None:
            raise ValueError(response.tutor_answer or "No learning asset generated")

        note_id = await create_learning_asset_note(input_data.learning_record_id, resource)
        await raise_if_command_canceled(command_id)

        return LearningAssetGenerationOutput(
            success=True,
            output_kind=input_data.output_kind,
            note_id=note_id,
            title=resource.title,
            processing_time=time.time() - start_time,
        )
    except ValueError as e:
        return LearningAssetGenerationOutput(
            success=False,
            output_kind=input_data.output_kind,
            processing_time=time.time() - start_time,
            error_message=str(e),
        )
