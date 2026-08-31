from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Tuple


def _as_bool(value: str) -> bool:
    return value.strip().lower() not in {"0", "false", "no", "off"}


@dataclass(frozen=True)
class Settings:
    root_dir: Path
    database_path: Path
    script_data_path: Path
    codex_binary: str = "codex"
    codex_model: Optional[str] = None
    codex_enabled: bool = True
    codex_timeout_seconds: int = 120
    allowed_origins: Tuple[str, ...] = (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    )

    @classmethod
    def from_env(cls) -> "Settings":
        root = Path(__file__).resolve().parents[2]
        data_dir = root / ".data"
        timeout = int(os.getenv("CODEX_HARNESS_TIMEOUT_SECONDS", "120"))
        return cls(
            root_dir=root,
            database_path=Path(os.getenv("BOTC_DATABASE_PATH", data_dir / "games.sqlite3")),
            script_data_path=root / "backend/app/data/official_scripts.json",
            codex_binary=os.getenv("CODEX_BINARY", "codex"),
            codex_model=os.getenv("CODEX_MODEL") or None,
            codex_enabled=_as_bool(os.getenv("CODEX_HARNESS_ENABLED", "true")),
            codex_timeout_seconds=max(15, min(timeout, 600)),
        )
