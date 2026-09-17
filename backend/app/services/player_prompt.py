"""One versioned agent template, shared by preview and execution."""

import json
from pathlib import Path
from string import Template
from typing import List, Tuple

from ..models import PlayerView

TEMPLATE_ID = "player-agent-v1"
TEMPLATE = Template(
    (Path(__file__).resolve().parents[1] / "templates" / "player_agent.txt").read_text(
        encoding="utf-8"
    ).strip()
)


def render_player_prompt(view: PlayerView, question: str, references: List[Tuple[str, str]]) -> str:
    return TEMPLATE.substitute(
        references="\n".join(
            f'<trusted-reference path="{path}">\n{content}\n</trusted-reference>'
            for path, content in references
        ),
        state=json.dumps(
            view.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, indent=2,
        ),
        question=question,
    )
