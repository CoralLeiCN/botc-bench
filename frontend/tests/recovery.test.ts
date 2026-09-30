import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { RecoveryStore, MAX_RECOVERY_SLOTS } from "../src/recoveryStore.ts";
import { createDraft } from "../src/game.ts";
import { createEntry } from "../src/timeline.ts";
import type { DraftRecovery, Script } from "../src/types.ts";

const script = { id: "script-002", name: { en: "Trouble Brewing", zh_hans: "暗流涌动" } } as Script;
function draft(): DraftRecovery {
  return { schema_version: 1, saved_at: new Date().toISOString(), record: null,
    timeline: [createEntry(createDraft(script), "Start", "initial")], history: { past: [], future: [] },
    branch_origin: null, dirty: true };
}
async function metadata(name: string): Promise<unknown[]> {
  const database = await new Promise<IDBDatabase>((resolve) => {
    const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result);
  });
  try {
    return await new Promise((resolve) => {
      const request = database.transaction("slots").objectStore("slots").getAll();
      request.onsuccess = () => resolve(request.result);
    });
  } finally { database.close(); }
}

test("IndexedDB restores incomplete edits and undo history after reopening", async () => {
  const name = crypto.randomUUID();
  const store = new RecoveryStore(name);
  const checkpoint = draft();
  checkpoint.timeline[0].snapshot.name = "";
  checkpoint.timeline[0].snapshot.composition.townsfolk = 0;
  checkpoint.history.past = [createDraft(script)];
  await store.write("tab", checkpoint);
  await store.close();
  const reopened = new RecoveryStore(name);
  assert.deepEqual(await reopened.read("tab"), checkpoint);
  await reopened.close();
});

test("large histories append without cloning old snapshots and replace coalesced entries", async () => {
  const store = new RecoveryStore(crypto.randomUUID());
  const checkpoint = draft();
  let reads = 0;
  Object.defineProperty(checkpoint.timeline[0].snapshot, "notes", {
    enumerable: true, get: () => { reads += 1; return "x".repeat(6 * 1024 * 1024); },
  });
  await store.write("tab", checkpoint);
  reads = 0;
  const next = createEntry({ ...createDraft(script), name: "First" }, "Edit");
  const extended = { ...checkpoint, timeline: [...checkpoint.timeline, next] };
  await store.write("tab", extended);
  assert.equal(reads, 0, "appending must not re-clone the large historical snapshot");
  const replacement = { ...next, snapshot: { ...next.snapshot, name: "Completed" } };
  await store.write("tab", { ...extended, timeline: [checkpoint.timeline[0], replacement] });
  const restored = await store.read("tab");
  assert.equal(restored?.timeline.length, 2);
  assert.equal(restored?.timeline[1].snapshot.name, "Completed");
  await store.close();
});

test("quota failure preserves the last checkpoint and a later write can recover", async (context) => {
  const store = new RecoveryStore(crypto.randomUUID());
  const checkpoint = draft();
  await store.write("tab", checkpoint);
  const put = IDBObjectStore.prototype.put;
  const mocked = context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<typeof put>) {
    if (this.name === "snapshots") throw new DOMException("Storage full", "QuotaExceededError");
    return put.apply(this, args);
  });
  const next = { ...checkpoint, timeline: [...checkpoint.timeline, createEntry(createDraft(script), "Next")] };
  await assert.rejects(store.write("tab", next), { name: "QuotaExceededError" });
  assert.deepEqual(await store.read("tab"), checkpoint);
  mocked.mock.restore();
  await store.write("tab", next);
  assert.deepEqual(await store.read("tab"), next);
  await store.close();
});

test("retention evicts inactive saved copies and bounds sequential sessions", async () => {
  const name = crypto.randomUUID();
  const store = new RecoveryStore(name);
  for (let index = 0; index < 30; index += 1) {
    const checkpoint = { ...draft(), dirty: false, record: { id: "saved", version: 1, updatedAt: new Date().toISOString() } };
    await store.write(`tab-${index}`, checkpoint);
    await store.lease(`tab-${index}`, false);
  }
  assert.ok((await metadata(name)).length <= 4);
  await store.close();
});

test("capacity errors preserve unsaved drafts, even after their tab leases expire", async () => {
  const name = crypto.randomUUID();
  const store = new RecoveryStore(name);
  const protectedDraft = draft();
  for (let index = 0; index < MAX_RECOVERY_SLOTS; index += 1) {
    await store.write(`tab-${index}`, protectedDraft);
    await store.lease(`tab-${index}`, false);
  }
  await assert.rejects(store.write("overflow", draft()), /protected drafts/);
  assert.equal((await metadata(name)).length, MAX_RECOVERY_SLOTS);
  assert.deepEqual(await store.read("tab-0"), protectedDraft);
  await store.close();
});

test("live leases protect saved tabs from eviction", async () => {
  const store = new RecoveryStore(crypto.randomUUID());
  const saved = { ...draft(), dirty: false, record: { id: "saved", version: 1, updatedAt: new Date().toISOString() } };
  for (let index = 0; index < MAX_RECOVERY_SLOTS; index += 1) await store.write(`tab-${index}`, saved);
  await assert.rejects(store.write("new-tab", saved), /protected drafts/);
  await store.lease("tab-0", false);
  await store.write("new-tab", saved);
  assert.deepEqual(await store.read("tab-1"), saved);
  await store.close();
});

test("an evicted saved tab can resume with its full history intact", async () => {
  const name = crypto.randomUUID();
  const original = new RecoveryStore(name);
  const checkpoint = { ...draft(), dirty: false, record: { id: "saved", version: 1, updatedAt: new Date().toISOString() } };
  await original.write("old-tab", checkpoint);
  await original.lease("old-tab", false);
  const otherTabs = new RecoveryStore(name);
  for (let index = 0; index < 5; index += 1) {
    await otherTabs.write(`new-${index}`, { ...checkpoint, saved_at: new Date(Date.now() + index + 1).toISOString() });
    await otherTabs.lease(`new-${index}`, false);
  }
  const resumed = { ...checkpoint, dirty: true, timeline: [...checkpoint.timeline, createEntry(createDraft(script), "Resumed")] };
  await original.write("old-tab", resumed);
  assert.deepEqual(await original.read("old-tab"), resumed);
  await original.close(); await otherTabs.close();
});
