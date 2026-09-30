import sqlite3
from pathlib import Path
from typing import List

import pytest

from backend.app.database import GameRepository, VersionConflict
from backend.app.models import GameDraft
from backend.tests.test_api import draft_payload


@pytest.fixture()
def tracked_connections(monkeypatch) -> List[sqlite3.Connection]:
    connections: List[sqlite3.Connection] = []
    connect = sqlite3.connect

    def track(*args, **kwargs) -> sqlite3.Connection:
        connection = connect(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr(sqlite3, "connect", track)
    return connections


def _assert_closed(connections: List[sqlite3.Connection]) -> None:
    assert connections
    for connection in connections:
        with pytest.raises(sqlite3.ProgrammingError, match="closed"):
            connection.execute("SELECT 1")


@pytest.mark.parametrize("operation", ["initialize", "create", "list", "get", "update", "delete"])
def test_repository_closes_connections_after_success(
    tmp_path: Path, tracked_connections: List[sqlite3.Connection], operation: str,
) -> None:
    repository = GameRepository(tmp_path / "games.sqlite3")
    repository.initialize()
    draft = GameDraft.model_validate(draft_payload())
    record = repository.create(draft)
    operations = {
        "initialize": repository.initialize,
        "create": lambda: repository.create(draft),
        "list": repository.list,
        "get": lambda: repository.get(record.id),
        "update": lambda: repository.update(record.id, draft, record.version),
        "delete": lambda: repository.delete(record.id),
    }
    operations[operation]()
    _assert_closed(tracked_connections)


def test_failed_update_closes_connections_and_preserves_record(
    tmp_path: Path, tracked_connections: List[sqlite3.Connection],
) -> None:
    repository = GameRepository(tmp_path / "games.sqlite3")
    repository.initialize()
    draft = GameDraft.model_validate(draft_payload())
    record = repository.create(draft)
    with pytest.raises(VersionConflict):
        repository.update(record.id, draft.model_copy(update={"name": "Must not save"}), 99)
    assert repository.get(record.id) == record
    _assert_closed(tracked_connections)
