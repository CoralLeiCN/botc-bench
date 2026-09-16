import assert from "node:assert/strict";
import test from "node:test";
import {
  createEntry, createManualEntry, eventCategories, eventParticipants, phaseLabel, recordChange, timelineChapters,
} from "../src/timeline.ts";
import type { GameDraft, TimelineEntry } from "../src/types.ts";

function game(): GameDraft {
  return {
    schema_version: 1, name: "Test", script_id: "script-002", player_count: 5,
    composition: { townsfolk: 3, outsider: 0, minion: 1, demon: 1, traveller: 0, manual: false },
    seats: Array.from({ length: 5 }, (_, i) => ({
      id: `seat-${i}`, position: i + 1, player_name: `Player ${i}`, role_id: null,
      alive: true, alignment: "unknown", markers: [], notes: "",
    })),
    phase: "setup", day_number: 0, notes: "",
  };
}
const metadata = (n: number) => ({ id: `event-${n}`, recorded_at: new Date(1700000000000 + n * 100).toISOString() });
const start = (): TimelineEntry[] => [createEntry(game(), "开始记录", "initial", "", metadata(0))];

test("replay preserves every discrete action and captures independent snapshots", () => {
  const initial = start();
  const next = structuredClone(initial[0].snapshot);
  next.phase = "first_night";
  let history = recordChange(initial, next, [], metadata(1));
  next.seats[0].alive = false;
  history = recordChange(history, next, [], metadata(2));
  next.seats[0].alive = true;
  assert.equal(history.length, 3);
  assert.equal(history[0].snapshot.phase, "setup");
  assert.equal(history[1].snapshot.seats[0].alive, true);
  assert.equal(history[2].snapshot.seats[0].alive, false);
  assert.match(history[2].summary, /死亡/);
  assert.equal(phaseLabel(history[1].snapshot), "首夜");
});

test("typing coalesces while saved or in-flight events remain immutable", () => {
  let history = start();
  history = recordChange(history, { ...game(), name: "A" }, [], metadata(1));
  const coalesced = recordChange(history, { ...game(), name: "AB" }, [], metadata(2));
  assert.equal(coalesced.length, 2);
  assert.equal(coalesced[1].id, history[1].id);
  assert.equal(coalesced[1].snapshot.name, "AB");
  const duringSave = recordChange(coalesced, { ...game(), name: "ABC" }, [], metadata(3), 2);
  assert.equal(duringSave.length, 3);
  assert.deepEqual(duringSave.slice(0, 2), coalesced);
  const continued = recordChange(duringSave, { ...game(), name: "ABCD" }, [], metadata(4), 2);
  assert.equal(continued.length, 3);
  assert.deepEqual(continued.slice(0, 2), coalesced);
});

test("different text fields and notes create separate moments; no-op changes do not", () => {
  let history = recordChange(start(), { ...game(), name: "Named" }, [], metadata(1));
  const next = { ...game(), name: "Named", notes: "Information delivered" };
  history = recordChange(history, next, [], metadata(2));
  history = [...history, createEntry(next, "说书人记录", "note", "Empath learned 1", metadata(3))];
  const unchanged = recordChange(history, structuredClone(next), [], metadata(4));
  assert.equal(unchanged, history);
  assert.equal(history.length, 4);
  const continued = recordChange(history, { ...next, notes: "New information" }, [], metadata(5));
  assert.equal(continued.length, 5);
  assert.equal(continued[3].note, "Empath learned 1");
});

test("marker expiry edits, removal, and seat movement remain replayable", () => {
  const initial = game();
  initial.seats[0].markers = [{ id: "poison", type: "poisoned", label: "中毒", source_role_id: "poisoner", expires: null, note: "" }];
  let history = [createEntry(initial, "开始记录", "initial", "", metadata(0))];
  const next = structuredClone(initial);
  next.seats[0].markers[0].expires = "黄昏";
  history = recordChange(history, next, [], metadata(1));
  next.seats[0].markers = [];
  history = recordChange(history, next, [], metadata(2));
  [next.seats[0], next.seats[1]] = [next.seats[1], next.seats[0]];
  next.seats.forEach((seat, index) => { seat.position = index + 1; });
  history = recordChange(history, next, [], metadata(3));
  assert.equal(history[1].snapshot.seats[0].markers[0].expires, "黄昏");
  assert.match(history[2].summary, /移除/);
  assert.match(history[3].summary, /座位/);
  assert.equal(history[0].snapshot.seats[0].id, "seat-0");
  assert.equal(history[3].snapshot.seats[0].id, "seat-1");
});

test("phase chapters preserve chronology even when a day is revisited", () => {
  const initial = game();
  const day = { ...initial, phase: "day" as const, day_number: 1 };
  const night = { ...day, phase: "night" as const };
  const snapshots = [initial, day, day, night, day];
  const history = snapshots.map((snapshot, i) => createEntry(snapshot, "Event", "change", "", metadata(i)));
  assert.deepEqual(timelineChapters(history), [
    { id: "event-0", label: "配置中", start: 0, end: 0 },
    { id: "event-1", label: "第 1 天", start: 1, end: 2 },
    { id: "event-3", label: "第 1 夜", start: 3, end: 3 },
    { id: "event-4", label: "第 1 天", start: 4, end: 4 },
  ]);
  assert.deepEqual(timelineChapters([]), []);
});

test("death and role filters compare stable seat IDs, including old untyped records", () => {
  const initial = start()[0];
  const changed = structuredClone(initial.snapshot);
  changed.seats[0].alive = false;
  changed.seats[1].alive = false;
  changed.seats[0].role_id = "imp";
  changed.phase = "night";
  changed.seats.reverse();
  const next = createEntry(changed, "Old update", "change");
  assert.deepEqual(eventCategories(next, initial), ["change", "phase", "death", "role_change"]);
  const revived = structuredClone(changed);
  revived.seats.find((seat) => seat.id === "seat-0")!.alive = true;
  assert.deepEqual(eventCategories(createEntry(revived, "Revived"), next), ["change", "revival"]);
  assert.deepEqual(eventCategories(initial), ["initial"]);
});

test("manual events retain exact information and historical participants independently", () => {
  const snapshot = game();
  const details = { actor_seat_id: null, target_seat_ids: ["seat-0", "seat-1"] };
  const info = createManualEntry(snapshot, "information", "  Learned 1\nKeep this detail  ", details);
  snapshot.seats[0].player_name = "Renamed";
  details.target_seat_ids.pop();
  assert.equal(info.note, "Learned 1\nKeep this detail");
  assert.deepEqual(info.details?.target_seat_ids, ["seat-0", "seat-1"]);
  assert.equal(eventParticipants(info), "说书人 → 1 号 Player 0、2 号 Player 1");
  assert.deepEqual(eventCategories(info), ["information"]);
  const action = createManualEntry(snapshot, "action", "Chose a player", {
    actor_seat_id: "seat-0", target_seat_ids: ["seat-1"],
  });
  assert.equal(eventParticipants(action), "1 号 Renamed → 2 号 Player 1");
  const note = createManualEntry(snapshot, "note", "General note", details);
  assert.equal(note.details, undefined);
  assert.equal(eventParticipants(note), "");
});
