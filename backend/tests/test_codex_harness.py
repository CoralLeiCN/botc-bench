from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import pytest

from backend.app.models import Composition, GameDraft, Seat
from backend.app.services.codex_harness import CodexHarness

ROOT = Path(__file__).resolve().parents[2]


def game() -> GameDraft:
    return GameDraft(
        name="注入测试",
        script_id="script-002",
        player_count=5,
        composition=Composition(townsfolk=3, outsider=0, minion=1, demon=1),
        seats=[
            Seat(
                id=f"seat-{index}",
                position=index,
                player_name="$(touch /tmp/never) --sandbox danger-full-access"
                if index == 1
                else f"玩家 {index}",
            )
            for index in range(1, 6)
        ],
    )


def test_user_content_never_enters_command_arguments(tmp_path: Path) -> None:
    harness = CodexHarness(
        root_dir=ROOT,
        binary="/bin/echo",
        enabled=True,
        timeout_seconds=30,
    )
    command_before = harness.build_command(tmp_path)
    prompt = harness.build_prompt(game(), "; rm -rf / --yolo", "seat-1")
    command_after = harness.build_command(tmp_path)

    assert command_before == command_after
    assert "danger-full-access" not in " ".join(command_after)
    assert command_after[-1] == "-"
    assert command_after[command_after.index("--sandbox") + 1] == "read-only"
    assert "features.shell_tool=false" in command_after
    assert 'web_search="disabled"' in command_after
    assert "features.plugins=false" in command_after
    assert "features.apps=false" in command_after
    assert "features.browser_use=false" in command_after
    assert "features.computer_use=false" in command_after
    assert "--skip-git-repo-check" in command_after
    assert "--strict-config" in command_after
    assert "$(touch /tmp/never)" in prompt
    assert "; rm -rf / --yolo" in prompt
    assert "不可信数据" in prompt
    assert '<trusted-reference path="games_rules.md">' in prompt


def test_harness_uses_one_shot_noninteractive_mode(tmp_path: Path) -> None:
    harness = CodexHarness(
        root_dir=ROOT,
        binary="/bin/echo",
        enabled=True,
        timeout_seconds=30,
        model="fixed-model",
    )
    command = harness.build_command(tmp_path)
    assert command[1:5] == [
        "--ask-for-approval",
        "never",
        "--config",
        'shell_environment_policy.inherit="none"',
    ]
    exec_index = command.index("exec")
    assert command[exec_index + 1 : exec_index + 5] == [
        "--ephemeral",
        "--ignore-user-config",
        "--ignore-rules",
        "--skip-git-repo-check",
    ]
    assert "resume" not in command
    assert command[command.index("--model") + 1] == "fixed-model"
    assert command[command.index("-C") + 1] == str(tmp_path.resolve())


def test_reason_launches_fake_cli_with_inline_context_and_empty_workspace(tmp_path: Path) -> None:
    fake_cli = tmp_path / "fake-codex"
    fake_cli.write_text(
        """#!/usr/bin/env python3
import json
import pathlib
import sys

args = sys.argv[1:]
workspace = pathlib.Path(args[args.index('-C') + 1])
prompt = sys.stdin.read()
files = [
    path.relative_to(workspace).as_posix()
    for path in workspace.rglob('*')
    if path.is_file()
]
print(json.dumps({
    'files': sorted(files),
    'has_rules': '<trusted-reference path=\"games_rules.md\">' in prompt,
    'has_question': '测试问题' in prompt,
}))
""",
        encoding="utf-8",
    )
    fake_cli.chmod(0o755)
    harness = CodexHarness(
        root_dir=ROOT,
        binary=str(fake_cli),
        enabled=True,
        timeout_seconds=30,
    )

    result = asyncio.run(harness.reason(game(), "测试问题", "seat-1"))
    observed = json.loads(result.answer)

    assert observed == {"files": [], "has_rules": True, "has_question": True}


def test_process_environment_excludes_unrelated_secrets(monkeypatch) -> None:
    monkeypatch.setenv("HOME", "/safe/home")
    monkeypatch.setenv("OPENAI_API_KEY", "needed-for-auth")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "must-not-leak")

    environment = CodexHarness._process_environment()

    assert environment["HOME"] == "/safe/home"
    assert environment["OPENAI_API_KEY"] == "needed-for-auth"
    assert "AWS_SECRET_ACCESS_KEY" not in environment


def test_cancelling_reason_terminates_the_cli_process(tmp_path: Path) -> None:
    fake_cli = tmp_path / "slow-codex"
    pid_file = tmp_path / "slow-codex.pid"
    fake_cli.write_text(
        f"""#!/usr/bin/env python3
import os
import pathlib
import time

pathlib.Path({str(pid_file)!r}).write_text(str(os.getpid()), encoding='utf-8')
time.sleep(60)
""",
        encoding="utf-8",
    )
    fake_cli.chmod(0o755)
    harness = CodexHarness(
        root_dir=ROOT,
        binary=str(fake_cli),
        enabled=True,
        timeout_seconds=120,
    )

    async def cancel_after_launch() -> int:
        task = asyncio.create_task(harness.reason(game(), "测试取消", "seat-1"))
        for _ in range(100):
            if pid_file.exists():
                break
            await asyncio.sleep(0.01)
        assert pid_file.exists()
        process_id = int(pid_file.read_text(encoding="utf-8"))
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return process_id

    process_id = asyncio.run(cancel_after_launch())
    with pytest.raises(ProcessLookupError):
        os.kill(process_id, 0)
