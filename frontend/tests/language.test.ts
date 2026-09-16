import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDraft, hasSeatData, validateDraft } from "../src/game.ts";
import { LANGUAGE_STORAGE_KEY, localizedText, readLanguage, translate } from "../src/language.ts";
import { createNightChecklist, nightStepTitle } from "../src/night.ts";
import { createEntry, recordChange, timelineSummary } from "../src/timeline.ts";
import type { Script } from "../src/types.ts";

const scripts: Script[] = JSON.parse(readFileSync(new URL("../../backend/app/data/official_scripts.json", import.meta.url), "utf8")).scripts;
const script = scripts[0];

test("language preference restores English and tolerates missing, invalid, or blocked storage", () => {
  assert.equal(readLanguage({ getItem: (key) => key === LANGUAGE_STORAGE_KEY ? "en" : null }), "en");
  for (const value of [null, "zh_hans", "invalid"]) assert.equal(readLanguage({ getItem: () => value }), "zh_hans");
  assert.equal(readLanguage({ getItem: () => { throw new Error("blocked"); } }), "zh_hans");
});

test("official text uses one exact source language without inventing or mixing translations", () => {
  const before = JSON.stringify(scripts);
  for (const edition of scripts) {
    for (const text of [edition.name, ...[...edition.roles, ...edition.travellers].flatMap((role) => [role.name, role.ability])]) {
      assert.equal(localizedText(text, "en"), text.en);
      assert.equal(localizedText(text, "zh_hans"), text.zh_hans);
    }
  }
  assert.equal(localizedText({ en: null, zh_hans: "中文" }, "en"), "No official text available in this language");
  assert.equal(localizedText({ en: null, zh_hans: "中文" }, "en", ""), "");
  assert.equal(JSON.stringify(scripts), before);
});

test("translated interpolation preserves user-provided values verbatim", () => {
  assert.equal(translate("en", "已载入「{0}」", ["中文 {1} $&"]), "Loaded “中文 {1} $&”");
  assert.equal(translate("zh_hans", "已载入「{0}」", ["English"]), "已载入「English」");
});

test("display language changes generated night and timeline text without changing recorded state or custom text", () => {
  const draft = createDraft(script, 7, "en");
  assert.equal(hasSeatData(draft.seats[0]), false);
  draft.seats[0].role_id = "chef";
  draft.seats[0].notes = "Keep this 中文 note";
  draft.phase = "first_night";
  draft.day_number = 1;
  draft.night_checklist = createNightChecklist(draft, script, "first_night", 1);
  const step = draft.night_checklist.steps.find((item) => item.instruction_id === "chef")!;
  const saved = JSON.stringify(draft);
  assert.equal(nightStepTitle(step, draft, script, "en"), "Player 1 · Chef");
  assert.equal(nightStepTitle(step, draft, script, "zh_hans"), "Player 1 · 厨师");
  assert.equal(nightStepTitle({ ...step, title: "Custom 中文 action" }, draft, script, "en"), "Custom 中文 action");
  const initial = createEntry(draft, "开始记录", "initial");
  const changed = structuredClone(draft);
  changed.seats[0].role_id = "empath";
  const timeline = recordChange([initial], changed, scripts);
  assert.match(timelineSummary(timeline[1], initial, scripts, "en"), /Chef → Empath/);
  assert.match(timelineSummary(timeline[1], initial, scripts, "zh_hans"), /厨师 → 共情者/);
  assert.equal(timelineSummary({ ...timeline[1], summary: "Custom 中文 summary" }, initial, scripts, "en"), "Custom 中文 summary");
  assert.equal(timelineSummary(initial, undefined, scripts, "en"), "Recording started");
  assert.match(validateDraft(draft, script, "en")[0].message, /seats still need a character/);
  assert.equal(JSON.stringify(draft), saved);
});
