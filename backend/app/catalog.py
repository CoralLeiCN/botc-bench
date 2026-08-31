from __future__ import annotations

import json
from pathlib import Path
from typing import List

from .models import Script


class ScriptNotFound(KeyError):
    pass


class ScriptCatalog:
    def __init__(self, data_path: Path, root_dir: Path) -> None:
        payload = json.loads(data_path.read_text(encoding="utf-8"))
        self._root_dir = root_dir.resolve()
        self.retrieved_at = payload["retrieved_at"]
        parsed_scripts = (Script.model_validate(item) for item in payload["scripts"])
        self._scripts = {script.id: script for script in parsed_scripts}

    def list(self) -> List[Script]:
        return list(self._scripts.values())

    def get(self, script_id: str) -> Script:
        try:
            return self._scripts[script_id]
        except KeyError as exc:
            raise ScriptNotFound(script_id) from exc

    def read_qa(self, script_id: str) -> str:
        script = self.get(script_id)
        target = (self._root_dir / script.qa_path).resolve()
        if self._root_dir not in target.parents:
            raise RuntimeError("catalog path escaped repository root")
        return target.read_text(encoding="utf-8")
