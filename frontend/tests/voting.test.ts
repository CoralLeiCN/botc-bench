import assert from "node:assert/strict";
import test from "node:test";
import { createDraft } from "../src/game.ts";
import { createEntry, recordChange } from "../src/timeline.ts";
import {
  executionStanding, finishNomination, nominationError, recordVote, startNomination,
  votingEditError, voteTotal,
} from "../src/voting.ts";
import type { GameDraft, Script } from "../src/types.ts";

const script = { id: "script-002", name: { en: "Test", zh_hans: null }, travellers: [{ id: "beggar" }] } as Script;
function game(count = 7): GameDraft {
  const draft = createDraft(script, count);
  draft.phase = "day";
  draft.day_number = 1;
  draft.seats.forEach((seat, index) => { seat.id = `seat-${index}`; });
  return draft;
}
function ballot(draft: GameDraft, number: number, yes: number): GameDraft {
  let next = startNomination(draft, `seat-${number}`, `seat-${number}`, script, `nom-${number}`);
  next.seats.forEach((seat, i) => { next = recordVote(next, `nom-${number}`, seat.id, i < yes ? "yes" : "no"); });
  return finishNomination(next, `nom-${number}`);
}

test("threshold, ties, lower tallies, and a later leader", () => {
  let next = ballot(game(), 0, 3);
  assert.equal(executionStanding(next).candidate, null);
  next = ballot(next, 1, 4);
  assert.equal(executionStanding(next).candidate?.id, "seat-1");
  next = ballot(next, 2, 2);
  assert.equal(executionStanding(next).candidate?.id, "seat-1");
  next = ballot(next, 3, 4);
  assert.equal(executionStanding(next).candidate, null);
  assert.equal(executionStanding(next).tied, true);
  next = ballot(next, 4, 5);
  assert.equal(executionStanding(next).candidate?.id, "seat-4");
});

test("threshold uses living players at close, persists after deaths, and ties include earlier subthreshold tallies", () => {
  let next = ballot(game(), 0, 3);
  next.seats[6].alive = false;
  next = ballot(next, 1, 3);
  assert.equal(next.nominations[0].alive_count, 7);
  assert.equal(next.nominations[1].alive_count, 6);
  assert.equal(executionStanding(next).tied, true);
  next.seats[5].alive = false;
  assert.equal(next.nominations[0].alive_count, 7);
});

test("dead vote reservations can be corrected or cancelled; closing spends exactly once across days", () => {
  let next = game();
  next.seats[6].alive = false;
  next = startNomination(next, "seat-0", "seat-0", script, "a");
  next = recordVote(next, "a", "seat-6", "yes");
  assert.equal(next.seats[6].dead_vote_available, true);
  assert.equal(next.nominations[0].votes[6].dead_vote, true);
  next = recordVote(next, "a", "seat-6", "no");
  assert.equal(next.nominations[0].votes[6].dead_vote, false);
  next = recordVote(next, "a", "seat-6", "yes");
  next = finishNomination(next, "a", true);
  assert.equal(next.seats[6].dead_vote_available, true);
  next = startNomination(next, "seat-1", "seat-1", script, "b");
  next.seats.forEach((seat) => { next = recordVote(next, "b", seat.id, "yes"); });
  next = finishNomination(next, "b");
  assert.equal(next.seats[6].dead_vote_available, false);
  assert.equal(finishNomination(next, "b"), next);
  next = { ...next, day_number: 2 };
  assert.equal(executionStanding(next).candidate, null);
  next = startNomination(next, "seat-1", "seat-1", script, "c");
  const attempted = recordVote(next, "c", "seat-6", "yes");
  assert.equal(attempted, next);
  assert.equal(next.nominations.length, 3);
});

test("nominations enforce daily eligibility but allow self and dead nominees", () => {
  let next = game();
  next.seats[6].alive = false;
  assert.match(nominationError(next, "seat-6", "seat-0", script)!, /死亡/);
  assert.equal(nominationError(next, "seat-0", "seat-6", script), null);
  next.seats[5].role_id = "beggar";
  assert.match(nominationError(next, "seat-0", "seat-5", script)!, /旅行者/);
  next = ballot(next, 0, 3);
  assert.match(nominationError(next, "seat-0", "seat-1", script)!, /已经提名/);
  assert.match(nominationError(next, "seat-1", "seat-0", script)!, /已经被提名/);
  assert.match(nominationError({ ...next, phase: "night" }, "seat-1", "seat-1", script)!, /白天/);
});

test("incomplete and closed ballots cannot be finalized or edited accidentally", () => {
  let next = startNomination(game(), "seat-0", "seat-0", script, "a");
  assert.equal(finishNomination(next, "a"), next);
  assert.equal(startNomination(next, "seat-1", "seat-1", script, "b"), next);
  assert.ok(votingEditError(next, { ...next, day_number: 2 }));
  assert.ok(votingEditError(next, { ...next, phase: "night" }));
  next = recordVote(next, "a", "seat-0", "yes", 3);
  assert.equal(voteTotal(next.nominations[0]), 3);
  const death = structuredClone(next);
  death.seats[0].alive = false;
  assert.ok(votingEditError(next, death));
  assert.equal(voteTotal(recordVote(next, "a", "seat-1", "yes", -1).nominations[0]), 2);
  assert.equal(recordVote(next, "a", "seat-0", "yes", -21), next);
  assert.equal(recordVote(next, "a", "seat-0", "yes", 1.5), next);
  next = finishNomination(next, "a", true);
  assert.equal(recordVote(next, "a", "seat-1", "yes"), next);
  assert.equal(executionStanding(next).candidate, null);
});

test("nomination, individual votes, results and balances remain separate replay evidence", () => {
  const initial = game();
  initial.seats[6].alive = false;
  let history = [createEntry(initial, "Start", "initial")];
  let next = startNomination(initial, "seat-0", "seat-1", script, "a");
  history = recordChange(history, next, []);
  for (const seat of next.seats) {
    next = recordVote(next, "a", seat.id, "yes");
    history = recordChange(history, next, []);
  }
  next = finishNomination(next, "a");
  history = recordChange(history, next, []);
  assert.equal(history.length, 10);
  assert.match(history[1].summary, /提名/);
  assert.match(history[8].summary, /亡者票/);
  assert.match(history[9].summary, /待处决/);
  assert.equal(history[8].snapshot.seats[6].dead_vote_available, true);
  assert.equal(history[9].snapshot.seats[6].dead_vote_available, false);
  assert.deepEqual(history[0].snapshot.nominations, []);
  const renamed = structuredClone(next);
  renamed.seats[0].player_name = "Renamed";
  assert.equal(renamed.nominations[0].nominator.player_name, initial.seats[0].player_name);
});
