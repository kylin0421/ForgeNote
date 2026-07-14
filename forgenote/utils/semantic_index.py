import json
import re
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Sequence

from loguru import logger

from forgenote.ai.provision import provision_langchain_model
from forgenote.database.repository import ensure_record_id, repo_query
from forgenote.domain.content_settings import ContentSettings
from forgenote.exceptions import ConfigurationError, InvalidInputError
from forgenote.utils.error_classifier import raise_if_provider_access_error
from forgenote.utils.text_utils import clean_thinking_content, extract_text_content

LLM_BM25_BACKEND = "llm_bm25"
EMBEDDING_API_BACKEND = "embedding_api"
RRF_K = 60
RERANK_CANDIDATES = 30
PER_QUERY_LIMIT = 20


async def get_search_backend() -> str:
    settings: ContentSettings = await ContentSettings.get_instance()  # type: ignore[assignment]
    return settings.embedding_backend or EMBEDDING_API_BACKEND


async def is_llm_bm25_backend() -> bool:
    return await get_search_backend() == LLM_BM25_BACKEND


def _as_str_list(value: Any, *, limit: int = 20) -> List[str]:
    if not isinstance(value, list):
        return []
    result: List[str] = []
    for item in value[:limit]:
        if isinstance(item, str):
            text = item.strip()
            if text:
                result.append(text)
    return result


def _extract_json_payload(text: str) -> Any:
    cleaned = clean_thinking_content(text).strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass

    candidates = []
    object_start = cleaned.find("{")
    object_end = cleaned.rfind("}")
    if object_start != -1 and object_end > object_start:
        candidates.append(cleaned[object_start : object_end + 1])
    array_start = cleaned.find("[")
    array_end = cleaned.rfind("]")
    if array_start != -1 and array_end > array_start:
        candidates.append(cleaned[array_start : array_end + 1])

    for candidate in candidates:
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            continue

    raise ValueError("Model did not return valid JSON")


def _fallback_chunk_metadata(chunk: str) -> Dict[str, Any]:
    preview = " ".join(chunk.split())[:500]
    return {
        "summary": preview,
        "keywords": [],
        "questions": [],
        "entities": [],
        "contains": {
            "method": False,
            "experiment": False,
            "formula": False,
            "algorithm": False,
            "limitation": False,
        },
    }


def _normalize_contains(value: Any) -> Dict[str, bool]:
    allowed = ["method", "experiment", "formula", "algorithm", "limitation"]
    if not isinstance(value, dict):
        return {key: False for key in allowed}
    return {key: bool(value.get(key, False)) for key in allowed}


def _normalize_chunk_metadata(payload: Any, chunk: str) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return _fallback_chunk_metadata(chunk)

    summary = payload.get("summary")
    if not isinstance(summary, str) or not summary.strip():
        summary = _fallback_chunk_metadata(chunk)["summary"]

    return {
        "summary": summary.strip(),
        "keywords": _as_str_list(payload.get("keywords"), limit=15),
        "questions": _as_str_list(payload.get("questions"), limit=8),
        "entities": _as_str_list(payload.get("entities"), limit=20),
        "contains": _normalize_contains(payload.get("contains")),
    }


async def generate_chunk_metadata(
    chunk: str,
    *,
    title: Optional[str] = None,
    section: Optional[str] = None,
    command_id: Optional[str] = None,
) -> Dict[str, Any]:
    prompt = f"""
You are an academic-paper RAG indexer. Generate structured retrieval metadata for the chunk below.

Requirements:
1. Do not add facts that are not present in the source chunk.
2. Write a 1-3 sentence English summary.
3. Extract 5-15 English keywords or technical terms.
4. Generate 3-8 questions this chunk can answer.
5. If the chunk contains formulas, algorithms, methods, experiments, or limitations, mark them explicitly.

Return only JSON with this shape:
{{
  "summary": "...",
  "keywords": ["..."],
  "questions": ["..."],
  "entities": ["..."],
  "contains": {{
    "method": true,
    "experiment": false,
    "formula": false,
    "algorithm": false,
    "limitation": false
  }}
}}

Title: {title or ""}
Section: {section or ""}
Chunk:
{chunk}
""".strip()

    model = await provision_langchain_model(
        prompt,
        None,
        "retrieval",
        max_tokens=1200,
        structured=dict(type="json"),
    )
    try:
        ai_message = await model.ainvoke(prompt)
        raw_text = extract_text_content(ai_message.content)
        payload = _extract_json_payload(raw_text)
        return _normalize_chunk_metadata(payload, chunk)
    except ConfigurationError:
        raise
    except Exception as e:
        raise_if_provider_access_error(e)
        logger.warning(
            "Failed to generate LLM-BM25 metadata for chunk "
            f"(command={command_id or 'unknown'}): {e}"
        )
        return _fallback_chunk_metadata(chunk)


def compose_search_document(
    *,
    title: Optional[str],
    section: str,
    raw_text: str,
    summary: str,
    keywords: Sequence[str],
    questions: Sequence[str],
    entities: Sequence[str],
    contains: Dict[str, bool],
) -> str:
    true_contains = [key for key, value in contains.items() if value]
    return "\n".join(
        [
            f"Title: {title or 'Untitled source'}",
            f"Section: {section}",
            f"Raw text: {raw_text}",
            f"Summary: {summary}",
            f"Keywords: {', '.join(keywords)}",
            f"Hypothetical questions: {' | '.join(questions)}",
            f"Entities: {', '.join(entities)}",
            f"Contains: {', '.join(true_contains)}",
        ]
    )


async def build_llm_bm25_source_records(
    source: Any,
    chunks: Sequence[str],
    *,
    command_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    records: List[Dict[str, Any]] = []
    source_id = str(source.id)
    title = getattr(source, "title", None)
    if command_id:
        from forgenote.utils.command_cancellation import raise_if_command_canceled

        await raise_if_command_canceled(command_id)

    for idx, chunk in enumerate(chunks):
        if command_id:
            await raise_if_command_canceled(command_id)
        section = f"chunk {idx + 1}"
        metadata = await generate_chunk_metadata(
            chunk,
            title=title,
            section=section,
            command_id=command_id,
        )
        search_document = compose_search_document(
            title=title,
            section=section,
            raw_text=chunk,
            summary=metadata["summary"],
            keywords=metadata["keywords"],
            questions=metadata["questions"],
            entities=metadata["entities"],
            contains=metadata["contains"],
        )
        records.append(
            {
                "source": ensure_record_id(source_id),
                "order": idx,
                "content": search_document,
                "raw_text": chunk,
                "summary": metadata["summary"],
                "keywords": metadata["keywords"],
                "hypothetical_questions": metadata["questions"],
                "entities": metadata["entities"],
                "contains": metadata["contains"],
                "embedding": [],
                "index_backend": LLM_BM25_BACKEND,
            }
        )
        if command_id:
            await raise_if_command_canceled(command_id)

    return records


async def rewrite_search_queries(query: str) -> List[str]:
    if not query.strip():
        raise InvalidInputError("Search query cannot be empty")

    prompt = f"""
You are a RAG query rewriter. The user may ask in Chinese, English, or mixed language. Documents are often English academic papers.

Generate 4-8 BM25/full-text search queries.
Requirements:
1. Preserve key entities from the original question.
2. Add English terms that may appear in papers.
3. Prefer keyword-heavy queries over long natural sentences.
4. Cover different phrasings.
5. Do not introduce obviously unrelated concepts.

User question:
{query}

Return only a JSON list of strings.
""".strip()

    try:
        model = await provision_langchain_model(
            prompt,
            None,
            "retrieval",
            max_tokens=700,
            structured=dict(type="json"),
        )
        ai_message = await model.ainvoke(prompt)
        payload = _extract_json_payload(extract_text_content(ai_message.content))
        rewrites = _as_str_list(payload, limit=8)
    except ConfigurationError:
        raise
    except Exception as e:
        raise_if_provider_access_error(e)
        logger.warning(f"Failed to rewrite LLM-BM25 query, using raw query: {e}")
        rewrites = []

    queries = [query.strip()]
    for rewritten in rewrites:
        if rewritten and rewritten not in queries:
            queries.append(rewritten)
    return queries[:8]


async def _source_bm25(query: str, limit: int, source_ids: Optional[List[str]]) -> List[Dict[str, Any]]:
    vars: Dict[str, Any] = {"query": query, "limit": limit}
    where = "content @1@ $query"
    if source_ids:
        vars["source_ids"] = [ensure_record_id(source_id) for source_id in source_ids]
        where += " AND source IN $source_ids"

    return await repo_query(
        f"""
        SELECT
            id,
            source.id AS source_id,
            source.title AS title,
            order,
            raw_text,
            content,
            summary,
            keywords,
            hypothetical_questions,
            search::score(1) AS bm25_score
        FROM source_embedding
        WHERE {where}
        ORDER BY bm25_score DESC
        LIMIT $limit;
        """,
        vars,
    )


async def _note_bm25(query: str, limit: int) -> List[Dict[str, Any]]:
    return await repo_query(
        """
        SELECT
            id,
            id AS source_id,
            title,
            content AS raw_text,
            content,
            search::score(1) AS bm25_score
        FROM note
        WHERE content @1@ $query
        ORDER BY bm25_score DESC
        LIMIT $limit;
        """,
        {"query": query, "limit": limit},
    )


def _record_candidate(row: Dict[str, Any], query_index: int, rank: int, candidate_type: str) -> Dict[str, Any]:
    candidate_id = str(row.get("id") or "")
    source_id = str(row.get("source_id") or row.get("parent_id") or candidate_id)
    raw_text = str(row.get("raw_text") or row.get("content") or "")
    summary = str(row.get("summary") or raw_text[:500])
    keywords = _as_str_list(row.get("keywords"), limit=15)
    questions = _as_str_list(row.get("hypothetical_questions"), limit=8)

    return {
        "candidate_id": candidate_id,
        "id": source_id,
        "parent_id": source_id,
        "title": row.get("title") or "Untitled",
        "content": raw_text,
        "matches": [raw_text],
        "summary": summary,
        "keywords": keywords,
        "hypothetical_questions": questions,
        "bm25_score": float(row.get("bm25_score") or 0),
        "rrf_score": 1.0 / (RRF_K + rank + 1),
        "query_index": query_index,
        "candidate_type": candidate_type,
    }


def _rrf_merge(result_sets: Iterable[List[Dict[str, Any]]]) -> List[Dict[str, Any]]:
    merged: Dict[str, Dict[str, Any]] = {}
    scores: defaultdict[str, float] = defaultdict(float)

    for query_index, rows in enumerate(result_sets):
        for rank, row in enumerate(rows):
            candidate_type = str(row.pop("_candidate_type", "source"))
            candidate = _record_candidate(row, query_index, rank, candidate_type)
            candidate_id = candidate["candidate_id"]
            if not candidate_id:
                continue
            scores[candidate_id] += candidate["rrf_score"]
            if candidate_id not in merged:
                merged[candidate_id] = candidate
            else:
                merged[candidate_id]["bm25_score"] = max(
                    merged[candidate_id]["bm25_score"],
                    candidate["bm25_score"],
                )

    for candidate_id, score in scores.items():
        merged[candidate_id]["rrf_score"] = score

    return sorted(
        merged.values(),
        key=lambda candidate: (
            candidate["rrf_score"],
            candidate["bm25_score"],
        ),
        reverse=True,
    )


async def rerank_candidates(
    query: str,
    candidates: Sequence[Dict[str, Any]],
    *,
    top_k: int,
) -> List[Dict[str, Any]]:
    if not candidates:
        return []

    prompt_candidates = [
        {
            "id": candidate["candidate_id"],
            "title": candidate["title"],
            "type": candidate["candidate_type"],
            "summary": candidate["summary"],
            "keywords": candidate["keywords"],
            "questions": candidate["hypothetical_questions"],
        }
        for candidate in candidates[:RERANK_CANDIDATES]
    ]
    prompt = f"""
You are a strict RAG reranker. Given a user question and candidate chunk summaries, judge whether each candidate can help answer the question.

Scoring:
0 = completely unrelated
1 = has some related words but cannot answer
2 = partially relevant
3 = highly relevant and can answer key parts

User question:
{query}

Candidate chunks:
{json.dumps(prompt_candidates, ensure_ascii=True)}

Return only JSON:
[
  {{"id": "candidate_id", "score": 3, "reason": "..."}}
]
""".strip()

    try:
        model = await provision_langchain_model(
            prompt,
            None,
            "retrieval",
            max_tokens=1800,
            structured=dict(type="json"),
        )
        ai_message = await model.ainvoke(prompt)
        payload = _extract_json_payload(extract_text_content(ai_message.content))
        if not isinstance(payload, list):
            raise ValueError("Reranker returned non-list JSON")
        score_map: Dict[str, Dict[str, Any]] = {}
        for item in payload:
            if not isinstance(item, dict):
                continue
            candidate_id = str(item.get("id") or "")
            if candidate_id:
                score_map[candidate_id] = {
                    "llm_score": float(item.get("score") or 0),
                    "rerank_reason": str(item.get("reason") or ""),
                }
    except ConfigurationError:
        raise
    except Exception as e:
        raise_if_provider_access_error(e)
        logger.warning(f"LLM rerank failed, using RRF ordering: {e}")
        score_map = {}

    reranked: List[Dict[str, Any]] = []
    for index, candidate in enumerate(candidates[:RERANK_CANDIDATES]):
        llm_result = score_map.get(candidate["candidate_id"], {})
        llm_score = float(llm_result.get("llm_score", 0))
        candidate = {
            **candidate,
            "llm_score": llm_score,
            "rerank_reason": llm_result.get("rerank_reason", ""),
            "relevance": llm_score if score_map else candidate["rrf_score"],
            "similarity": llm_score if score_map else candidate["rrf_score"],
            "score": llm_score if score_map else candidate["rrf_score"],
            "_original_rank": index,
        }
        reranked.append(candidate)

    if score_map:
        reranked.sort(
            key=lambda candidate: (
                candidate["llm_score"],
                candidate["rrf_score"],
                candidate["bm25_score"],
            ),
            reverse=True,
        )

    return reranked[:top_k]


async def llm_bm25_search(
    query: str,
    results: int,
    source: bool = True,
    note: bool = True,
    source_ids: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if not query.strip():
        raise InvalidInputError("Search query cannot be empty")

    queries = await rewrite_search_queries(query)
    result_sets: List[List[Dict[str, Any]]] = []

    for rewritten in queries:
        if source:
            source_rows = await _source_bm25(rewritten, PER_QUERY_LIMIT, source_ids)
            for row in source_rows:
                row["_candidate_type"] = "source"
            result_sets.append(source_rows)
        if note and not source_ids:
            note_rows = await _note_bm25(rewritten, PER_QUERY_LIMIT)
            for row in note_rows:
                row["_candidate_type"] = "note"
            result_sets.append(note_rows)

    merged = _rrf_merge(result_sets)
    return await rerank_candidates(query, merged, top_k=results)


async def configured_semantic_search(
    keyword: str,
    results: int,
    source: bool = True,
    note: bool = True,
    minimum_score: float = 0.2,
) -> List[Dict[str, Any]]:
    if await is_llm_bm25_backend():
        return await llm_bm25_search(keyword, results, source, note)

    from forgenote.domain.notebook import vector_search

    return await vector_search(keyword, results, source, note, minimum_score)
