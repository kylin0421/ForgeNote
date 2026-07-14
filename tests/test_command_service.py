import pytest

from api.command_service import CommandService


@pytest.mark.asyncio
async def test_submit_command_imports_only_owning_module(monkeypatch):
    imported = []

    monkeypatch.setattr(
        "api.command_service.import_module",
        lambda name: imported.append(name),
    )
    monkeypatch.setattr(
        "api.command_service.submit_command",
        lambda app, name, args: "command:test",
    )

    command_id = await CommandService.submit_command_job(
        "open_notebook",
        "process_source",
        {"source_id": "source:test"},
    )

    assert command_id == "command:test"
    assert imported == ["commands.source_commands"]


@pytest.mark.asyncio
async def test_submit_command_rejects_unknown_command(monkeypatch):
    monkeypatch.setattr(
        "api.command_service.submit_command",
        lambda app, name, args: pytest.fail("submit_command should not be called"),
    )

    with pytest.raises(ValueError, match="Unknown command"):
        await CommandService.submit_command_job(
            "open_notebook",
            "unknown_command",
            {},
        )


@pytest.mark.asyncio
async def test_list_command_jobs_excludes_dismissed_by_default(monkeypatch):
    captured = {}

    async def fake_repo_query(query: str, params: dict):
        captured["query"] = query
        captured["params"] = params
        return []

    monkeypatch.setattr("api.command_service.repo_query", fake_repo_query)

    jobs = await CommandService.list_command_jobs(status_filter="failed")

    assert jobs == []
    assert "dismissed_at IS NONE" in captured["query"]
    assert captured["params"]["status_filter"] == "failed"


@pytest.mark.asyncio
async def test_get_command_log_returns_persisted_failure_details(monkeypatch):
    async def fake_repo_query(query: str, params: dict):
        return [
            {
                "id": "command:failed",
                "app": "open_notebook",
                "name": "generate_podcast",
                "status": "failed",
                "args": {"episode_name": "demo"},
                "result": {"error_message": "provider quota exceeded"},
                "error_message": "tts failed",
                "created": "2026-06-28T01:00:00Z",
                "updated": "2026-06-28T01:01:00Z",
            }
        ]

    monkeypatch.setattr("api.command_service.repo_query", fake_repo_query)

    log = await CommandService.get_command_log("command:failed")

    assert log["job_id"] == "command:failed"
    assert log["status"] == "failed"
    assert log["args"] == {"episode_name": "demo"}
    assert log["result"] == {"error_message": "provider quota exceeded"}
    assert "tts failed" in "\n".join(log["log"])
    assert "provider quota exceeded" in "\n".join(log["log"])


@pytest.mark.asyncio
async def test_get_command_log_compacts_large_payloads(monkeypatch):
    async def fake_repo_query(query: str, params: dict):
        return [
            {
                "id": "command:failed",
                "app": "open_notebook",
                "name": "generate_podcast",
                "status": "failed",
                "args": {"content": "x" * 2000},
                "result": {},
                "error_message": "failed",
            }
        ]

    monkeypatch.setattr("api.command_service.repo_query", fake_repo_query)

    log = await CommandService.get_command_log("command:failed")

    assert len(log["args"]["content"]) < 1400
    assert "truncated" in log["args"]["content"]


@pytest.mark.asyncio
async def test_dismiss_command_job_marks_failed_job(monkeypatch):
    queries = []

    async def fake_repo_query(query: str, params: dict):
        queries.append(query)
        if query.strip().startswith("SELECT"):
            return [{"id": "command:failed", "status": "failed"}]
        return [{"id": "command:failed"}]

    monkeypatch.setattr("api.command_service.repo_query", fake_repo_query)

    dismissed = await CommandService.dismiss_command_job("command:failed")

    assert dismissed is True
    assert any("dismissed_at" in query for query in queries)


@pytest.mark.asyncio
async def test_dismiss_command_job_ignores_running_job(monkeypatch):
    queries = []

    async def fake_repo_query(query: str, params: dict):
        queries.append(query)
        return [{"id": "command:running", "status": "running"}]

    monkeypatch.setattr("api.command_service.repo_query", fake_repo_query)

    dismissed = await CommandService.dismiss_command_job("command:running")

    assert dismissed is False
    assert not any("UPDATE" in query for query in queries)
