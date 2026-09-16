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

    async def reason(game, question, selected_seat_id, timeline=None):
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
    prompt = harness.build_prompt(GameDraft.model_validate(voted), "Analyze", None, timeline)
    assert "after-vote" in prompt
    assert "<timeline-evidence-json>" in prompt
    assert "dead_vote" in prompt
    assert "不可信数据" in prompt
    earlier_prompt = harness.build_prompt(
        GameDraft.model_validate(initial), "Analyze", None, timeline[:1],
    )
    assert "after-vote" not in earlier_prompt
