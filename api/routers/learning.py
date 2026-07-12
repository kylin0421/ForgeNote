import json

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from pydantic import BaseModel
from surreal_commands import submit_command

from api.learning_service import (
    build_learning_orchestration_with_search,
    get_or_create_learning_profile_source,
    record_learning_profile_event,
    stream_learning_orchestration,
)
from api.models import (
    LearningOrchestrationRequest,
    LearningOrchestrationResponse,
    LearningProfileEventRequest,
    LearningProfileSourceResponse,
)

router = APIRouter()


class LearningJobResponse(BaseModel):
    job_id: str
    status: str
    message: str


class LearningAssetJobItem(BaseModel):
    job_id: str
    output_kind: str


class LearningAssetJobsResponse(BaseModel):
    jobs: list[LearningAssetJobItem]


@router.post("/learning/orchestrate", response_model=LearningOrchestrationResponse)
async def orchestrate_learning(request: LearningOrchestrationRequest):
    """Run the learning multi-agent orchestration, including web resource search."""
    try:
        return await build_learning_orchestration_with_search(request)
    except Exception as e:
        logger.error(f"Learning orchestration failed: {e}")
        raise HTTPException(status_code=500, detail="Learning orchestration failed")


@router.post("/learning/resource-search/jobs", response_model=LearningJobResponse)
async def submit_resource_search_job(request: LearningOrchestrationRequest):
    """Submit agentic learning-resource search as a background command."""
    try:
        import commands.learning_commands  # noqa: F401

        payload = request.model_dump(mode="json")
        payload["mode"] = "collect"
        payload["requested_outputs"] = []
        payload.pop("image_model", None)
        job_id = submit_command(
            "open_notebook",
            "collect_learning_resources",
            payload,
        )
        return LearningJobResponse(
            job_id=str(job_id),
            status="submitted",
            message="Agentic search submitted",
        )
    except Exception as e:
        logger.error(f"Learning resource search job submission failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Learning resource search job submission failed",
        )


@router.post("/learning/assets/jobs", response_model=LearningAssetJobsResponse)
async def submit_learning_asset_jobs(request: LearningOrchestrationRequest):
    """Submit one background command per requested learning asset kind."""
    try:
        import commands.learning_commands  # noqa: F401

        jobs: list[LearningAssetJobItem] = []
        for output_kind in request.requested_outputs:
            payload = request.model_dump(mode="json")
            payload["mode"] = "generate"
            payload["output_kind"] = output_kind
            payload.pop("requested_outputs", None)
            job_id = submit_command(
                "open_notebook",
                "generate_learning_asset",
                payload,
            )
            jobs.append(
                LearningAssetJobItem(job_id=str(job_id), output_kind=output_kind)
            )

        return LearningAssetJobsResponse(jobs=jobs)
    except Exception as e:
        logger.error(f"Learning asset job submission failed: {e}")
        raise HTTPException(
            status_code=500,
            detail="Learning asset job submission failed",
        )


@router.get(
    "/learning/profile-source/{notebook_id}",
    response_model=LearningProfileSourceResponse,
)
async def ensure_learning_profile_source(notebook_id: str):
    """Ensure a notebook has exactly one editable learning-profile source."""
    try:
        source = await get_or_create_learning_profile_source(notebook_id)
        return LearningProfileSourceResponse(
            source_id=source.id,
            title=source.title or "学习画像",
            content=source.full_text or "",
            updated=str(source.updated) if source.updated else None,
            updated_profile=False,
        )
    except Exception as e:
        logger.error(f"Learning profile source ensure failed: {e}")
        raise HTTPException(status_code=500, detail="Learning profile source failed")


@router.post("/learning/profile-event", response_model=LearningProfileSourceResponse)
async def record_profile_event(request: LearningProfileEventRequest):
    """Record a concrete learning event into the notebook profile source."""
    try:
        source = await record_learning_profile_event(
            request.learning_record_id,
            request.event_type,
            request.summary,
            request.auto_update_profile,
        )
        if source is None:
            return LearningProfileSourceResponse(
                title="学习画像",
                content="",
                updated_profile=False,
            )
        return LearningProfileSourceResponse(
            source_id=source.id,
            title=source.title or "学习画像",
            content=source.full_text or "",
            updated=str(source.updated) if source.updated else None,
            updated_profile=True,
        )
    except Exception as e:
        logger.error(f"Learning profile event failed: {e}")
        raise HTTPException(status_code=500, detail="Learning profile event failed")


@router.post("/learning/orchestrate/stream")
async def stream_orchestrate_learning(request: LearningOrchestrationRequest):
    """Stream each agent stage so the UI can show generation progress."""

    async def event_stream():
        try:
            async for event in stream_learning_orchestration(request):
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except Exception as e:
            logger.error(f"Learning orchestration stream failed: {e}")
            error_data = {"type": "error", "message": "Learning orchestration failed"}
            yield f"data: {json.dumps(error_data)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
