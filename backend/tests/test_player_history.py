from copy import deepcopy

import pytest

from backend.app.models import GameDraft, ReasonResponse, TimelineEntry
from backend.app.services.player_view import build_player_view
from backend.tests.test_api import timeline_event
from backend.tests.test_player_view import harness, knowledge_game, state_from_prompt
from backend.tests.test_voting import voting_payload


def entry(game, event_id, visibility="storyteller", recipients=(), kind="information"):
    return TimelineEntry.model_validate({
        **timeline_event(game.model_dump(mode="json"), event_id, kind),
        "summary": "SECRET_GENERATED_SUMMARY",
        "note": event_id,
        "audience": {"visibility": visibility, "recipient_seat_ids": list(recipients)},
    })


def test_event_audiences_do_not_follow_participants_or_expose_recipient_lists():
    game = knowledge_game()
    public = entry(game, "PUBLIC_EVENT", "public")
    private = entry(game, "PRIVATE_EVENT", "private", ["seat-1", "seat-3"])
    legacy = entry(game, "LEGACY_SECRET")
    legacy = TimelineEntry.model_validate({
        **legacy.model_dump(exclude={"audience"}),
        "details": {"actor_seat_id": "seat-1", "target_seat_ids": ["seat-2"]},
    })
    timeline = [public, private, legacy]
    for number in range(1, 8):
        preview = harness().preview(game, "Question", f"seat-{number}", "player", timeline)
        assert "PUBLIC_EVENT" in preview.prompt
        assert ("PRIVATE_EVENT" in preview.prompt) == (number in {1, 3})
        assert "LEGACY_SECRET" not in preview.prompt
        assert "SECRET" not in preview.prompt
        assert "recipient_seat_ids" not in preview.prompt
        assert preview.template_id == "player-agent-v1"
        assert state_from_prompt(preview.prompt) == preview.player_view.model_dump(mode="json")


def test_history_tracks_known_updates_but_not_hidden_snapshot_changes():
    before = knowledge_game()
    after = deepcopy(before)
    after.seats[0].private_information = "MY_NEW_OBSERVATION"
    after.seats[0].shown_role_id = "chef"
    after.seats[1].public_claim = "PUBLIC_CHANGED_CLAIM"
    after.seats[1].private_information = "SECRET_OTHER_OBSERVATION"
    after.seats[1].alive = False
    after.notes = "SECRET_NEW_NOTES"
    timeline = [entry(before, "initial"), entry(after, "change", kind="change")]
    preview = harness().preview(after, "Question", "seat-1", "player", timeline)
    text = preview.player_view.model_dump_json()
    assert "MY_NEW_OBSERVATION" in text
    assert any("PRIVATE_1: learned 0." in item.text for item in preview.player_view.history)
    assert "PUBLIC_CHANGED_CLAIM" in text
    assert "死亡" in text
    assert "SECRET" not in text
    changed = deepcopy(timeline)
    for event in changed:
        event.snapshot.seats[1].role_id = "scarletwoman"
        event.snapshot.seats[1].private_information = "DIFFERENT_HIDDEN_VALUE"
        event.summary = "DIFFERENT_HIDDEN_SUMMARY"
        event.note = "DIFFERENT_HIDDEN_NOTE"
    actual = harness().preview(changed[-1].snapshot, "Question", "seat-1", "player", changed)
    assert actual == preview


def test_public_voting_preserves_pending_cancelled_weights_and_historical_names():
    payload = voting_payload()
    vote = payload["nominations"][0]["votes"][1]
    vote.update(choice="pending", weight=1)
    payload["nominations"][0]["votes"][0]["weight"] = 2
    before = GameDraft.model_validate(payload)
    after = deepcopy(before)
    after.nominations[0].status = "cancelled"
    after.seats[0].player_name = "Renamed after voting"
    timeline = [entry(before, "ballot-open", kind="initial"),
                entry(after, "ballot-cancel", kind="change")]
    for seat in after.seats:
        view = build_player_view(after, seat.id, timeline)
        ballots = [item.nomination for item in view.history if item.nomination]
        assert [ballot.status for ballot in ballots] == ["open", "cancelled"]
        assert view.nominations[0].votes[1].choice == "pending"
        assert view.nominations[0].votes[0].weight == 2
        assert view.nominations[0].votes[-1].dead_vote
        assert view.nominations[0].nominator.player_name != after.seats[0].player_name
    view.nominations[0].votes[0].weight = 7
    assert after.nominations[0].votes[0].weight == 2
    # Snapshot-only requests still include public voting, without invented earlier events.
    assert build_player_view(after, "seat-1").nominations == after.nominations


@pytest.mark.parametrize("audience,kind,note", [
    ({"visibility": "private", "recipient_seat_ids": []}, "note", "text"),
    ({"visibility": "private", "recipient_seat_ids": ["missing"]}, "note", "text"),
    ({"visibility": "private", "recipient_seat_ids": ["seat-1", "seat-1"]}, "note", "text"),
    ({"visibility": "public", "recipient_seat_ids": ["seat-1"]}, "note", "text"),
    ({"visibility": "public", "recipient_seat_ids": []}, "change", "text"),
    ({"visibility": "public", "recipient_seat_ids": []}, "note", "  "),
])
def test_invalid_visibility_is_rejected(client, audience, kind, note):
    game = knowledge_game().model_dump(mode="json")
    event = {**timeline_event(game, "event", kind), "audience": audience, "note": note}
    response = client.post("/api/games", json={**game, "timeline": [event]})
    assert response.status_code == 422


def test_save_branch_import_and_agent_execution_use_the_same_visible_prefix(client, monkeypatch):
    game = knowledge_game()
    timeline = [entry(game, "PUBLIC_EARLY", "public"),
                entry(game, "MY_EARLY_INFO", "private", ["seat-1"]),
                entry(game, "SECRET_OTHER_EVENT", "private", ["seat-2"]),
                entry(game, "FUTURE_EVENT", "public")]
    response = client.post("/api/games", json={
        **game.model_dump(mode="json"),
        "timeline": [event.model_dump(mode="json") for event in timeline],
    })
    assert response.status_code == 201, response.text
    record = response.json()
    url = f"/api/games/{record['id']}"
    assert client.get(url).json() == record
    request = {
        "game": record["draft"], "timeline": record["timeline"][:2],
        "selected_seat_id": "seat-1", "perspective": "player", "question": "Question",
    }
    preview = client.post("/api/reason/preview", json=request).json()
    assert "FUTURE_EVENT" not in preview["prompt"]
    assert "MY_EARLY_INFO" in preview["prompt"]
    assert "SECRET" not in preview["prompt"]
    calls = []

    async def reason(game, question, selected_seat_id, perspective, expected_prompt_sha256,
                     timeline=None):
        actual = client.app.state.harness.preview(
            game, question, selected_seat_id, perspective, timeline,
        )
        assert actual.prompt == preview["prompt"]
        assert actual.prompt_sha256 == expected_prompt_sha256 == preview["prompt_sha256"]
        calls.append(actual.prompt)
        return ReasonResponse(answer="Player answer", duration_ms=1)

    monkeypatch.setattr(client.app.state.harness, "reason", reason)
    analysed = client.post(url + "/analyses", json={
        "event_id": "MY_EARLY_INFO", "selected_seat_id": "seat-1", "perspective": "player",
        "question": "Question", "expected_prompt_sha256": preview["prompt_sha256"],
    })
    assert analysed.status_code == 201, analysed.text
    assert len(calls) == 1
    stale = client.post(url + "/analyses", json={
        "event_id": "FUTURE_EVENT", "selected_seat_id": "seat-1", "perspective": "player",
        "question": "Question", "expected_prompt_sha256": preview["prompt_sha256"],
    })
    assert stale.status_code == 409
    assert len(calls) == 1
    branch = client.post(url + "/branch", json={
        "event_id": "MY_EARLY_INFO", "expected_version": 1,
    }).json()
    branched = client.post("/api/reason/preview", json={
        **request, "game": branch["draft"], "timeline": branch["timeline"],
    }).json()
    assert branched["prompt"] == preview["prompt"]
    exported = client.get(url + "/export").json()
    imported = client.post("/api/games/import", json=exported)
    assert imported.status_code == 201, imported.text
    assert imported.json()["timeline"] == record["timeline"]
    # Saved sharing decisions are immutable, just like the event text.
    changed = deepcopy(record["timeline"])
    changed[1]["audience"] = {"visibility": "public", "recipient_seat_ids": []}
    assert client.put(url, json={
        **record["draft"], "timeline": changed, "expected_version": 1,
    }).status_code == 422
