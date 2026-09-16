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


def timeline_event(payload, event_id="event-1", kind="initial", note=""):
    from copy import deepcopy

    return {
        "id": event_id,
        "recorded_at": "2026-09-16T12:00:00Z",
        "kind": kind,
        "summary": "测试事件",
        "note": note,
        "snapshot": deepcopy(payload),
    }


def test_timeline_round_trip_and_branch_isolation(client: TestClient) -> None:
    payload = draft_payload()
    initial = timeline_event(payload)
    payload["phase"] = "first_night"
    night = timeline_event(payload, "event-2", "note", "共情者得知 1")
    payload["seats"][0]["alive"] = False
    death = timeline_event(payload, "event-3", "change")
    created = client.post("/api/games", json={**payload, "timeline": [initial, night, death]})
    assert created.status_code == 201
    record = created.json()
    source_url = f"/api/games/{record['id']}"
    reloaded = client.get(source_url).json()
    assert len(reloaded["timeline"]) == 3
    assert reloaded["timeline"][0]["snapshot"]["phase"] == "setup"
    assert reloaded["timeline"][1]["note"] == "共情者得知 1"
    assert reloaded["timeline"][1]["snapshot"]["seats"][0]["alive"] is True
    assert reloaded["timeline"][2]["snapshot"]["seats"][0]["alive"] is False

    branched = client.post(
        source_url + "/branch",
        json={
            "event_id": "event-2",
            "expected_version": 1,
        },
    )
    assert branched.status_code == 201
    branch = branched.json()
    assert branch["id"] != record["id"]
    assert branch["draft"]["seats"][0]["alive"] is True
    assert branch["timeline"][:2] == reloaded["timeline"][:2]
    assert branch["timeline"][-1]["kind"] == "branch"
    assert all(event["id"] != "event-3" for event in branch["timeline"])
    assert branch["branch_origin"]["game_id"] == record["id"]
    assert branch["branch_origin"]["event_id"] == "event-2"

    branch_update = {**branch["draft"], "notes": "alternate outcome", "expected_version": 1}
    updated = client.put(f"/api/games/{branch['id']}", json=branch_update)
    assert updated.status_code == 200
    assert updated.json()["timeline"][:3] == branch["timeline"]
    assert client.get(source_url).json() == reloaded


def test_saved_history_cannot_be_rewritten_or_removed(client: TestClient) -> None:
    payload = draft_payload()
    record = client.post("/api/games", json=payload).json()
    url = f"/api/games/{record['id']}"
    history = record["timeline"]
    payload["phase"] = "day"
    event = timeline_event(payload, "event-2")
    updated = client.put(
        url, json={**payload, "expected_version": 1, "timeline": [*history, event]}
    )
    assert updated.status_code == 200
    truncated = client.put(url, json={**payload, "expected_version": 2, "timeline": [event]})
    assert truncated.status_code == 422
    history[0]["summary"] = "rewritten"
    rewritten = client.put(
        url, json={**payload, "expected_version": 2, "timeline": [*history, event]}
    )
    assert rewritten.status_code == 422
    stale = client.put(url, json={**payload, "expected_version": 1})
    assert stale.status_code == 409
    assert client.get(url).json()["version"] == 2


@pytest.mark.parametrize("bad_history", ["empty", "duplicates", "mismatch", "wrong_role"])
def test_invalid_history_is_rejected(client: TestClient, bad_history: str) -> None:
    payload = draft_payload()
    event = timeline_event(payload)
    timeline = [event]
    if bad_history == "empty":
        timeline = []
    elif bad_history == "duplicates":
        timeline = [event, event]
    elif bad_history == "mismatch":
        event["snapshot"]["phase"] = "night"
    else:
        event["snapshot"]["seats"][0]["role_id"] = "fanggu"
        timeline = [event, timeline_event(payload, "event-2")]
    assert client.post("/api/games", json={**payload, "timeline": timeline}).status_code == 422


def test_history_can_replay_incomplete_setup_but_branch_requires_valid_composition(
    client: TestClient,
) -> None:
    from copy import deepcopy

    payload = draft_payload()
    incomplete = deepcopy(payload)
    incomplete["name"] = ""
    incomplete["composition"]["townsfolk"] = 4
    timeline = [timeline_event(incomplete), timeline_event(payload, "event-2")]
    created = client.post("/api/games", json={**payload, "timeline": timeline})
    assert created.status_code == 201
    url = f"/api/games/{created.json()['id']}/branch"
    assert client.post(url, json={"event_id": "event-1", "expected_version": 1}).status_code == 422
    assert client.post(url, json={"event_id": "missing", "expected_version": 1}).status_code == 404
    assert client.post(url, json={"event_id": "event-2", "expected_version": 9}).status_code == 409


def test_legacy_database_migrates_without_inventing_history(tmp_path: Path) -> None:
    import json
    import sqlite3

    from backend.app.database import GameRepository

    path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(path) as connection:
        connection.execute("""CREATE TABLE games (
            id TEXT PRIMARY KEY, version INTEGER, name TEXT, script_id TEXT,
            player_count INTEGER, payload TEXT, created_at TEXT, updated_at TEXT
        )""")
        connection.execute(
            "INSERT INTO games VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                "old-game",
                3,
                "测试局",
                "script-002",
                7,
                json.dumps(draft_payload()),
                "2026-09-15T12:00:00Z",
                "2026-09-16T12:00:00Z",
            ),
        )
    repository = GameRepository(path)
    repository.initialize()
    repository.initialize()
    record = repository.get("old-game")
    assert record.version == 3
    assert len(record.timeline) == 1
    assert "此前过程未记录" in record.timeline[0].summary
    assert record.timeline[0].snapshot.model_dump() == record.draft.model_dump()
    updated = repository.update(record.id, record.draft, record.version, record.timeline)
    assert updated.timeline == record.timeline
    assert GameRepository(path).get("old-game").timeline == record.timeline


def test_temporary_empty_marker_label_does_not_block_later_history_saves(
    client: TestClient,
) -> None:
    payload = draft_payload()
    payload["seats"][0]["markers"] = [{"id": "marker-1", "type": "custom", "label": ""}]
    incomplete = timeline_event(payload)
    assert client.post("/api/games", json=payload).status_code == 422
    payload["seats"][0]["markers"][0]["label"] = "修正后的提醒"
    complete = timeline_event(payload, "event-2")
    response = client.post("/api/games", json={**payload, "timeline": [incomplete, complete]})
    assert response.status_code == 201
    game_id = response.json()["id"]
    reloaded = client.get(f"/api/games/{game_id}").json()
    assert reloaded["timeline"][0]["snapshot"]["seats"][0]["markers"][0]["label"] == ""
    assert reloaded["draft"]["seats"][0]["markers"][0]["label"] == "修正后的提醒"
    assert (
        client.post(
            f"/api/games/{game_id}/branch",
            json={
                "event_id": "event-1",
                "expected_version": 1,
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            f"/api/games/{game_id}/branch",
            json={
                "event_id": "event-2",
                "expected_version": 1,
            },
        ).status_code
        == 201
    )


def test_player_knowledge_round_trip_replay_and_branch(client: TestClient) -> None:
    payload = draft_payload()
    payload["seats"][0].update(
        role_id="drunk", shown_role_id="empath", shown_alignment="good",
        public_claim="I claim Chef", private_information="First night: 0",
    )
    payload["public_information"] = "The game begins"
    initial = timeline_event(payload)
    payload["seats"][0]["private_information"] += "\nSecond night: 1"
    payload["seats"][0]["public_claim"] = "I now claim Empath"
    later = timeline_event(payload, "event-2")
    created = client.post("/api/games", json={**payload, "timeline": [initial, later]})
    assert created.status_code == 201
    record = client.get(f"/api/games/{created.json()['id']}").json()
    assert record["draft"]["seats"][0]["shown_role_id"] == "empath"
    assert record["draft"]["seats"][0]["role_id"] == "drunk"
    historical = client.post("/api/reason/preview", json={
        "game": record["timeline"][0]["snapshot"],
        "selected_seat_id": "seat-1", "perspective": "player",
    })
    assert historical.status_code == 200
    assert historical.json()["player_view"]["you"]["private_information"] == "First night: 0"
    assert "Second night: 1" not in historical.json()["prompt"]
    branch = client.post(f"/api/games/{record['id']}/branch", json={
        "event_id": "event-1", "expected_version": 1,
    }).json()
    assert branch["draft"]["seats"][0]["private_information"] == "First night: 0"
    assert branch["draft"]["seats"][0]["public_claim"] == "I claim Chef"
    assert branch["draft"]["public_information"] == "The game begins"


def test_legacy_saves_do_not_infer_shown_identity_from_secret_identity(client: TestClient) -> None:
    payload = draft_payload()
    payload["seats"][0].update(role_id="drunk", alignment="good", notes="hidden information")
    record = client.post("/api/games", json=payload).json()
    seat = record["draft"]["seats"][0]
    assert seat["shown_role_id"] is None
    assert seat["shown_alignment"] == "unknown"
    assert seat["private_information"] == ""
    assert seat["public_claim"] == ""
    assert record["timeline"][0]["snapshot"]["seats"][0] == seat


@pytest.mark.parametrize("perspective,seat_id", [
    ("player", None), ("player", "missing"), ("storyteller", "missing"), ("invalid", "seat-1"),
])
@pytest.mark.parametrize("endpoint", ["/api/reason/preview", "/api/reason"])
def test_invalid_viewers_fail_closed(client, perspective, seat_id, endpoint) -> None:
    response = client.post(endpoint, json={
        "game": draft_payload(), "question": "Question",
        "perspective": perspective, "selected_seat_id": seat_id,
    })
    assert response.status_code == 422


def test_shown_roles_are_validated_in_current_and_historical_snapshots(client: TestClient) -> None:
    payload = draft_payload()
    payload["seats"][0]["shown_role_id"] = "fanggu"
    assert client.post("/api/games", json=payload).status_code == 422
    event = timeline_event(payload)
    payload["seats"][0]["shown_role_id"] = "empath"
    assert client.post("/api/games", json={
        **payload, "timeline": [event, timeline_event(payload, "event-2")],
    }).status_code == 422


def test_preview_available_with_disabled_harness_and_incomplete_setup(client: TestClient) -> None:
    payload = draft_payload()
    payload["composition"]["townsfolk"] = 0
    payload["seats"][0]["markers"] = [{"id": "draft", "type": "custom", "label": ""}]
    response = client.post("/api/reason/preview", json={
        "game": payload, "perspective": "player", "selected_seat_id": "seat-1",
    })
    assert response.status_code == 200
    assert response.json()["player_view"] is not None
    assert len(response.json()["prompt_sha256"]) == 64
    assert "<player-view-json>" in response.json()["prompt"]


def test_reason_rejects_stale_preview_before_harness_launch(client: TestClient) -> None:
    payload = {"game": draft_payload(), "question": "Question", "perspective": "player",
               "selected_seat_id": "seat-1"}
    preview = client.post("/api/reason/preview", json=payload).json()
    payload["game"]["public_information"] = "New public information"
    response = client.post("/api/reason", json={
        **payload, "expected_prompt_sha256": preview["prompt_sha256"],
    })
    assert response.status_code == 409

def night_checklist_payload():
    return {
        "id": "night-1",
        "script_id": "script-002",
        "phase": "first_night",
        "day_number": 1,
        "steps": [
            {
                "id": "empath-step",
                "instruction_id": "empath",
                "seat_id": "seat-1",
                "title": "玩家 1 · 共情者",
                "status": "pending",
                "choice": "",
                "information": "1",
                "decision": "醉酒信息由说书人决定",
            }
        ],
        "reviewed_effects": ['["seat-1", "effect-1", "黄昏"]'],
    }


def test_night_checklist_persists_and_branches_with_independent_progress(
    client: TestClient,
) -> None:
    from copy import deepcopy

    payload = draft_payload()
    payload.update(phase="first_night", day_number=1, night_checklist=night_checklist_payload())
    pending = timeline_event(payload, "night-pending")
    record = client.post("/api/games", json={**payload, "timeline": [pending]}).json()
    url = f"/api/games/{record['id']}"
    payload["night_checklist"]["steps"][0]["status"] = "completed"
    completed = timeline_event(payload, "night-completed", "change")
    updated = client.put(
        url, json={**payload, "timeline": [pending, completed], "expected_version": 1}
    )
    assert updated.status_code == 200
    assert client.get(url).json()["draft"]["night_checklist"] == payload["night_checklist"]
    branch = client.post(f"{url}/branch", json={"event_id": "night-pending", "expected_version": 2})
    assert branch.status_code == 201
    assert branch.json()["draft"]["night_checklist"]["steps"][0]["status"] == "pending"
    assert branch.json()["draft"]["night_checklist"]["steps"][0]["information"] == "1"
    assert client.get(url).json()["draft"]["night_checklist"]["steps"][0]["status"] == "completed"

    # Earlier records cannot be rewritten, including their night information.
    tampered = deepcopy(pending)
    tampered["snapshot"]["night_checklist"]["steps"][0]["information"] = "2"
    response = client.put(
        url, json={**payload, "timeline": [tampered, completed], "expected_version": 2}
    )
    assert response.status_code == 422
    assert "immutable" in response.json()["detail"]


def test_old_games_accept_new_checklists_without_rewriting_old_snapshots(
    client: TestClient,
) -> None:
    payload = draft_payload()
    initial = timeline_event(payload)
    record = client.post("/api/games", json={**payload, "timeline": [initial]}).json()
    assert record["draft"]["night_checklist"] is None
    payload.update(phase="first_night", day_number=1, night_checklist=night_checklist_payload())
    latest = timeline_event(payload, "night-event", "change")
    updated = client.put(
        f"/api/games/{record['id']}",
        json={
            **payload,
            "timeline": [initial, latest],
            "expected_version": 1,
        },
    )
    assert updated.status_code == 200
    assert updated.json()["timeline"][0]["snapshot"]["night_checklist"] is None
    assert updated.json()["draft"]["night_checklist"]["id"] == "night-1"


@pytest.mark.parametrize(
    "invalid", ["duplicate", "skip_without_reason", "invalid_status", "long_info"]
)
def test_invalid_night_checklists_are_rejected(client: TestClient, invalid: str) -> None:
    payload = draft_payload()
    checklist = night_checklist_payload()
    step = checklist["steps"][0]
    if invalid == "duplicate":
        checklist["steps"].append(dict(step))
    elif invalid == "skip_without_reason":
        step.update(status="skipped", decision="  ")
    elif invalid == "invalid_status":
        step["status"] = "forgotten"
    else:
        step["information"] = "a" * 2001
    payload["night_checklist"] = checklist
    assert client.post("/api/games", json=payload).status_code == 422


def test_catalog_provides_official_bilingual_night_instructions(client: TestClient) -> None:
    scripts = client.get("/api/scripts").json()
    tb = scripts[0]
    first = {item["id"]: item for item in tb["night_order"]["first_night"]}
    later = {item["id"]: item for item in tb["night_order"]["night"]}
    assert "imp" not in first
    assert "imp" in later
    assert "washerwoman" in first
    assert "washerwoman" not in later
    assert first["poisoner"]["reminder"] == {
        "en": "The Poisoner chooses a player. :reminder:",
        "zh_hans": "投毒者选择一名玩家。:reminder:",
    }
    for script in scripts:
        assert script["sources"]["nightsheet"].endswith("/nightsheet.json")
        for phase in ("first_night", "night"):
            assert script["night_order"][phase][0]["id"] == "dusk"
            assert script["night_order"][phase][-1]["id"] == "dawn"
