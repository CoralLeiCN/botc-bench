import assert from "node:assert/strict";
import test from "node:test";

import { hasSeatData } from "../src/game.ts";
import type { Seat } from "../src/types.ts";

function seat(patch: Partial<Seat> = {}): Seat {
  return {
    id: "seat-5",
    position: 5,
    player_name: "玩家 5",
    role_id: null,
    alive: true,
    dead_vote_available: true,
    alignment: "unknown",
    markers: [],
    notes: "",
    ...patch,
  };
}

test("default untouched seat is empty", () => {
  assert.equal(hasSeatData(seat()), false);
});

test("death and alignment changes count as seat data", () => {
  assert.equal(hasSeatData(seat({ alive: false })), true);
  assert.equal(hasSeatData(seat({ alignment: "evil" })), true);
});
