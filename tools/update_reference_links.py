#!/usr/bin/env python3
"""Refresh URL indexes for scripts, rules, and FAQ documents."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
URL_PATTERN = re.compile(r"https://[^\s)>]+")


def extract(files: Iterable[Path]) -> List[Tuple[str, List[str]]]:
    result = []
    for path in files:
        if not path.exists():
            continue
        urls = sorted(set(URL_PATTERN.findall(path.read_text(encoding="utf-8"))))
        result.append((path.relative_to(ROOT).as_posix(), urls))
    return result


def write_index(target: Path, title: str, files: Iterable[Path]) -> None:
    lines = [
        f"# {title}",
        "",
        "> 本文件由 `tools/update_reference_links.py` 生成；请勿手工编辑。",
        "",
    ]
    for relative, urls in extract(files):
        lines.extend([f"## `{relative}`", ""])
        if urls:
            lines.extend(f"- {url}" for url in urls)
        else:
            lines.append("- 本文件未直接嵌入 URL；来源状态与上游链接见相邻 `reference/README.md`。")
        lines.append("")
    target.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    write_index(
        ROOT / "reference/links.md",
        "根目录规则原始链接索引",
        [ROOT / "games_rules.md", ROOT / "benchmark_rules.md", ROOT / "reference/README.md"],
    )
    write_index(
        ROOT / "scripts/reference/links.md",
        "剧本索引原始链接",
        [ROOT / "scripts/README.md", ROOT / "scripts/reference/README.md"],
    )
    for directory in sorted((ROOT / "scripts").glob("script-*")):
        reference = directory / "reference"
        reference.mkdir(exist_ok=True)
        write_index(
            reference / "links.md",
            f"{directory.name} 原始链接索引",
            [
                directory / "README.md",
                directory / "ROLES_OFFICIAL.md",
                directory / "OFFICIAL_QA.md",
                directory / "reference/README.md",
            ],
        )


if __name__ == "__main__":
    main()
