import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDraft } from "../src/game.ts";
import {
  addNightStep, canFinishNight, createNightChecklist, expiringEffects, finishNight,
  isCurrentNight, moveNightStep, newNightStep, nextNightStep, nightStepSeats,
  reviewEffect, syncNightSteps, updateNightStep,
} from "../src/night.ts";
import { createEntry, recordChange } from "../src/timeline.ts";
import type { GameDraft, Script } from "../src/types.ts";

const scripts: Script[] = JSON.parse(readFileSync(new URL("../../backend/app/data/official_scripts.json", import.meta.url), "utf8")).scripts;
const script = scripts[0];
function night(roleIds = ["poisoner", "imp", "empath", "monk", "ravenkeeper", "chef", "fortuneteller"], phase: "first_night" | "night" = "first_night"): GameDraft {
  const game = createDraft(script, roleIds.length);
  game.phase = phase;
  game.day_number = phase === "first_night" ? 1 : 2;
  game.seats.forEach((seat, index) => { seat.role_id = roleIds[index]; });
  game.night_checklist = createNightChecklist(game, script, phase, game.day_number);
  return game;
}
const actionIds = (game: GameDraft) => game.night_checklist!.steps.map((step) => step.instruction_id);

test("official first-night and later-night orders are distinct and grouped information highlights evil players", () => {
  const first = night();
  assert.deepEqual(actionIds(first), ["dusk", "minioninfo", "demoninfo", "poisoner", "chef", "empath", "fortuneteller", "dawn"]);
  assert.deepEqual(actionIds(night(undefined, "night")), ["dusk", "poisoner", "monk", "imp", "ravenkeeper", "empath", "fortuneteller", "dawn"]);
  const info = first.night_checklist!.steps.find((step) => step.instruction_id === "minioninfo")!;
  assert.deepEqual(nightStepSeats(first, script, info), [first.seats[0].id]);
  assert.deepEqual(nightStepSeats(first, script, { ...info, instruction_id: "demoninfo" }), [first.seats[1].id]);
  for (const edition of scripts) {
    assert.equal(edition.night_order!.first_night[0].id, "dusk");
    assert.equal(edition.night_order!.night.at(-1)!.id, "dawn");
    assert.ok(edition.night_order!.night.every((item) => item.reminder.en && item.reminder.zh_hans));
  }
});

test("small games exclude team information, including when travellers bring the total to seven", () => {
  assert.ok(!actionIds(night(["poisoner", "imp", "empath", "monk", "chef"])).includes("demoninfo"));
  assert.ok(!actionIds(night(["poisoner", "imp", "empath", "monk", "chef", "bureaucrat", "thief"])).includes("minioninfo"));
});

test("dead, impaired and duplicate roles retain distinct player steps for explicit storyteller review", () => {
  const game = night(["poisoner", "imp", "empath", "empath", "ravenkeeper"], "night");
  game.seats[4].alive = false;
  game.seats[2].markers.push({ id: "drunk", type: "drunk", label: "Drunk", expires: null, source_role_id: null, note: "" });
  game.night_checklist = createNightChecklist(game, script, "night", 2);
  assert.equal(game.night_checklist.steps.filter((step) => step.instruction_id === "empath").length, 2);
  assert.ok(game.night_checklist.steps.some((step) => step.seat_id === game.seats[4].id));
});

test("choice, information and decisions survive serialization, completion, skips and reopening", () => {
  let game = night();
  const dusk = nextNightStep(game)!;
  game = updateNightStep(game, dusk.id, { choice: "seat 2", information: "1", decision: "Drunk information" });
  game = updateNightStep(game, dusk.id, { status: "completed" });
  const reloaded: GameDraft = JSON.parse(JSON.stringify(game));
  assert.equal(nextNightStep(reloaded)!.instruction_id, "minioninfo");
  assert.equal(reloaded.night_checklist!.steps[0].information, "1");
  game = updateNightStep(reloaded, dusk.id, { status: "pending" });
  assert.equal(nextNightStep(game)!.choice, "seat 2");
  assert.equal(nextNightStep(game)!.decision, "Drunk information");
  const next = game.night_checklist!.steps[1];
  assert.equal(updateNightStep(game, next.id, { status: "skipped" }).night_checklist!.steps[1].status, "pending");
  game = updateNightStep(game, next.id, { status: "skipped", decision: "Not applicable" });
  assert.equal(game.night_checklist!.steps[1].status, "skipped");
});

test("finishing requires steps and expiry review; removing an effect changes the seat in the same snapshot", () => {
  let game = night();
  game.seats[0].markers.push({ id: "poison", type: "poisoned", label: "中毒", expires: "黄昏", source_role_id: "poisoner", note: "from last night" });
  assert.equal(canFinishNight(game), false);
  for (const step of game.night_checklist!.steps) game = updateNightStep(game, step.id, { status: "completed" });
  assert.equal(canFinishNight(game), false);
  assert.equal(finishNight(game), game);
  const key = expiringEffects(game)[0].key;
  game = reviewEffect(game, key, false);
  assert.equal(game.seats[0].markers.length, 1);
  assert.equal(canFinishNight(game), true);
  game.seats[0].markers[0].expires = "黎明";
  assert.equal(canFinishNight(game), false, "edited expiry requires a fresh review");
  assert.equal(reviewEffect(game, key, true), game, "stale effect review cannot delete the changed marker");
  game = reviewEffect(game, expiringEffects(game)[0].key, true);
  assert.equal(game.seats[0].markers.length, 0);
  assert.equal(canFinishNight(game), true);
  const day = finishNight(game);
  assert.equal(day.phase, "day");
  assert.equal(day.night_checklist!.steps[0].status, "completed");
  assert.equal(nextNightStep(day), null);
  day.phase = "night";
  day.day_number = 2;
  day.night_checklist = createNightChecklist(day, script, "night", 2);
  assert.ok(day.night_checklist.steps.every((step) => step.status === "pending"));
  assert.deepEqual(day.night_checklist.reviewed_effects, []);
});

test("reordering and syncing new roles preserve records; custom actions support gained abilities", () => {
  let game = night();
  const empath = game.night_checklist!.steps.find((step) => step.instruction_id === "empath")!;
  game = updateNightStep(game, empath.id, { information: "2", status: "completed" });
  game.seats[5].role_id = "washerwoman";
  const synced = syncNightSteps(game, script);
  assert.equal(synced.night_checklist!.steps.find((step) => step.id === empath.id)!.information, "2");
  assert.ok(actionIds(synced).indexOf("washerwoman") < actionIds(synced).indexOf("chef"));
  assert.deepEqual(syncNightSteps(synced, script), synced);
  assert.equal(actionIds(game).includes("washerwoman"), false);
  const custom = newNightStep("Gained empath ability", game.seats[4].id, "empath");
  game = addNightStep(synced, custom);
  assert.equal(game.night_checklist!.steps.at(-2)!.id, custom.id);
  assert.deepEqual(nightStepSeats(game, script, custom), [game.seats[4].id]);
  const moved = moveNightStep(game, custom.id, -1);
  assert.equal(moved.night_checklist!.steps.at(-3)!.id, custom.id);
  assert.equal(game.night_checklist!.steps.at(-2)!.id, custom.id);
});

test("phase, day and script changes suspend stale checklists without discarding records", () => {
  const original = night();
  for (const patch of [{ phase: "day" as const }, { day_number: 3 }, { script_id: "script-003" }]) {
    const game = { ...original, ...patch };
    assert.equal(isCurrentNight(game), false);
    assert.equal(nextNightStep(game), null);
    assert.equal(canFinishNight(game), false);
    assert.equal(updateNightStep(game, game.night_checklist!.steps[0].id, { status: "completed" }), game);
    assert.equal(syncNightSteps(game, script), game);
  }
});

test("night typing coalesces in the timeline while completion and saved history remain separate", () => {
  const game = night();
  const step = nextNightStep(game)!;
  const meta = (n: number) => ({ id: `event-${n}`, recorded_at: new Date(1700000000000 + n * 100).toISOString() });
  let history = [createEntry(game, "Night", "initial", "", meta(0))];
  const first = updateNightStep(game, step.id, { information: "O" });
  history = recordChange(history, first, scripts, meta(1));
  const second = updateNightStep(first, step.id, { information: "One" });
  history = recordChange(history, second, scripts, meta(2));
  assert.equal(history.length, 2);
  assert.match(history[1].summary, /收到的信息/);
  history = recordChange(history, updateNightStep(second, step.id, { status: "completed" }), scripts, meta(3), 2);
  assert.equal(history.length, 3);
  assert.equal(history[1].snapshot.night_checklist!.steps[0].status, "pending");
  assert.match(history[2].summary, /完成夜间步骤/);
});
