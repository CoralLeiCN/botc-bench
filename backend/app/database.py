from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from .models import BranchOrigin, GameDraft, GameRecord, GameSummary, TimelineEntry


class GameNotFound(KeyError):
    pass


class VersionConflict(RuntimeError):
    pass


class TimelineConflict(ValueError):
    pass


class EventNotFound(KeyError):
    pass


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


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
            connection.execute("CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL)")
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
            columns = {row["name"] for row in connection.execute("PRAGMA table_info(games)")}
            if "timeline" not in columns:
                connection.execute(
                    "ALTER TABLE games ADD COLUMN timeline TEXT NOT NULL DEFAULT '[]'"
                )
            if "branch_origin" not in columns:
                connection.execute("ALTER TABLE games ADD COLUMN branch_origin TEXT")
            connection.execute("UPDATE schema_meta SET version = 2")

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

    def create(
        self, draft: GameDraft, timeline: Optional[List[TimelineEntry]] = None
    ) -> GameRecord:
        with self._connect() as connection:
            game_id = self._insert(connection, draft, timeline or [self._entry(draft, "开始记录")])
        return self.get(game_id)

    @staticmethod
    def _insert(
        connection: sqlite3.Connection,
        draft: GameDraft,
        timeline: List[TimelineEntry],
        origin: Optional[BranchOrigin] = None,
    ) -> str:
        game_id = str(uuid4())
        now = _utc_now().isoformat()
        connection.execute(
            """
            INSERT INTO games(
                id, version, name, script_id, player_count, payload, created_at, updated_at,
                timeline, branch_origin
            ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                game_id,
                draft.name,
                draft.script_id,
                draft.player_count,
                draft.model_dump_json(),
                now,
                now,
                GameRepository._timeline_json(timeline),
                origin.model_dump_json() if origin else None,
            ),
        )
        return game_id

    def update(
        self,
        game_id: str,
        draft: GameDraft,
        expected_version: int,
        timeline: Optional[List[TimelineEntry]] = None,
    ) -> GameRecord:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if row is None:
                raise GameNotFound(game_id)
            previous = self._record(row)
            if previous.version != expected_version:
                raise VersionConflict(f"expected {expected_version}, current {previous.version}")
            if timeline is None:
                timeline = previous.timeline
                if previous.draft != draft:
                    timeline = [*timeline, self._entry(draft, "更新局面", kind="change")]
            if timeline[: len(previous.timeline)] != previous.timeline:
                raise TimelineConflict(
                    "saved timeline is immutable; branch to explore an earlier state"
                )
            connection.execute(
                """
                UPDATE games
                SET version = version + 1,
                    name = ?, script_id = ?, player_count = ?, payload = ?, updated_at = ?,
                    timeline = ?
                WHERE id = ? AND version = ?
                """,
                (
                    draft.name,
                    draft.script_id,
                    draft.player_count,
                    draft.model_dump_json(),
                    _utc_now().isoformat(),
                    self._timeline_json(timeline),
                    game_id,
                    expected_version,
                ),
            )
        return self.get(game_id)

    def branch(self, game_id: str, event_id: str, expected_version: int) -> GameRecord:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
            if row is None:
                raise GameNotFound(game_id)
            source = self._record(row)
            if source.version != expected_version:
                raise VersionConflict(f"expected {expected_version}, current {source.version}")
            index = next(
                (i for i, event in enumerate(source.timeline) if event.id == event_id), None
            )
            if index is None:
                raise EventNotFound(event_id)
            snapshot = source.timeline[index].snapshot.model_dump()
            snapshot["name"] = f"{source.draft.name[:110]} · 分支"
            draft = GameDraft.model_validate(snapshot)
            timeline = [
                *source.timeline[: index + 1],
                self._entry(
                    draft, f"从「{source.draft.name}」第 {index + 1} 条记录创建分支", "branch"
                ),
            ]
            origin = BranchOrigin(game_id=game_id, game_name=source.draft.name, event_id=event_id)
            branch_id = self._insert(connection, draft, timeline, origin)
        return self.get(branch_id)

    def delete(self, game_id: str) -> None:
        with self._connect() as connection:
            cursor = connection.execute("DELETE FROM games WHERE id = ?", (game_id,))
        if cursor.rowcount == 0:
            raise GameNotFound(game_id)

    @staticmethod
    def _timeline_json(timeline: List[TimelineEntry]) -> str:
        return json.dumps([entry.model_dump(mode="json") for entry in timeline], ensure_ascii=False)

    @staticmethod
    def _entry(draft: GameDraft, summary: str, kind: str = "initial") -> TimelineEntry:
        return TimelineEntry(
            id=str(uuid4()),
            recorded_at=_utc_now(),
            kind=kind,
            summary=summary,
            snapshot=draft,
        )

    @staticmethod
    def _record(row: sqlite3.Row) -> GameRecord:
        payload = json.loads(row["payload"])
        timeline = json.loads(row["timeline"])
        if not timeline:
            timeline = [
                {
                    "id": f"legacy-{row['id']}",
                    "recorded_at": row["updated_at"],
                    "kind": "initial",
                    "summary": "旧存档起点（此前过程未记录）",
                    "snapshot": payload,
                }
            ]
        return GameRecord(
            id=row["id"],
            version=row["version"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            draft=GameDraft.model_validate(payload),
            timeline=timeline,
            branch_origin=json.loads(row["branch_origin"]) if row["branch_origin"] else None,
        )
