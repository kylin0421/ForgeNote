from fastapi import APIRouter, HTTPException
from loguru import logger

from api.command_service import CommandService
from api.models import EmbedRequest, EmbedResponse
from open_notebook.ai.models import model_manager
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import Note, Source
from open_notebook.exceptions import NotFoundError

router = APIRouter()


async def _ensure_index_backend_available() -> None:
    settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
    backend = settings.embedding_backend or "embedding_api"

    if backend == "embedding_api" and not await model_manager.get_embedding_model():
        raise HTTPException(
            status_code=400,
            detail="No embedding model configured. Please configure one in the Models section.",
        )
    if backend == "llm_bm25" and not await model_manager.get_default_model("retrieval"):
        raise HTTPException(
            status_code=400,
            detail="No language model configured. Please configure a chat or transformation model in the Models section.",
        )


@router.post("/embed", response_model=EmbedResponse)
async def embed_content(embed_request: EmbedRequest):
    """Embed content for vector search."""
    try:
        item_id = embed_request.item_id
        item_type = embed_request.item_type.lower()

        # Validate item type
        if item_type not in ["source", "note"]:
            raise HTTPException(
                status_code=400, detail="Item type must be either 'source' or 'note'"
            )

        source_item = None
        note_item = None
        if not embed_request.async_processing:
            if item_type == "source":
                source_item = await Source.get(item_id)
                if not source_item:
                    raise NotFoundError(f"Source {item_id} not found")
            elif item_type == "note":
                note_item = await Note.get(item_id)
                if not note_item:
                    raise NotFoundError(f"Note {item_id} not found")

        await _ensure_index_backend_available()

        # Branch based on processing mode
        if embed_request.async_processing:
            # ASYNC PATH: Submit command for background processing
            logger.info(f"Using async processing for {item_type} {item_id}")

            try:
                # Import commands to ensure they're registered
                import commands.embedding_commands  # noqa: F401

                # Submit type-specific command
                if item_type == "source":
                    command_name = "embed_source"
                    command_input = {"source_id": item_id}
                else:  # note
                    command_name = "embed_note"
                    command_input = {"note_id": item_id}

                command_id = await CommandService.submit_command_job(
                    "open_notebook",
                    command_name,
                    command_input,
                )

                logger.info(f"Submitted async {command_name} command: {command_id}")

                return EmbedResponse(
                    success=True,
                    message="Embedding queued for background processing",
                    item_id=item_id,
                    item_type=item_type,
                    command_id=command_id,
                )

            except Exception as e:
                logger.error(f"Failed to submit async embedding command: {e}")
                raise HTTPException(
                    status_code=500, detail=f"Failed to queue embedding: {str(e)}"
                )

        else:
            # DOMAIN MODEL PATH: Submit job via domain model convenience methods
            # These methods internally call submit_command() - still fire-and-forget
            logger.info(f"Using domain model path for {item_type} {item_id}")

            command_id = None

            # Get the item and submit embedding job
            if item_type == "source":
                # Submit embed_source job (returns command_id for tracking)
                command_id = await source_item.vectorize()
                message = "Source embedding job submitted"

            elif item_type == "note":
                # Note.save() internally submits embed_note command and returns command_id
                command_id = await note_item.save()
                message = "Note embedding job submitted"

            return EmbedResponse(
                success=True,
                message=message,
                item_id=item_id,
                item_type=item_type,
                command_id=command_id,
            )

    except HTTPException:
        raise
    except NotFoundError:
        raise HTTPException(
            status_code=404, detail=f"{embed_request.item_type} not found"
        )
    except Exception as e:
        logger.error(
            f"Error embedding {embed_request.item_type} {embed_request.item_id}: {str(e)}"
        )
        raise HTTPException(
            status_code=500, detail=f"Error embedding content: {str(e)}"
        )
