import assert from "node:assert/strict";
import test from "node:test";
import { emptyHistory, rememberChange, stepHistory } from "../src/history.ts";
import { createEntry, recordChange } from "../src/timeline.ts";
import { recoverySlot, writeRecovery } from "../src/recovery.ts";
import type { DraftRecovery, GameDraft } from "../src/types.ts";

const game: GameDraft = {
  schema_version: 1, name: "Test", script_id: "script-002", player_count: 5,
  composition: { townsfolk: 3, outsider: 0, minion: 1, demon: 1, traveller: 0, manual: false },
  public_information: "",
  seats: Array.from({ length: 5 }, (_, i) => ({
    id: `seat-${i}`, position: i + 1, player_name: `Player ${i}`, role_id: null,
    shown_role_id: null, shown_alignment: "unknown", public_claim: "", private_information: "",
    alive: true, alignment: "unknown", markers: [], notes: "",
  })), phase: "setup", day_number: 0, notes: "",
};
const meta = (n: number) => ({ id: `event-${n}`, recorded_at: new Date(1700000000000 + n * 100).toISOString() });

test("undo/redo coalesces typing, preserves saved history, and clears redo after a new edit", () => {
  const initial = [createEntry(game, "Start", "initial", "", meta(0))];
  const first = recordChange(initial, { ...game, name: "A" }, [], meta(1));
  let history = rememberChange(emptyHistory(), initial, first);
  const second = recordChange(first, { ...game, name: "AB" }, [], meta(2));
  history = rememberChange(history, first, second);
  assert.equal(history.past.length, 1);
  const afterSave = recordChange(second, { ...game, name: "ABC" }, [], meta(3), second.length);
  history = rememberChange(history, second, afterSave);
  assert.equal(history.past.length, 2);
  const undone = stepHistory(history, afterSave.at(-1)!.snapshot, "undo")!;
  const undoTimeline = [...afterSave, createEntry(undone.snapshot, "Undo")];
  assert.equal(undone.snapshot.name, "AB");
  assert.deepEqual(undoTimeline.slice(0, afterSave.length), afterSave);
  const redone = stepHistory(undone.history, undone.snapshot, "redo")!;
  assert.equal(redone.snapshot.name, "ABC");
  const alternative = recordChange(undoTimeline, { ...undone.snapshot, phase: "day" }, []);
  const nextHistory = rememberChange(undone.history, undoTimeline, alternative);
  assert.equal(nextHistory.future.length, 0);
  assert.equal(stepHistory(nextHistory, alternative.at(-1)!.snapshot, "redo"), null);
});

test("undo supports structural changes and bounds history to 100 steps", () => {
  let timeline = [createEntry(game, "Start", "initial")];
  let history = emptyHistory();
  for (let index = 0; index < 105; index += 1) {
    const before = timeline;
    const next = structuredClone(before.at(-1)!.snapshot);
    next.seats[0].alive = !next.seats[0].alive;
    timeline = recordChange(before, next, []);
    history = rememberChange(history, before, timeline);
  }
  assert.equal(history.past.length, 100);
  const undone = stepHistory(history, timeline.at(-1)!.snapshot, "undo")!;
  assert.equal(undone.snapshot.seats[0].alive, true);
  assert.equal(timeline.at(-1)!.snapshot.seats[0].alive, false);
  assert.equal(rememberChange(history, timeline, timeline), history);
});

class MemoryStorage {
  data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

test("drafts recover incomplete state and undo across reload, with independent tab slots", () => {
  const storage = new MemoryStorage();
  const firstSession = new MemoryStorage();
  const first = recoverySlot(storage, firstSession);
  assert.equal(first.raw, null);
  const draft: DraftRecovery = {
    schema_version: 1, saved_at: new Date().toISOString(), record: null,
    timeline: [createEntry({ ...game, name: "", composition: { ...game.composition, townsfolk: 0 } }, "Incomplete")],
    history: { past: [game], future: [] }, branch_origin: null, dirty: true,
  };
  writeRecovery(storage, first.key, draft);
  assert.deepEqual(JSON.parse(recoverySlot(storage, firstSession).raw!), draft);
  const anotherTab = recoverySlot(storage, new MemoryStorage());
  assert.notEqual(anotherTab.key, first.key);
  assert.deepEqual(JSON.parse(anotherTab.raw!), draft);
  writeRecovery(storage, anotherTab.key, { ...draft, dirty: false });
  assert.equal(JSON.parse(recoverySlot(storage, firstSession).raw!).dirty, true);
});

test("malformed recovery is retained and quota errors do not erase the checkpoint", () => {
  const storage = new MemoryStorage();
  const session = new MemoryStorage();
  const { key } = recoverySlot(storage, session);
  storage.setItem(key, "broken JSON");
  assert.equal(recoverySlot(storage, session).raw, "broken JSON");
  storage.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.throws(() => writeRecovery(storage, key, {} as DraftRecovery), /Quota/);
  assert.equal(storage.getItem(key), "broken JSON");
});
