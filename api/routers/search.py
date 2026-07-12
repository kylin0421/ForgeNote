import json
import re
from typing import AsyncGenerator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from api.models import AskRequest, AskResponse, SearchRequest, SearchResponse
from open_notebook.ai.models import Model, model_manager
from open_notebook.domain.content_settings import ContentSettings
from open_notebook.domain.notebook import (
    Note,
    Source,
    SourceInsight,
    semantic_search,
    text_search,
    vector_search,
)
from open_notebook.exceptions import DatabaseOperationError, InvalidInputError
from open_notebook.graphs.ask import graph as ask_graph

router = APIRouter()


def _coerce_match_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        matches: list[str] = []
        for item in value:
            if isinstance(item, str):
                matches.append(item)
            elif isinstance(item, list):
                matches.extend(str(part) for part in item if part)
            elif item:
                matches.append(str(item))
        return [match for match in matches if match.strip()]
    return [str(value)] if str(value).strip() else []


def _search_terms(query: str) -> list[str]:
    compact = re.sub(r"\s+", " ", query).strip()
    if not compact:
        return []
    terms = [term for term in re.split(r"\s+", compact) if len(term) > 1]
    return terms or [compact]


def _clean_search_display_text(value: str) -> str:
    text = value or ""
    text = re.sub(
        r"<!--\s*(?:learning-asset|mind-map-visual)[\s\S]*?-->",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"^\s*(?:flowchart|graph|mindmap|direction)\b.*$", " ", text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r"```(?:[a-zA-Z0-9_-]+)?", " ", text)
    text = text.replace("```", " ")
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"!\[[^\]]*]\([^)]+\)", " ", text)
    text = re.sub(r"\[([^\]]+)]\([^)]+\)", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    text = re.sub(r"[*_~]{1,3}([^*_~]+)[*_~]{1,3}", r"\1", text)
    text = re.sub(r"^\s{0,3}#{1,6}\s*", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*[-*+]\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"^\s*\d+\.\s+", "", text, flags=re.MULTILINE)
    text = re.sub(r"\b(?:flowchart|graph)\s+(?:LR|RL|TD|TB|BT)\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\bmindmap\b|\bdirection\s+\w+\b", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"\b[A-Za-z][\w:-]*\s*(?:\(\(|\(|\[|\{)\s*([^()[\]{}]+?)\s*(?:\)\)|\)|]|\})", r"\1", text)
    text = re.sub(r"[-=]+>|--+|==+|[{}\[\]();]", " ", text)
    text = re.sub(r"[\"']", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _source_search_text(source: Source) -> str:
    asset = getattr(source, "asset", None)
    file_path = getattr(asset, "file_path", None) if asset else None
    url = getattr(asset, "url", None) if asset else None
    file_name = ""
    if file_path:
        file_name = str(file_path).replace("\\", "/").rsplit("/", 1)[-1]
    return "\n".join(
        part
        for part in [
            source.title or "",
            file_name,
            str(file_path or ""),
            str(url or ""),
            source.full_text or "",
        ]
        if part
    )


def _query_matches_text(query: str, text: str) -> bool:
    haystack = text.lower()
    compact_query = re.sub(r"\s+", " ", query).strip().lower()
    if not compact_query:
        return False
    if compact_query in haystack:
        return True
    terms = [term.lower() for term in _search_terms(query)]
    return bool(terms) and all(term in haystack for term in terms)


def _build_match_snippets(text: str | None, query: str, limit: int = 3) -> list[str]:
    if not text:
        return []
    normalized_text = _clean_search_display_text(text)
    if not normalized_text:
        return []

    lower_text = normalized_text.lower()
    snippets: list[str] = []
    seen: set[str] = set()
    for term in _search_terms(query):
        index = lower_text.find(term.lower())
        if index < 0:
            continue
        start = max(0, index - 90)
        end = min(len(normalized_text), index + len(term) + 130)
        snippet = normalized_text[start:end].strip()
        if start > 0:
            snippet = "…" + snippet
        if end < len(normalized_text):
            snippet += "…"
        if snippet not in seen:
            seen.add(snippet)
            snippets.append(snippet)
        if len(snippets) >= limit:
            break
    return snippets


async def _fallback_source_text_results(query: str, limit: int) -> list[dict]:
    try:
        sources = await Source.get_all(order_by="updated desc")
    except Exception as e:
        logger.debug(f"Unable to run fallback source text search: {e}")
        return []

    matches: list[dict] = []
    for source in sources:
        source_text = _source_search_text(source)
        if not _query_matches_text(query, source_text):
            continue
        source_id = str(source.id or "")
        if not source_id:
            continue
        matches.append(
            {
                "id": source_id,
                "parent_id": source_id,
                "title": source.title or "未命名来源",
                "relevance": 1,
            }
        )
        if len(matches) >= limit:
            break
    return matches


async def _load_result_text(parent_id: str | None) -> str:
    if not parent_id:
        return ""
    try:
        record_id = str(parent_id)
        if record_id.startswith("source_insight:"):
            insight = await SourceInsight.get(record_id)
            return insight.content or ""
        if record_id.startswith("source:"):
            source = await Source.get(record_id)
            return _source_search_text(source)
        if record_id.startswith("note:"):
            note = await Note.get(record_id)
            return "\n".join(
                part for part in [note.title or "", note.content or ""] if part
            )
    except Exception as e:
        logger.debug(f"Unable to load search result text for snippets: {e}")
    return ""


async def _add_search_match_snippets(results, query: str) -> list[dict]:
    enhanced: list[dict] = []
    for result in results or []:
        item = dict(result)
        if item.get("id") is not None:
            item["id"] = str(item["id"])
        if item.get("parent_id") is not None:
            item["parent_id"] = str(item["parent_id"])

        matches = _coerce_match_list(item.get("matches") or item.get("content"))
        matches = [_clean_search_display_text(match) for match in matches]
        matches = [match for match in matches if match]
        if not matches:
            text = await _load_result_text(item.get("parent_id") or item.get("id"))
            matches = _build_match_snippets(text, query)
        item["matches"] = matches[:3]
        item.pop("content", None)
        enhanced.append(item)
    return enhanced


def _merge_search_results(primary: list, fallback: list[dict], limit: int) -> list:
    merged: list = []
    seen: set[str] = set()
    for result in fallback + list(primary or []):
        item = dict(result)
        key = str(item.get("parent_id") or item.get("id") or "")
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(item)
        if len(merged) >= limit:
            break
    return merged


@router.post("/search", response_model=SearchResponse)
async def search_knowledge_base(search_request: SearchRequest):
    """Search the knowledge base using text or vector search."""
    try:
        if search_request.type == "vector":
            settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
            backend = settings.embedding_backend or "embedding_api"
            # Check if the selected semantic backend is available.
            if backend == "embedding_api" and not await model_manager.get_embedding_model():
                raise HTTPException(
                    status_code=400,
                    detail="Vector search requires an embedding model. Please configure one in the Models section.",
                )
            if backend == "llm_bm25" and not await model_manager.get_default_model("retrieval"):
                raise HTTPException(
                    status_code=400,
                    detail="LLM-BM25 search requires a chat or transformation model. Please configure one in the Models section.",
                )

            results = await semantic_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
                minimum_score=search_request.minimum_score,
            )
        else:
            # Text search
            results = await text_search(
                keyword=search_request.query,
                results=search_request.limit,
                source=search_request.search_sources,
                note=search_request.search_notes,
            )

        fallback_results = (
            await _fallback_source_text_results(search_request.query, search_request.limit)
            if search_request.search_sources
            else []
        )
        merged_results = _merge_search_results(
            results or [],
            fallback_results,
            search_request.limit,
        )

        enhanced_results = await _add_search_match_snippets(
            merged_results,
            search_request.query,
        )

        return SearchResponse(
            results=enhanced_results,
            total_count=len(enhanced_results),
            search_type=search_request.type,
        )

    except InvalidInputError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except DatabaseOperationError as e:
        logger.error(f"Database error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error during search: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Search failed: {str(e)}")


async def stream_ask_response(
    question: str, strategy_model: Model, answer_model: Model, final_answer_model: Model
) -> AsyncGenerator[str, None]:
    """Stream the ask response as Server-Sent Events."""
    try:
        final_answer = None

        async for chunk in ask_graph.astream(
            input=dict(question=question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "agent" in chunk:
                strategy_data = {
                    "type": "strategy",
                    "reasoning": chunk["agent"]["strategy"].reasoning,
                    "searches": [
                        {"term": search.term, "instructions": search.instructions}
                        for search in chunk["agent"]["strategy"].searches
                    ],
                }
                yield f"data: {json.dumps(strategy_data)}\n\n"

            elif "provide_answer" in chunk:
                for answer in chunk["provide_answer"]["answers"]:
                    answer_data = {"type": "answer", "content": answer}
                    yield f"data: {json.dumps(answer_data)}\n\n"

            elif "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]
                final_data = {"type": "final_answer", "content": final_answer}
                yield f"data: {json.dumps(final_data)}\n\n"

        # Send completion signal
        completion_data = {"type": "complete", "final_answer": final_answer}
        yield f"data: {json.dumps(completion_data)}\n\n"

    except Exception as e:
        from open_notebook.utils.error_classifier import classify_error

        _, user_message = classify_error(e)
        logger.error(f"Error in ask streaming: {str(e)}")
        error_data = {"type": "error", "message": user_message}
        yield f"data: {json.dumps(error_data)}\n\n"


@router.post("/search/ask")
async def ask_knowledge_base(ask_request: AskRequest):
    """Ask the knowledge base a question using AI models."""
    try:
        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
        backend = settings.embedding_backend or "embedding_api"
        if backend == "embedding_api" and not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )
        if backend == "llm_bm25" and not await model_manager.get_default_model("retrieval"):
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires a chat or transformation model for LLM-BM25 search.",
            )

        # For streaming response
        return StreamingResponse(
            stream_ask_response(
                ask_request.question, strategy_model, answer_model, final_answer_model
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")


@router.post("/search/ask/simple", response_model=AskResponse)
async def ask_knowledge_base_simple(ask_request: AskRequest):
    """Ask the knowledge base a question and return a simple response (non-streaming)."""
    try:
        # Validate models exist
        strategy_model = await Model.get(ask_request.strategy_model)
        answer_model = await Model.get(ask_request.answer_model)
        final_answer_model = await Model.get(ask_request.final_answer_model)

        if not strategy_model:
            raise HTTPException(
                status_code=400,
                detail=f"Strategy model {ask_request.strategy_model} not found",
            )
        if not answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Answer model {ask_request.answer_model} not found",
            )
        if not final_answer_model:
            raise HTTPException(
                status_code=400,
                detail=f"Final answer model {ask_request.final_answer_model} not found",
            )

        settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
        backend = settings.embedding_backend or "embedding_api"
        if backend == "embedding_api" and not await model_manager.get_embedding_model():
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires an embedding model. Please configure one in the Models section.",
            )
        if backend == "llm_bm25" and not await model_manager.get_default_model("retrieval"):
            raise HTTPException(
                status_code=400,
                detail="Ask feature requires a chat or transformation model for LLM-BM25 search.",
            )

        # Run the ask graph and get final result
        final_answer = None
        async for chunk in ask_graph.astream(
            input=dict(question=ask_request.question),  # type: ignore[arg-type]
            config=dict(
                configurable=dict(
                    strategy_model=strategy_model.id,
                    answer_model=answer_model.id,
                    final_answer_model=final_answer_model.id,
                )
            ),
            stream_mode="updates",
        ):
            if "write_final_answer" in chunk:
                final_answer = chunk["write_final_answer"]["final_answer"]

        if not final_answer:
            raise HTTPException(status_code=500, detail="No answer generated")

        return AskResponse(answer=final_answer, question=ask_request.question)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in ask simple endpoint: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Ask operation failed: {str(e)}")
