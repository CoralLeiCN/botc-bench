import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import { claimRecoverySlot } from "../src/recovery.ts";
import { RecoveryStore } from "../src/recoveryStore.ts";
import { createDraft } from "../src/game.ts";
import { createEntry } from "../src/timeline.ts";
import type { DraftRecovery, Script } from "../src/types.ts";
import { TestRecoveryLocks } from "./helpers/recoveryLocks.ts";

function checkpoint(notes: string): DraftRecovery {
  const game = createDraft({ id: "script-002", name: { en: "Trouble Brewing" } } as Script);
  game.name = ""; // Incomplete work cannot rely on the SQLite autosave.
  game.notes = notes;
  return { schema_version: 1, saved_at: new Date().toISOString(), record: null,
    timeline: [createEntry(game, "Start", "initial")], history: { past: [], future: [] },
    branch_origin: null, dirty: true };
}

test("tabs with copied session storage restore their source and preserve independent unsaved drafts", async (context) => {
  const first = new JSDOM("", { url: "http://localhost" }).window;
  const second = new JSDOM("", { url: "http://localhost" }).window;
  context.after(() => { first.close(); second.close(); });
  const locks = new TestRecoveryLocks();
  const database = crypto.randomUUID();
  const storeA = new RecoveryStore(database), storeB = new RecoveryStore(database);
  context.after(async () => { await storeA.close(); await storeB.close(); });
  const slotA = await claimRecoverySlot(first.localStorage, first.sessionStorage, locks);
  context.after(slotA.release);
  const draftA = checkpoint("Tab A's unsaved work");
  await storeA.write(slotA.key, draftA);
  for (let i = 0; i < first.sessionStorage.length; i += 1) {
    const key = first.sessionStorage.key(i)!;
    second.sessionStorage.setItem(key, first.sessionStorage.getItem(key)!);
  }
  const slotB = await claimRecoverySlot(first.localStorage, second.sessionStorage, locks);
  context.after(slotB.release);
  assert.notEqual(slotB.key, slotA.key);
  assert.equal(slotB.sourceKey, slotA.key);
  assert.deepEqual(await storeB.read(slotB.sourceKey), draftA);

  const draftB = checkpoint("Tab B's different unsaved work");
  await storeB.write(slotB.key, draftB);
  assert.deepEqual(await storeA.read(slotA.key), draftA);
  assert.deepEqual(await storeB.read(slotB.key), draftB);

  await slotB.release();
  const reloadedB = await claimRecoverySlot(first.localStorage, second.sessionStorage, locks);
  context.after(reloadedB.release);
  assert.equal(reloadedB.key, slotB.key);
  assert.deepEqual(await storeB.read(reloadedB.sourceKey), draftB);
});

test("simultaneous claims cannot share a slot even before either tab writes a checkpoint", async (context) => {
  const first = new JSDOM("", { url: "http://localhost" }).window;
  const second = new JSDOM("", { url: "http://localhost" }).window;
  context.after(() => { first.close(); second.close(); });
  first.sessionStorage.setItem("botc-bench.draft-session", "copied");
  second.sessionStorage.setItem("botc-bench.draft-session", "copied");
  const locks = new TestRecoveryLocks();
  const slots = await Promise.all([
    claimRecoverySlot(first.localStorage, first.sessionStorage, locks),
    claimRecoverySlot(first.localStorage, second.sessionStorage, locks),
  ]);
  for (const slot of slots) context.after(slot.release);
  assert.notEqual(slots[0].key, slots[1].key);
  assert.equal(slots[0].sourceKey, slots[1].sourceKey);
});

test("failed session writes release ownership, and unavailable locks never permit unsafe writes", async (context) => {
  const window = new JSDOM("", { url: "http://localhost" }).window;
  context.after(() => window.close());
  window.sessionStorage.setItem("botc-bench.draft-session", "reload");
  const locks = new TestRecoveryLocks();
  const setItem = context.mock.method(window.Storage.prototype, "setItem", () => {
    throw new Error("Storage disabled");
  });
  await assert.rejects(claimRecoverySlot(window.localStorage, window.sessionStorage, locks), /Storage disabled/);
  setItem.mock.restore();
  const reloaded = await claimRecoverySlot(window.localStorage, window.sessionStorage, locks);
  context.after(reloaded.release);
  assert.equal(reloaded.key, "botc-bench.draft.v1.reload");
  await assert.rejects(claimRecoverySlot(window.localStorage, window.sessionStorage, undefined), /Web Locks/);
});
