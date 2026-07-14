from fastapi.testclient import TestClient

from api.web_search import WebSearchResult


async def fake_search_web(query: str, limit: int = 5):
    safe_query = query.replace(" ", "-")
    return [
        WebSearchResult(
            title=f"{query} source {index}",
            url=f"https://example.com/{safe_query}/source-{index}",
            snippet="Reliable learning material",
            query=query,
        )
        for index in range(1, min(limit, 2) + 1)
    ]


def test_learning_orchestration_endpoint_returns_competition_artifacts(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    from api.main import app

    client = TestClient(app)
    response = client.post(
        "/api/learning/orchestrate",
        json={
            "message": "我想系统生成机器学习学习路径、练习和代码案例。",
            "course": "机器学习",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert len(data["profile"]) >= 6
    assert len(data["collected_resources"]) >= 5
    assert len(data["resources"]) >= 5
    assert any(
        resource["adoption_status"] == "user_upload"
        for resource in data["collected_resources"]
    )
    assert any(resource["provider"] == "DuckDuckGo HTML" for resource in data["collected_resources"])
    assert data["safety_report"]["status"] == "passed"


def test_learning_endpoint_respects_selected_asset_types(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    from api.main import app

    client = TestClient(app)
    response = client.post(
        "/api/learning/orchestrate",
        json={
            "message": "先生成 Quiz 和闪卡。",
            "course": "机器学习",
            "requested_outputs": ["quiz", "flashcards"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert [resource["kind"] for resource in data["resources"]] == [
        "quiz",
        "flashcards",
    ]
    assert data["resources"][0]["payload"]["questions"]
    assert data["resources"][1]["payload"]["cards"]


def test_learning_endpoint_allows_blank_generation_prompt(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    from api.main import app

    client = TestClient(app)
    response = client.post(
        "/api/learning/orchestrate",
        json={
            "course": "经典 SSL 论文",
            "mode": "generate",
            "message": "",
            "requested_outputs": ["quiz"],
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert [resource["kind"] for resource in data["resources"]] == ["quiz"]


def test_learning_stream_endpoint_emits_agent_stages(monkeypatch):
    monkeypatch.setattr("api.learning_service.search_web", fake_search_web)
    from api.main import app

    client = TestClient(app)
    with client.stream(
        "POST",
        "/api/learning/orchestrate/stream",
        json={
            "message": "我需要人工智能课程复习计划和资源推荐。",
            "course": "人工智能导论",
        },
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    assert '"type": "stage"' in body
    assert '"type": "complete"' in body
    assert "资源搜集智能体" in body
    assert "安全校验智能体" in body


def test_learning_resource_search_endpoint_submits_background_job(monkeypatch):
    submitted = []

    def fake_submit_command(app_name: str, command_name: str, payload: dict):
        submitted.append((app_name, command_name, payload))
        return "job-resource-search"

    monkeypatch.setattr("api.routers.learning.submit_command", fake_submit_command)
    from api.main import app

    client = TestClient(app)
    response = client.post(
        "/api/learning/resource-search/jobs",
        json={
            "message": "搜索强化学习入门资料",
            "course": "强化学习",
            "requested_outputs": ["quiz"],
        },
    )

    assert response.status_code == 200
    assert response.json()["job_id"] == "job-resource-search"
    assert submitted == [
        (
            "forgenote",
            "collect_learning_resources",
            {
                "message": "搜索强化学习入门资料",
                "mode": "collect",
                "course": "强化学习",
                "major": None,
                "goal": None,
                "learning_history": [],
                "requested_outputs": [],
                "accepted_resource_ids": [],
                "supplemental_materials": [],
                "learning_record_id": None,
                "target_language": None,
                "auto_update_profile": True,
                "use_profile_source": True,
            },
        )
    ]


def test_learning_asset_jobs_endpoint_submits_one_job_per_asset(monkeypatch):
    submitted = []

    def fake_submit_command(app_name: str, command_name: str, payload: dict):
        submitted.append((app_name, command_name, payload))
        return f"job-{payload['output_kind']}"

    monkeypatch.setattr("api.routers.learning.submit_command", fake_submit_command)
    from api.main import app

    client = TestClient(app)
    response = client.post(
        "/api/learning/assets/jobs",
        json={
            "message": "",
            "course": "经典 SSL 论文",
            "mode": "generate",
            "requested_outputs": ["quiz", "flashcards"],
            "accepted_resource_ids": ["source:abc"],
            "learning_record_id": "notebook:xyz",
        },
    )

    assert response.status_code == 200
    assert response.json()["jobs"] == [
        {"job_id": "job-quiz", "output_kind": "quiz"},
        {"job_id": "job-flashcards", "output_kind": "flashcards"},
    ]
    assert [item[1] for item in submitted] == [
        "generate_learning_asset",
        "generate_learning_asset",
    ]
    assert [item[2]["output_kind"] for item in submitted] == ["quiz", "flashcards"]
    assert all(item[2]["mode"] == "generate" for item in submitted)
    assert all("requested_outputs" not in item[2] for item in submitted)
