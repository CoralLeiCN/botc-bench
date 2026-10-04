"""Render the allowlisted player view using a versioned YAML prompt template."""

import re
from html import escape
from pathlib import Path
from string import Template
from typing import Dict, List, Optional, Tuple

import yaml

from ..models import Nomination, PlayerHistoryEntry, PlayerRef, PlayerView

TEMPLATE_PATH = Path(__file__).resolve().parents[1] / "prompts" / "player_agent.yaml"
PLACEHOLDERS = {
    "prompt": {"template_id", "references", "evidence", "question"},
    "evidence": {
        "seat_id", "script_id", "player_count", "phase", "day_number", "seat_rows",
        "public_information", "shown_role_id", "shown_alignment", "private_information",
        "history", "nominations",
    },
    "seat_row": {"id", "position", "player_name", "alive", "public_claim"},
    "history_entry": {
        "id", "event_id", "recorded_at", "phase", "day_number", "kind", "visibility",
        "actor", "targets", "text", "nomination",
    },
    "nomination": {
        "id", "day_number", "nominator", "nominee", "status", "alive_count", "vote_rows",
    },
    "vote_row": {"id", "position", "player_name", "choice", "weight", "dead_vote"},
}


def _load_template(path: Path) -> Dict[str, str]:
    definition = yaml.safe_load(path.read_text(encoding="utf-8"))
    expected = {*PLACEHOLDERS, "id", "not_recorded", "empty_list"}
    if not isinstance(definition, dict) or set(definition) != expected:
        raise ValueError(f"{path}: prompt template fields must be {sorted(expected)}")
    if any(not isinstance(value, str) or not value.strip() for value in definition.values()):
        raise ValueError(f"{path}: prompt template fields must be nonempty strings")
    if not re.fullmatch(r"player-agent-v[1-9][0-9]*", definition["id"]):
        raise ValueError(f"{path}: invalid player template id")
    for name, required in PLACEHOLDERS.items():
        # Template.get_identifiers is unavailable on supported Python 3.9/3.10.
        matches = list(Template.pattern.finditer(definition[name]))
        actual = {match["named"] or match["braced"] for match in matches
                  if match["named"] or match["braced"]}
        if any(match["invalid"] is not None for match in matches) or actual != required:
            raise ValueError(
                f"{path}: {name} must use exactly these placeholders: {sorted(required)}"
            )
    return definition


DEFINITION = _load_template(TEMPLATE_PATH)
TEMPLATE_ID = DEFINITION["id"]


def _render(part: str, **values: object) -> str:
    # A single substitution pass leaves dollar signs in evidence untouched.
    return Template(DEFINITION[part]).substitute(values).strip()


def _cell(value: str) -> str:
    """Keep untrusted text inside one Markdown table cell."""
    if not value:
        return DEFINITION["not_recorded"]
    escaped = re.sub(r"([\\`*_\[\]|~])", r"\\\1", escape(value, quote=False))
    return escaped.replace("\r\n", "<br>").replace("\r", "<br>").replace("\n", "<br>")


def _fence(value: str, minimum: int = 3) -> str:
    return "`" * max(minimum, 1 + max((len(run) for run in re.findall(r"`+", value)), default=0))


def _code(value: Optional[str]) -> str:
    if value is None or value == "":
        return DEFINITION["not_recorded"]
    # Keep IDs/names on one Markdown line; table IDs use _cell instead.
    if "\r" in value or "\n" in value:
        return _cell(value)
    fence = _fence(value, minimum=1)
    return f"{fence} {value} {fence}"


def _block(value: str) -> str:
    if not value:
        return DEFINITION["not_recorded"]
    fence = _fence(value)
    return f"{fence}text\n{value}\n{fence}"


def _player(player: Optional[PlayerRef]) -> str:
    if player is None:
        return DEFINITION["not_recorded"]
    return f"{_code(player.id)} / {player.position} / {_code(player.player_name)}"


def _nomination(nomination: Nomination) -> str:
    return _render(
        "nomination", id=_code(nomination.id), day_number=nomination.day_number,
        nominator=_player(nomination.nominator), nominee=_player(nomination.nominee),
        status=_code(nomination.status), alive_count=nomination.alive_count,
        vote_rows="\n".join(
            _render(
                "vote_row", id=_cell(vote.player.id), position=vote.player.position,
                player_name=_cell(vote.player.player_name), choice=vote.choice,
                weight=vote.weight, dead_vote=str(vote.dead_vote).lower(),
            ) for vote in nomination.votes
        ),
    )


def _history_entry(entry: PlayerHistoryEntry) -> str:
    return _render(
        "history_entry", id=_code(entry.id), event_id=_code(entry.event_id),
        recorded_at=_code(entry.recorded_at.isoformat()), phase=_code(entry.phase),
        day_number=entry.day_number, kind=_code(entry.kind), visibility=_code(entry.visibility),
        actor=_player(entry.actor),
        targets="; ".join(_player(player) for player in entry.targets) or DEFINITION["empty_list"],
        text=_block(entry.text),
        nomination=_nomination(entry.nomination) if entry.nomination is not None else "",
    )


def render_player_markdown(view: PlayerView) -> str:
    """Format already-filtered evidence without consulting hidden game state."""
    return _render(
        "evidence", seat_id=_code(view.you.seat_id), script_id=_code(view.script_id),
        player_count=view.player_count, phase=_code(view.phase), day_number=view.day_number,
        seat_rows="\n".join(
            _render(
                "seat_row", id=_cell(seat.id), position=seat.position,
                player_name=_cell(seat.player_name), alive=str(seat.alive).lower(),
                public_claim=_cell(seat.public_claim),
            ) for seat in view.seats
        ),
        public_information=_block(view.public_information),
        shown_role_id=_code(view.you.shown_role_id),
        shown_alignment=_code(view.you.shown_alignment),
        private_information=_block(view.you.private_information),
        history="\n\n".join(_history_entry(entry) for entry in view.history)
        or DEFINITION["empty_list"],
        nominations="\n\n".join(_nomination(nomination) for nomination in view.nominations)
        or DEFINITION["empty_list"],
    )


def render_player_prompt(view: PlayerView, question: str, references: List[Tuple[str, str]]) -> str:
    return _render(
        "prompt", template_id=TEMPLATE_ID,
        references="\n".join(
            f'<trusted-reference path="{path}">\n{content}\n</trusted-reference>'
            for path, content in references
        ),
        evidence=render_player_markdown(view), question=_block(question),
    )
