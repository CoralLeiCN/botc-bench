#!/usr/bin/env python3
"""Generate app data and bilingual role tables from official TPI JSON files."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[2]
ROLES_URL = (
    "https://raw.githubusercontent.com/ThePandemoniumInstitute/"
    "botc-release/main/resources/data/roles.json"
)
ZH_HANS_URL = (
    "https://raw.githubusercontent.com/ThePandemoniumInstitute/"
    "botc-translations/main/game/zh_Hans.json"
)
EN_URL = (
    "https://raw.githubusercontent.com/ThePandemoniumInstitute/"
    "botc-translations/main/game/en.json"
)
SOURCE_PAGES = {
    "tb": "https://wiki.bloodontheclocktower.com/Trouble_Brewing",
    "bmr": "https://wiki.bloodontheclocktower.com/Bad_Moon_Rising",
    "snv": "https://wiki.bloodontheclocktower.com/Sects_%26_Violets",
}
SCRIPT_META = {
    "tb": {"id": "script-002", "name_en": "Trouble Brewing", "difficulty": "beginner"},
    "bmr": {"id": "script-003", "name_en": "Bad Moon Rising", "difficulty": "intermediate"},
    "snv": {"id": "script-004", "name_en": "Sects & Violets", "difficulty": "intermediate"},
}
TEAM_ORDER = {
    "townsfolk": 0,
    "outsider": 1,
    "minion": 2,
    "demon": 3,
    "traveller": 4,
}
TEAM_LABELS = {
    "townsfolk": "镇民 / Townsfolk",
    "outsider": "外来者 / Outsiders",
    "minion": "爪牙 / Minions",
    "demon": "恶魔 / Demons",
    "traveller": "旅行者 / Travellers",
}


def load_json(path: Optional[Path], url: str) -> Tuple[Any, str]:
    if path:
        raw = path.read_bytes()
        return json.loads(raw), hashlib.sha256(raw).hexdigest()
    with urllib.request.urlopen(url, timeout=30) as response:  # noqa: S310 - fixed official URLs
        raw = response.read()
        return json.loads(raw), hashlib.sha256(raw).hexdigest()


def bracket_effect(text: str) -> Optional[str]:
    match = re.search(r"\[([^]]+)]\s*$", text)
    return match.group(1) if match else None


def build_scripts(
    roles: Iterable[Dict[str, Any]], zh: Dict[str, Any], en: Dict[str, Any]
) -> List[Dict[str, Any]]:
    official_teams = set(TEAM_ORDER)
    result: List[Dict[str, Any]] = []
    all_roles = list(roles)
    translations = zh["roles"]
    editions = zh["editions"]

    for edition, meta in SCRIPT_META.items():
        edition_roles = [
            role
            for role in all_roles
            if role.get("edition") == edition and role.get("team") in official_teams
        ]
        localized_roles = []
        for role in edition_roles:
            translated = translations.get(role["id"])
            if not translated or not translated.get("name") or not translated.get("ability"):
                raise ValueError(f"Missing official zh_Hans text for role {role['id']}")
            localized_roles.append(
                {
                    "id": role["id"],
                    "team": role["team"],
                    "name": {"en": role["name"], "zh_hans": translated["name"]},
                    "ability": {"en": role["ability"], "zh_hans": translated["ability"]},
                    "setup": bool(role.get("setup")),
                    "setup_effect": {
                        "en": bracket_effect(role["ability"]),
                        "zh_hans": bracket_effect(translated["ability"]),
                    },
                    "reminders": role.get("reminders", []),
                }
            )

        localized_roles.sort(key=lambda item: TEAM_ORDER[item["team"]])
        result.append(
            {
                "id": meta["id"],
                "edition": edition,
                "official": True,
                "difficulty": meta["difficulty"],
                "name": {"en": meta["name_en"], "zh_hans": editions[edition]["name"]},
                "description": {
                    "en": en["editions"][edition].get("description"),
                    "zh_hans": editions[edition].get("description"),
                },
                "roles": [role for role in localized_roles if role["team"] != "traveller"],
                "travellers": [role for role in localized_roles if role["team"] == "traveller"],
                "qa_path": f"scripts/{meta['id']}/OFFICIAL_QA.md",
                "reference_path": f"scripts/{meta['id']}/reference/README.md",
                "sources": {
                    "edition": SOURCE_PAGES[edition],
                    "english_roles": ROLES_URL,
                    "english_locale": EN_URL,
                    "zh_hans": ZH_HANS_URL,
                },
            }
        )
    return result


def render_roles_markdown(script: Dict[str, Any], retrieved_at: str) -> str:
    name = script["name"]
    lines = [
        f"# {name['zh_hans']} / {name['en']} — 官方双语角色文本",
        "",
        "> 本页由 `backend/tools/sync_official_data.py` 生成。英文来自 TPI 官方角色数据，",
        "> 简体中文来自 TPI 官方 `zh_Hans` 翻译；未进行自行翻译或润色。",
        f"> 检索日期：**{retrieved_at}**。来源与维护说明见 "
        "[reference/README.md](reference/README.md)。",
        f"> 主剧本角色 **{len(script['roles'])}** 名；另列本版本的 "
        f"**{len(script['travellers'])}** 名官方旅行者。",
        "",
    ]
    for team in TEAM_ORDER:
        lines.extend([f"## {TEAM_LABELS[team]}", ""])
        available_roles = [*script["roles"], *script["travellers"]]
        for role in (item for item in available_roles if item["team"] == team):
            lines.extend(
                [
                    f"### {role['name']['zh_hans']} / {role['name']['en']}",
                    "",
                    f"- **中文（官方）**：{role['ability']['zh_hans']}",
                    f"- **English (official)**: {role['ability']['en']}",
                    "",
                ]
            )
    return "\n".join(lines).rstrip() + "\n"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--roles-file", type=Path)
    parser.add_argument("--translation-file", type=Path)
    parser.add_argument("--english-file", type=Path)
    parser.add_argument("--retrieved-at", default=date.today().isoformat())
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    roles, roles_sha256 = load_json(args.roles_file, ROLES_URL)
    translations, translations_sha256 = load_json(args.translation_file, ZH_HANS_URL)
    english, english_sha256 = load_json(args.english_file, EN_URL)
    scripts = build_scripts(roles, translations, english)
    payload = {
        "schema_version": 1,
        "retrieved_at": args.retrieved_at,
        "sources": {
            "english_roles": ROLES_URL,
            "english_locale": EN_URL,
            "zh_hans": ZH_HANS_URL,
        },
        "source_sha256": {
            "english_roles": roles_sha256,
            "english_locale": english_sha256,
            "zh_hans": translations_sha256,
        },
        "scripts": scripts,
    }
    output = ROOT / "backend/app/data/official_scripts.json"
    output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for script in scripts:
        markdown = render_roles_markdown(script, args.retrieved_at)
        target = ROOT / "scripts" / script["id"] / "ROLES_OFFICIAL.md"
        target.write_text(markdown, encoding="utf-8")


if __name__ == "__main__":
    main()
