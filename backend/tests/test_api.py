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
    night = timeline_event(payload, "event-2", "information", "共情者得知 1")
    night["details"] = {"actor_seat_id": None, "target_seat_ids": ["seat-1"]}
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
    assert reloaded["timeline"][1]["details"] == night["details"]
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


def save_test_analysis(client: TestClient, record: dict, monkeypatch):
    from backend.app.models import GameDraft, ReasonResponse

    async def reason(game, question, selected_seat_id):
        # Editing while reasoning must not change the captured context or lose the result.
        assert game.model_dump(mode="json") == record["draft"]
        client.app.state.repository.update(
            record["id"],
            GameDraft.model_validate({**record["draft"], "notes": "edited during analysis"}),
            expected_version=1,
        )
        return ReasonResponse(answer="Original snapshot analysis", duration_ms=25)

    monkeypatch.setattr(client.app.state.harness, "reason", reason)
    response = client.post(
        f"/api/games/{record['id']}/analyses",
        json={"event_id": record["timeline"][0]["id"], "question": "Check this game",
              "selected_seat_id": record["draft"]["seats"][0]["id"]},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_analysis_keeps_original_snapshot_during_edits(client: TestClient, monkeypatch) -> None:
    record = client.post("/api/games", json=draft_payload()).json()
    analysis = save_test_analysis(client, record, monkeypatch)
    loaded = client.get(f"/api/games/{record['id']}").json()
    assert loaded["version"] == 2
    assert loaded["draft"]["notes"] == "edited during analysis"
    assert analysis["snapshot"] == record["draft"]
    assert analysis["source_game_version"] == 1
    assert loaded["analyses"] == [analysis]
    # Ordinary saves don't replace independently persisted analyses.
    updated = client.put(f"/api/games/{record['id']}", json={
        **loaded["draft"], "phase": "day", "expected_version": 2,
    })
    assert updated.json()["analyses"] == [analysis]


def test_duplicate_and_archive_round_trip_preserve_history_and_analyses(
    client: TestClient, monkeypatch,
) -> None:
    payload = draft_payload()
    payload["night_checklist"] = night_checklist_payload()
    event = timeline_event(payload, kind="information", note="Empath learned 1")
    event["details"] = {"actor_seat_id": "seat-1", "target_seat_ids": ["seat-2"]}
    record = client.post("/api/games", json={**payload, "timeline": [event]}).json()
    analysis = save_test_analysis(client, record, monkeypatch)
    url = f"/api/games/{record['id']}"
    source = client.get(url).json()
    copied = client.post(url + "/duplicate", json={"expected_version": 2})
    assert copied.status_code == 201
    copy = copied.json()
    assert copy["id"] != source["id"]
    assert copy["version"] == 1
    assert copy["draft"]["name"].endswith(" · 副本")
    assert copy["timeline"][:-1] == source["timeline"]
    assert copy["analyses"] == [analysis]
    assert client.get(url).json() == source
    assert client.post(url + "/duplicate", json={"expected_version": 1}).status_code == 409

    archive = client.get(url + "/export").json()
    assert archive["format"] == "botc-bench-game"
    imported = client.post("/api/games/import", json=archive)
    assert imported.status_code == 201, imported.text
    restored = imported.json()
    assert restored["id"] not in {source["id"], copy["id"]}
    assert restored["version"] == 1
    for key in ("draft", "timeline", "analyses", "branch_origin"):
        assert restored[key] == source[key]
    assert client.get(url).json() == source
    # Importing the same backup twice creates independent games without ID collisions.
    again = client.post("/api/games/import", json=archive).json()
    assert again["id"] != restored["id"]


@pytest.mark.parametrize("corruption", ["format", "version", "mismatch", "role", "analysis"])
def test_invalid_import_is_atomic(client: TestClient, monkeypatch, corruption: str) -> None:
    record = client.post("/api/games", json=draft_payload()).json()
    save_test_analysis(client, record, monkeypatch)
    archive = client.get(f"/api/games/{record['id']}/export").json()
    if corruption == "format":
        archive["format"] = "some-other-format"
    elif corruption == "version":
        archive["schema_version"] = 2
    elif corruption == "mismatch":
        archive["game"]["draft"]["notes"] = "not the final event"
    elif corruption == "role":
        archive["game"]["timeline"][0]["snapshot"]["script_id"] = "script-999"
    else:
        archive["game"]["analyses"][0]["snapshot"]["notes"] = "wrong context"
    before = client.get("/api/games").json()
    assert client.post("/api/games/import", json=archive).status_code == 422
    assert client.get("/api/games").json() == before


def test_analysis_rejects_missing_context_and_harness_failure(client: TestClient) -> None:
    record = client.post("/api/games", json=draft_payload()).json()
    url = f"/api/games/{record['id']}/analyses"
    body = {"event_id": record["timeline"][0]["id"], "question": "Check"}
    assert client.post(url, json={**body, "event_id": "missing"}).status_code == 404
    assert client.post(url, json={**body, "selected_seat_id": "missing"}).status_code == 422
    assert client.post(url, json=body).status_code == 503
    assert client.get(f"/api/games/{record['id']}").json()["analyses"] == []


def test_recovery_accepts_incomplete_edits_but_validates_structure(client: TestClient) -> None:
    payload = draft_payload()
    payload["name"] = ""
    payload["composition"]["townsfolk"] = 0
    recovery = {
        "schema_version": 1, "saved_at": "2026-09-16T12:00:00Z", "record": None,
        "timeline": [timeline_event(payload)], "history": {"past": [payload], "future": []},
        "branch_origin": None, "dirty": True,
    }
    assert client.post("/api/drafts/validate", json=recovery).status_code == 200
    assert client.get("/api/games").json() == []
    recovery["timeline"][0]["snapshot"]["seats"][0]["role_id"] = "unknown"
    assert client.post("/api/drafts/validate", json=recovery).status_code == 422


def test_branch_carries_only_analyses_from_retained_events(client: TestClient, monkeypatch) -> None:
    from backend.app.models import ReasonResponse

    async def reason(*args):
        return ReasonResponse(answer="Analysis", duration_ms=1)

    monkeypatch.setattr(client.app.state.harness, "reason", reason)
    record = client.post("/api/games", json=draft_payload()).json()
    url = f"/api/games/{record['id']}"
    early = client.post(url + "/analyses", json={
        "event_id": record["timeline"][0]["id"], "question": "Early",
    }).json()
    updated = client.put(
        url, json={**record["draft"], "phase": "day", "expected_version": 1}
    ).json()
    client.post(url + "/analyses", json={
        "event_id": updated["timeline"][-1]["id"], "question": "Late",
    })
    branch = client.post(url + "/branch", json={
        "event_id": record["timeline"][0]["id"], "expected_version": 2,
    }).json()
    assert branch["analyses"] == [early]
    assert len(client.get(url).json()["analyses"]) == 2


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


@pytest.mark.parametrize("kind", ["action", "information"])
def test_typed_events_validate_participants_against_their_own_snapshot(
    client: TestClient, kind: str
) -> None:
    payload = draft_payload()
    event = timeline_event(payload, kind=kind, note="选择并告知玩家")
    event["details"] = {"actor_seat_id": "seat-1", "target_seat_ids": ["seat-2", "seat-3"]}
    response = client.post("/api/games", json={**payload, "timeline": [event]})
    assert response.status_code == 201
    assert response.json()["timeline"][0]["details"] == event["details"]
    event["details"]["target_seat_ids"] = ["seat-2", "seat-2"]
    assert client.post("/api/games", json={**payload, "timeline": [event]}).status_code == 422
    event["details"]["target_seat_ids"] = ["missing"]
    assert client.post("/api/games", json={**payload, "timeline": [event]}).status_code == 422
    event["details"] = {"actor_seat_id": "missing", "target_seat_ids": []}
    assert client.post("/api/games", json={**payload, "timeline": [event]}).status_code == 422
    event["details"]["actor_seat_id"] = None
    event["note"] = "   "
    assert client.post("/api/games", json={**payload, "timeline": [event]}).status_code == 422
