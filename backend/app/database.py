from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List
from uuid import uuid4

from .models import GameDraft, GameRecord, GameSummary


class GameNotFound(KeyError):
    pass


class VersionConflict(RuntimeError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


class GameRepository:
    def __init__(self, database_path: Path) -> None:
        self._path = database_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        return connection

    def initialize(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS schema_meta (
                    version INTEGER NOT NULL
                )
                """
            )
            if connection.execute("SELECT COUNT(*) FROM schema_meta").fetchone()[0] == 0:
                connection.execute("INSERT INTO schema_meta(version) VALUES (1)")
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS games (
                    id TEXT PRIMARY KEY,
                    version INTEGER NOT NULL CHECK(version >= 1),
                    name TEXT NOT NULL,
                    script_id TEXT NOT NULL,
                    player_count INTEGER NOT NULL CHECK(player_count BETWEEN 5 AND 20),
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS games_updated_idx ON games(updated_at DESC)"
            )

    def list(self) -> List[GameSummary]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                SELECT id, version, name, script_id, player_count, updated_at
                FROM games ORDER BY updated_at DESC
                """
            ).fetchall()
        return [GameSummary.model_validate(dict(row)) for row in rows]

    def get(self, game_id: str) -> GameRecord:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        if row is None:
            raise GameNotFound(game_id)
        return self._record(row)

    def create(self, draft: GameDraft) -> GameRecord:
        game_id = str(uuid4())
        now = _utc_now()
        payload = draft.model_dump_json()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO games(
                    id, version, name, script_id, player_count, payload, created_at, updated_at
                ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
                """,
                (
                    game_id,
                    draft.name,
                    draft.script_id,
                    draft.player_count,
                    payload,
                    now.isoformat(),
                    now.isoformat(),
                ),
            )
        return self.get(game_id)

    def update(self, game_id: str, draft: GameDraft, expected_version: int) -> GameRecord:
        now = _utc_now()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                UPDATE games
                SET version = version + 1,
                    name = ?, script_id = ?, player_count = ?, payload = ?, updated_at = ?
                WHERE id = ? AND version = ?
                """,
                (
                    draft.name,
                    draft.script_id,
                    draft.player_count,
                    draft.model_dump_json(),
                    now.isoformat(),
                    game_id,
                    expected_version,
                ),
            )
            if cursor.rowcount == 0:
                exists = connection.execute(
                    "SELECT version FROM games WHERE id = ?", (game_id,)
                ).fetchone()
                if exists is None:
                    raise GameNotFound(game_id)
                raise VersionConflict(f"expected {expected_version}, current {exists['version']}")
        return self.get(game_id)

    def delete(self, game_id: str) -> None:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM games WHERE id = ?", (game_id,))
        if cursor.rowcount == 0:
            raise GameNotFound(game_id)

    @staticmethod
    def _record(row: sqlite3.Row) -> GameRecord:
        payload = json.loads(row["payload"])
        return GameRecord(
            id=row["id"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            draft=GameDraft.model_validate(payload),
        )
