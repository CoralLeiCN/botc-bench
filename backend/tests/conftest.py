from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings
from backend.app.main import create_app


@pytest.fixture()
def client(tmp_path: Path):
    root = Path(__file__).resolve().parents[2]
    settings = Settings(
        root_dir=root,
        database_path=tmp_path / "games.sqlite3",
        script_data_path=root / "backend/app/data/official_scripts.json",
        codex_enabled=False,
    )
    with TestClient(create_app(settings)) as test_client:
        yield test_client
