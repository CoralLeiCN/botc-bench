from __future__ import annotations

from pathlib import Path
from typing import Dict

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    root = Path(__file__).resolve().parents[2]
    settings = Settings(
        root_dir=root,
        database_path=tmp_path / "games.sqlite3",
        script_data_path=root / "backend/app/data/official_scripts.json",
        codex_enabled=False,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client


def draft_payload() -> Dict[str, object]:
    return {
        "schema_version": 1,
        "name": "测试局",
        "script_id": "script-002",
        "player_count": 7,
        "composition": {
            "townsfolk": 5,
            "outsider": 0,
            "minion": 1,
            "demon": 1,
            "traveller": 0,
            "manual": False,
        },
        "seats": [
            {
                "id": f"seat-{index}",
                "position": index,
                "player_name": f"玩家 {index}",
                "alive": True,
                "alignment": "unknown",
                "markers": [],
                "notes": "",
            }
            for index in range(1, 8)
        ],
        "phase": "setup",
        "day_number": 0,
        "notes": "",
    }


def test_catalog_exposes_official_bilingual_data(client: TestClient) -> None:
    response = client.get("/api/scripts")
    assert response.status_code == 200
    scripts = response.json()
    assert [(item["id"], item["name"]["zh_hans"]) for item in scripts] == [
        ("script-002", "暗流涌动"),
        ("script-003", "黯月初升"),
        ("script-004", "梦殒春宵"),
    ]
    assert [len(item["roles"]) for item in scripts] == [22, 25, 25]
    assert [len(item["travellers"]) for item in scripts] == [5, 5, 5]
    assert all(item["description"]["en"] for item in scripts)
    chef = scripts[0]["roles"][0]
    assert chef["name"] == {"en": "Chef", "zh_hans": "厨师"}
    assert chef["ability"]["zh_hans"] == "在你的首个夜晚，你会得知场上邻座的邪恶玩家有多少对。"


def test_game_crud_and_optimistic_versioning(client: TestClient) -> None:
    created = client.post("/api/games", json=draft_payload())
    assert created.status_code == 201
    record = created.json()
    assert record["version"] == 1

    payload = draft_payload()
    payload["name"] = "第二版"
    payload["expected_version"] = 1
    updated = client.put(f"/api/games/{record['id']}", json=payload)
    assert updated.status_code == 200
    assert updated.json()["version"] == 2
    assert updated.json()["draft"]["name"] == "第二版"

    stale = client.put(f"/api/games/{record['id']}", json=payload)
    assert stale.status_code == 409

    listed = client.get("/api/games")
    assert listed.status_code == 200
    assert listed.json()[0]["name"] == "第二版"


def test_invalid_seat_count_is_rejected(client: TestClient) -> None:
    payload = draft_payload()
    payload["seats"] = payload["seats"][:-1]  # type: ignore[index]
    response = client.post("/api/games", json=payload)
    assert response.status_code == 422


def test_composition_total_must_match_player_count(client: TestClient) -> None:
    payload = draft_payload()
    payload["composition"]["townsfolk"] = 4  # type: ignore[index]
    response = client.post("/api/games", json=payload)
    assert response.status_code == 422
    assert "composition total must equal player_count" in response.text


def test_role_ids_are_restricted_to_selected_script(client: TestClient) -> None:
    payload = draft_payload()
    payload["seats"][0]["role_id"] = "fanggu"  # type: ignore[index]
    response = client.post("/api/games", json=payload)
    assert response.status_code == 422
    assert "not present in selected script" in response.json()["detail"]


def test_qa_is_allowlisted_by_catalog(client: TestClient) -> None:
    response = client.get("/api/scripts/script-002/qa")
    assert response.status_code == 200
    assert "基于官方英文规则的问答整理" in response.text
    assert client.get("/api/scripts/../../README/qa").status_code == 404


def test_disabled_harness_reports_unavailable(client: TestClient) -> None:
    status = client.get("/api/harness/status")
    assert status.status_code == 200
    assert status.json()["available"] is False
