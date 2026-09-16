from __future__ import annotations

import asyncio
import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest

from backend.app.models import GameDraft, NightChecklist, NightStep
from backend.app.services.codex_harness import CodexHarness, PromptChanged
from backend.app.services.player_view import build_player_view
from backend.tests.test_api import draft_payload

ROOT = Path(__file__).resolve().parents[2]


def knowledge_game() -> GameDraft:
    payload = draft_payload()
    payload["name"] = "SECRET_GAME_NAME"
    payload["notes"] = "SECRET_GLOBAL_NOTE"
    payload["public_information"] = "Day 1: no execution."
    for index, seat in enumerate(payload["seats"]):
        seat.update(
            role_id="drunk" if index == 0 else "imp",
            shown_role_id="empath" if index == 0 else "washerwoman",
            shown_alignment="good",
            alignment="good" if index == 0 else "evil",
            public_claim=f"Claim {index + 1}: I am the Chef.",
            private_information=f"PRIVATE_{index + 1}: learned 0.",
            notes=f"SECRET_SEAT_NOTE_{index + 1}",
            markers=[{
                "id": f"marker-{index}", "type": "poisoned",
                "label": "SECRET_MARKER", "note": "SECRET_MARKER_NOTE",
                "source_role_id": "poisoner",
            }],
        )
    return GameDraft.model_validate(payload)


def harness(root=ROOT, binary="/bin/echo") -> CodexHarness:
    return CodexHarness(root_dir=root, binary=binary, enabled=True, timeout_seconds=10)


def state_from_prompt(prompt: str) -> dict:
    return json.loads(prompt.split("<player-view-json>\n")[1].split("\n</player-view-json>")[0])


def test_drunk_receives_shown_empath_and_no_storyteller_fields() -> None:
    game = knowledge_game()
    view = build_player_view(game, "seat-1").model_dump()
    assert set(view) == {
        "script_id", "player_count", "phase", "day_number", "seats", "public_information", "you",
    }
    assert view["you"] == {
        "seat_id": "seat-1", "shown_role_id": "empath", "shown_alignment": "good",
        "private_information": "PRIVATE_1: learned 0.",
    }
    for seat in view["seats"]:
        assert set(seat) == {"id", "position", "player_name", "alive", "public_claim"}
    assert "drunk" not in json.dumps(view)
    assert "SECRET" not in json.dumps(view)
    assert view["public_information"] == "Day 1: no execution."
    assert game.seats[0].role_id == "drunk"
    view["seats"][0]["public_claim"] = "mutated projection"
    assert game.seats[0].public_claim == "Claim 1: I am the Chef."


@pytest.mark.parametrize("viewer", range(1, 8))
def test_every_agent_receives_only_its_own_private_information(viewer: int) -> None:
    game = knowledge_game()
    prompt = harness().build_prompt(game, "What do I know?", f"seat-{viewer}", "player")
    state = state_from_prompt(prompt)
    assert state == build_player_view(game, f"seat-{viewer}").model_dump(mode="json")
    for index in range(1, 8):
        assert (f"PRIVATE_{index}" in prompt) == (index == viewer)
        assert f"Claim {index}: I am the Chef." in prompt
    assert "SECRET" not in prompt
    assert "<game-state-json>" not in prompt


def test_hidden_truth_does_not_change_player_input_even_after_death() -> None:
    game = knowledge_game()
    game.seats[0].alive = False
    game.phase = "finished"
    before = harness().preview(game, "Question", "seat-1", "player")
    changed = deepcopy(game)
    changed.name = "different hidden title"
    changed.notes = "different private notes"
    changed.composition.manual = True
    for seat in changed.seats:
        seat.role_id = "baron"
        seat.alignment = "evil"
        seat.markers = []
        seat.notes = "different seat notes"
        if seat.id != "seat-1":
            seat.shown_role_id = "ravenkeeper"
            seat.shown_alignment = "evil"
            seat.private_information = "different private knowledge"
    assert harness().preview(changed, "Question", "seat-1", "player") == before


def test_missing_shown_role_never_falls_back_to_actual_role() -> None:
    game = knowledge_game()
    game.seats[0].shown_role_id = None
    game.seats[0].shown_alignment = "unknown"
    view = build_player_view(game, "seat-1")
    assert view.you.shown_role_id is None
    assert view.you.shown_alignment == "unknown"
    with pytest.raises(ValueError, match="not present"):
        build_player_view(game, "missing-seat")


def test_night_checklist_does_not_expose_unreleased_information_or_decisions() -> None:
    game = knowledge_game()
    before = harness().preview(game, "Question", "seat-1", "player")
    game.night_checklist = NightChecklist(
        id="night-1", script_id=game.script_id, phase="first_night", day_number=1,
        steps=[NightStep(
            id="step-1", seat_id="seat-1", instruction_id="empath", title="SECRET_NIGHT_TITLE",
            information="SECRET_UNRELEASED_INFORMATION", decision="SECRET_DRUNK_DECISION",
            choice="SECRET_CHOICE",
        )],
        reviewed_effects=["SECRET_EFFECT"],
    )
    assert harness().preview(game, "Question", "seat-1", "player") == before
    assert "SECRET_DRUNK_DECISION" in harness().build_prompt(game, "Question", "seat-1")


def test_preview_is_exact_cli_input_and_changed_preview_never_launches(tmp_path: Path) -> None:
    # Only small fixed references are needed to prove byte-for-byte transport.
    for relative in (
        "games_rules.md", "scripts/script-002/ROLES_OFFICIAL.md",
        "scripts/script-002/OFFICIAL_QA.md", "scripts/script-002/reference/README.md",
    ):
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("Fixed reference text.", encoding="utf-8")
    fake = tmp_path / "fake-codex"
    fake.write_text(
        "#!/usr/bin/env python3\nimport sys\nsys.stdout.write(sys.stdin.read())\n", encoding="utf-8"
    )
    fake.chmod(0o755)
    runner = harness(tmp_path, str(fake))
    game = knowledge_game()
    preview = runner.preview(game, "我的线索？", "seat-1", "player")
    answer = asyncio.run(runner.reason(
        game, "我的线索？", "seat-1", "player", preview.prompt_sha256,
    ))
    assert answer.answer == preview.prompt
    assert preview.prompt_sha256 == hashlib.sha256(preview.prompt.encode("utf-8")).hexdigest()
    # An invalid executable would fail differently if a stale preview launched the process.
    runner._binary = "/does-not-exist"
    game.seats[0].private_information = "Updated information"
    with pytest.raises(PromptChanged):
        asyncio.run(runner.reason(game, "我的线索？", "seat-1", "player", preview.prompt_sha256))


def test_storyteller_retains_truth_and_knowledge_separately() -> None:
    prompt = harness().build_prompt(knowledge_game(), "Question", "seat-1")
    state = json.loads(prompt.split("<game-state-json>\n")[1].split("\n</game-state-json>")[0])
    assert state["seats"][0]["role_id"] == "drunk"
    assert state["seats"][0]["shown_role_id"] == "empath"
    assert "SECRET_GLOBAL_NOTE" in prompt
    assert "PRIVATE_7" in prompt
