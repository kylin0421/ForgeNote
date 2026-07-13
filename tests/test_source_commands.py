from unittest.mock import AsyncMock, MagicMock

import pytest

from commands.source_commands import SourceProcessingInput, process_source_command


@pytest.mark.asyncio
async def test_source_processing_queues_transformations_after_extraction(monkeypatch):
    source = MagicMock()
    source.id = "source:test"
    source.full_text = ""
    source.save = AsyncMock()
    source.get_insights = AsyncMock(return_value=[])

    transformation = MagicMock()
    transformation.id = "transformation:test"

    source_graph = MagicMock()
    source_graph.ainvoke = AsyncMock(return_value={"source": source})
    submitted = []

    monkeypatch.setattr(
        "commands.source_commands.Source.get",
        AsyncMock(return_value=source),
    )
    monkeypatch.setattr(
        "commands.source_commands.Transformation.get",
        AsyncMock(return_value=transformation),
    )
    monkeypatch.setattr("commands.source_commands.source_graph", source_graph)
    monkeypatch.setattr(
        "commands.source_commands.submit_command",
        lambda app, name, args: submitted.append((app, name, args)) or "command:child",
    )

    result = await process_source_command(
        SourceProcessingInput(
            source_id="source:test",
            content_state={"file_path": "paper.pdf"},
            notebook_ids=["notebook:test"],
            transformations=["transformation:test"],
            embed=True,
        )
    )

    graph_state = source_graph.ainvoke.await_args.args[0]
    assert graph_state["apply_transformations"] == []
    assert graph_state["embed"] is True
    assert submitted == [
        (
            "open_notebook",
            "run_transformation",
            {
                "source_id": "source:test",
                "transformation_id": "transformation:test",
            },
        )
    ]
    assert result.success is True


@pytest.mark.asyncio
async def test_source_retry_reuses_extracted_text(monkeypatch):
    source = MagicMock()
    source.id = "source:test"
    source.full_text = "already extracted"
    source.save = AsyncMock()
    source.vectorize = AsyncMock()
    source.get_insights = AsyncMock(return_value=[])

    source_graph = MagicMock()
    source_graph.ainvoke = AsyncMock()

    monkeypatch.setattr(
        "commands.source_commands.Source.get",
        AsyncMock(return_value=source),
    )
    monkeypatch.setattr("commands.source_commands.source_graph", source_graph)

    result = await process_source_command(
        SourceProcessingInput(
            source_id="source:test",
            content_state={"file_path": "paper.pdf"},
            notebook_ids=["notebook:test"],
            transformations=[],
            embed=True,
        )
    )

    source_graph.ainvoke.assert_not_awaited()
    source.vectorize.assert_awaited_once()
    assert result.success is True
