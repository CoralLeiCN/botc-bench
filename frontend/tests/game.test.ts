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
    shown_role_id: null,
    shown_alignment: "unknown",
    public_claim: "",
    private_information: "",
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

test("knowledge alone counts as seat data when reducing the player count", () => {
  assert.equal(hasSeatData(seat({ shown_role_id: "empath" })), true);
  assert.equal(hasSeatData(seat({ shown_alignment: "good" })), true);
  assert.equal(hasSeatData(seat({ public_claim: "I am Chef" })), true);
  assert.equal(hasSeatData(seat({ private_information: "First night: 0" })), true);
});

test("suggested compositions remain saveable with excess Traveller assignments", async () => {
  const { suggestedComposition, compositionTotal } = await import("../src/game.ts");
  for (let players = 5; players <= 20; players += 1) {
    for (let travellers = 0; travellers <= players; travellers += 1) {
      const composition = suggestedComposition(players, Array(travellers).fill("beggar"), ["beggar"]);
      assert.ok(composition.traveller <= 5);
      assert.equal(compositionTotal(composition), players);
    }
  }
});
