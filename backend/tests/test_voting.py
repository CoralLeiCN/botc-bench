from copy import deepcopy

import pytest

from backend.app.models import GameDraft, ReasonResponse
from backend.tests.test_api import draft_payload, timeline_event


def voting_payload():
    payload = draft_payload()
    payload.update(phase="day", day_number=1)
    payload["seats"][-1].update(alive=False, dead_vote_available=True)
    players = [
        {key: seat[key] for key in ("id", "position", "player_name")}
        for seat in payload["seats"]
    ]
    payload["nominations"] = [{
        "id": "nomination-1", "day_number": 1,
        "nominator": players[0], "nominee": players[1], "alive_count": 6, "status": "open",
        "votes": [
            {"player": player, "choice": "yes", "weight": 1, "dead_vote": i == 6}
            for i, player in enumerate(players)
        ],
    }]
    return payload


def test_ballot_save_reload_and_branch_restore_dead_vote_balances(client):
    payload = voting_payload()
    open_event = timeline_event(payload, "open-ballot")
    payload["nominations"][0]["status"] = "closed"
    payload["seats"][-1]["dead_vote_available"] = False
    closed_event = timeline_event(payload, "closed-ballot", "change")
    response = client.post("/api/games", json={
        **payload, "timeline": [open_event, closed_event],
    })
    assert response.status_code == 201, response.text
    record = response.json()
    url = f"/api/games/{record['id']}"
    reloaded = client.get(url).json()
    assert reloaded == record
    assert reloaded["draft"]["nominations"][0]["votes"][-1]["dead_vote"] is True
    assert reloaded["draft"]["seats"][-1]["dead_vote_available"] is False
    branch = client.post(url + "/branch", json={
        "event_id": "open-ballot", "expected_version": 1,
    })
    assert branch.status_code == 201, branch.text
    branch = branch.json()
    assert branch["draft"]["seats"][-1]["dead_vote_available"] is True
    assert branch["draft"]["nominations"][0]["status"] == "open"
    assert client.get(url).json() == record


@pytest.mark.parametrize("defect", [
    "duplicate_voter", "duplicate_nomination", "outsider", "bad_weight", "pending_closed",
    "unavailable_dead_vote", "alive_dead_vote", "no_dead_vote", "wrong_day", "wrong_phase",
    "missing_voter", "multiple_open",
])
def test_malformed_ballots_are_rejected(client, defect):
    payload = voting_payload()
    ballot = payload["nominations"][0]
    if defect == "duplicate_voter":
        ballot["votes"][-1] = deepcopy(ballot["votes"][0])
    elif defect == "duplicate_nomination":
        payload["nominations"].append(deepcopy(ballot))
    elif defect == "outsider":
        ballot["nominee"] = {**ballot["nominee"], "id": "unknown"}
    elif defect == "bad_weight":
        ballot["votes"][0]["weight"] = 1.5
    elif defect == "pending_closed":
        ballot["status"] = "closed"
        ballot["votes"][0]["choice"] = "pending"
    elif defect == "unavailable_dead_vote":
        payload["seats"][-1]["dead_vote_available"] = False
    elif defect == "alive_dead_vote":
        ballot["votes"][0]["dead_vote"] = True
    elif defect == "no_dead_vote":
        ballot["votes"][-1]["choice"] = "no"
    elif defect == "wrong_day":
        payload["day_number"] = 2
    elif defect == "wrong_phase":
        payload["phase"] = "night"
    elif defect == "missing_voter":
        ballot["votes"] = ballot["votes"][:-1]
    else:
        payload["nominations"].append({**deepcopy(ballot), "id": "another"})
    assert client.post("/api/games", json=payload).status_code == 422


def test_legacy_records_default_to_no_nominations_and_available_tokens(client):
    record = client.post("/api/games", json=draft_payload()).json()
    assert record["draft"]["nominations"] == []
    assert all(seat["dead_vote_available"] for seat in record["draft"]["seats"])
    assert record["timeline"][0]["snapshot"] == record["draft"]


def test_closed_ballot_survives_roster_changes(client):
    payload = voting_payload()
    payload["nominations"][0]["status"] = "closed"
    payload["seats"] = payload["seats"][:-1]
    payload["player_count"] = 6
    payload["composition"]["townsfolk"] = 4
    response = client.post("/api/games", json=payload)
    assert response.status_code == 201, response.text
    assert len(response.json()["draft"]["nominations"][0]["votes"]) == 7


def test_reasoning_receives_only_supplied_history_and_rejects_mismatched_endpoint(client):
    payload = voting_payload()
    event = timeline_event(payload, "vote-evidence", "change")
    captured = []

    async def reason(
        game, question, selected_seat_id, perspective, expected_prompt_sha256, timeline=None,
    ):
        captured.extend(timeline or [])
        return ReasonResponse(answer="Evidence received", duration_ms=0)

    client.app.state.harness.reason = reason
    response = client.post("/api/reason", json={
        "game": payload, "question": "Who voted?", "timeline": [event],
    })
    assert response.status_code == 200
    assert len(captured) == 1
    assert captured[0].id == "vote-evidence"
    event["snapshot"]["notes"] = "future state"
    assert client.post("/api/reason", json={
        "game": payload, "question": "Who voted?", "timeline": [event],
    }).status_code == 422


def test_prompt_contains_exact_vote_changes_and_no_unseen_future(client):
    from backend.app.models import TimelineEntry

    initial = voting_payload()
    initial["nominations"][0]["votes"][0]["choice"] = "pending"
    voted = deepcopy(initial)
    voted["nominations"][0]["votes"][0]["choice"] = "yes"
    timeline = [TimelineEntry.model_validate(timeline_event(initial, "before-vote")),
                TimelineEntry.model_validate(timeline_event(voted, "after-vote"))]
    harness = client.app.state.harness
    evidence = harness._timeline_evidence(timeline)
    assert evidence[1]["changes"] == [{
        "path": ["nominations", 0, "votes", 0, "choice"], "before": "pending", "after": "yes",
    }]
    prompt = harness.build_prompt(
        GameDraft.model_validate(voted), "Analyze", None, timeline=timeline,
    )
    assert "after-vote" in prompt
    assert "<timeline-evidence-json>" in prompt
    assert "dead_vote" in prompt
    assert "不可信数据" in prompt
    earlier_prompt = harness.build_prompt(
        GameDraft.model_validate(initial), "Analyze", None, timeline=timeline[:1],
    )
    assert "after-vote" not in earlier_prompt


@pytest.mark.parametrize("endpoint", ["/api/reason/preview", "/api/reason"])
def test_analysis_endpoints_reject_history_that_does_not_match_current_state(client, endpoint):
    payload = voting_payload()
    event = timeline_event(payload, "past-vote")
    event["snapshot"]["notes"] = "different state"
    response = client.post(endpoint, json={
        "game": payload, "question": "Who voted?", "timeline": [event],
    })
    assert response.status_code == 422


def test_storyteller_preview_binds_timeline_and_rejects_changed_evidence_before_launch(client):
    payload = voting_payload()
    event = timeline_event(payload, "vote-evidence")
    request = {"game": payload, "question": "Who voted?", "timeline": [event]}
    response = client.post("/api/reason/preview", json=request)
    assert response.status_code == 200, response.text
    preview = response.json()
    assert "vote-evidence" in preview["prompt"]
    assert "<timeline-evidence-json>" in preview["prompt"]
    request["timeline"][0]["note"] = "Changed evidence after preview"
    changed = client.post("/api/reason/preview", json=request).json()
    assert changed["prompt_sha256"] != preview["prompt_sha256"]
    response = client.post("/api/reason", json={
        **request, "expected_prompt_sha256": preview["prompt_sha256"],
    })
    # The disabled test harness must never launch when the preview is stale.
    assert response.status_code == 409, response.text


def test_player_preview_includes_public_ballots_without_storyteller_notes(client):
    payload = voting_payload()
    event = timeline_event(payload, "PUBLIC_BALLOT_EVENT_ID")
    event["note"] = "SECRET_STORYTELLER_NOTE"
    request = {
        "game": payload, "question": "Who voted?",
        "selected_seat_id": payload["seats"][0]["id"], "perspective": "player",
    }
    baseline = client.post("/api/reason/preview", json=request)
    response = client.post("/api/reason/preview", json={**request, "timeline": [event]})
    assert response.status_code == baseline.status_code == 200
    view = response.json()["player_view"]
    assert view["nominations"] == baseline.json()["player_view"]["nominations"]
    assert view["nominations"][0]["id"] == "nomination-1"
    assert view["history"][0]["event_id"] == "PUBLIC_BALLOT_EVENT_ID"
    prompt = response.json()["prompt"]
    assert "SECRET" not in prompt
    assert "<timeline-evidence-json>" not in prompt
    assert "nomination-1" in prompt
    assert "dead_vote_available" not in prompt
    payload["nominations"] = []
    without_ballots = client.post("/api/reason/preview", json=request).json()
    payload["seats"][-1]["dead_vote_available"] = False
    assert client.post("/api/reason/preview", json=request).json() == without_ballots
    assert without_ballots["player_view"]["nominations"] == []


def test_saved_analysis_binds_preview_to_historical_ballot_evidence(client, monkeypatch):
    payload = voting_payload()
    initial = deepcopy(payload)
    initial["nominations"][0]["votes"][0]["choice"] = "pending"
    prefix = [timeline_event(initial, "before-vote"), timeline_event(payload, "after-vote")]
    payload["notes"] = "UNSEEN_FUTURE_INFORMATION"
    record = client.post("/api/games", json={
        **payload, "timeline": [*prefix, timeline_event(payload, "future-event")],
    }).json()
    preview_request = {
        "game": record["timeline"][1]["snapshot"], "question": "Who voted?",
        "timeline": record["timeline"][:2],
    }
    preview = client.post("/api/reason/preview", json=preview_request).json()
    calls = []

    async def reason(
        game, question, selected_seat_id, perspective, expected_prompt_sha256, timeline=None,
    ):
        actual = client.app.state.harness.preview(
            game, question, selected_seat_id, perspective, timeline,
        )
        assert [event.id for event in timeline] == ["before-vote", "after-vote"]
        assert actual.prompt == preview["prompt"]
        assert expected_prompt_sha256 == preview["prompt_sha256"]
        assert "UNSEEN_FUTURE_INFORMATION" not in actual.prompt
        assert '"before": "pending", "after": "yes"' in actual.prompt
        calls.append(actual.prompt_sha256)
        return ReasonResponse(answer="See after-vote", duration_ms=1)

    monkeypatch.setattr(client.app.state.harness, "reason", reason)
    url = f"/api/games/{record['id']}/analyses"
    request = {"event_id": "after-vote", "question": "Who voted?",
               "expected_prompt_sha256": preview["prompt_sha256"]}
    analysis = client.post(url, json=request)
    assert analysis.status_code == 201, analysis.text
    assert analysis.json()["snapshot"] == record["timeline"][1]["snapshot"]
    assert analysis.json()["prompt_sha256"] == preview["prompt_sha256"]
    preview_request["timeline"][0]["note"] = "Changed evidence"
    different = client.post("/api/reason/preview", json=preview_request).json()
    assert client.post(url, json={
        **request, "expected_prompt_sha256": different["prompt_sha256"],
    }).status_code == 409
    assert calls == [preview["prompt_sha256"]]


def test_duplicate_and_backup_preserve_ballots_and_dead_votes(client):
    payload = voting_payload()
    opened = timeline_event(payload, "open-ballot")
    payload["nominations"][0]["status"] = "closed"
    payload["seats"][-1]["dead_vote_available"] = False
    record = client.post("/api/games", json={
        **payload, "timeline": [opened, timeline_event(payload, "closed-ballot")],
    }).json()
    url = f"/api/games/{record['id']}"
    duplicate = client.post(url + "/duplicate", json={"expected_version": 1})
    archive = client.get(url + "/export").json()
    imported = client.post("/api/games/import", json=archive)
    for response in (duplicate, imported):
        assert response.status_code == 201, response.text
        restored = response.json()
        assert restored["id"] != record["id"]
        assert restored["draft"]["nominations"] == record["draft"]["nominations"]
        assert restored["draft"]["seats"][-1]["dead_vote_available"] is False
        assert restored["timeline"][:2] == record["timeline"]
    assert client.get(url).json() == record
