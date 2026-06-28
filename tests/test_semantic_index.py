from types import SimpleNamespace

import pytest

from open_notebook.utils import semantic_index


def test_extract_json_payload_handles_fenced_json():
    payload = semantic_index._extract_json_payload(
        '```json\n{"summary": "ok", "keywords": ["rag"]}\n```'
    )

    assert payload == {"summary": "ok", "keywords": ["rag"]}


@pytest.mark.asyncio
async def test_build_llm_bm25_source_records_uses_raw_text_for_answer_context(
    monkeypatch,
):
    async def fake_generate_chunk_metadata(*args, **kwargs):
        return {
            "summary": "This chunk explains hierarchy.",
            "keywords": ["hierarchical planning", "subgoal"],
            "questions": ["How is hierarchy implemented?"],
            "entities": ["planner"],
            "contains": {
                "method": True,
                "experiment": False,
                "formula": False,
                "algorithm": False,
                "limitation": False,
            },
        }

    monkeypatch.setattr(
        semantic_index,
        "generate_chunk_metadata",
        fake_generate_chunk_metadata,
    )

    source = SimpleNamespace(id="source:abc", title="Paper")
    records = await semantic_index.build_llm_bm25_source_records(
        source,
        ["raw chunk text"],
    )

    assert len(records) == 1
    record = records[0]
    assert str(record["source"]) == "source:abc"
    assert record["raw_text"] == "raw chunk text"
    assert record["summary"] == "This chunk explains hierarchy."
    assert record["keywords"] == ["hierarchical planning", "subgoal"]
    assert record["hypothetical_questions"] == ["How is hierarchy implemented?"]
    assert record["embedding"] == []
    assert record["index_backend"] == "llm_bm25"
    assert "raw chunk text" in record["content"]
    assert "hierarchical planning" in record["content"]


def test_rrf_merge_combines_repeated_candidates():
    first = [
        {
            "id": "source_embedding:a",
            "source_id": "source:paper",
            "title": "Paper",
            "content": "alpha",
            "bm25_score": 4.0,
            "_candidate_type": "source",
        }
    ]
    second = [
        {
            "id": "source_embedding:a",
            "source_id": "source:paper",
            "title": "Paper",
            "content": "alpha",
            "bm25_score": 2.0,
            "_candidate_type": "source",
        }
    ]

    merged = semantic_index._rrf_merge([first, second])

    assert len(merged) == 1
    assert merged[0]["candidate_id"] == "source_embedding:a"
    assert merged[0]["parent_id"] == "source:paper"
    assert merged[0]["bm25_score"] == 4.0
    assert merged[0]["rrf_score"] > 1 / semantic_index.RRF_K
