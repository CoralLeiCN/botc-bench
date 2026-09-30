import type { DraftRecovery, GameDraft, TimelineEntry } from "./types";

export const MAX_RECOVERY_SLOTS = 20;
export const CLEAN_RECOVERY_SLOTS = 3;
export const RECOVERY_LEASE_MS = 120_000;
const STORE_NAMES = ["slots", "events", "snapshots"];

interface StoredSlot extends Omit<DraftRecovery, "timeline" | "history"> {
  key: string;
  lease_until: number;
  revision: string;
  event_count: number;
  snapshot_ids: string[];
  history: { past: string[]; future: string[] };
}
interface StoredEvent extends Omit<TimelineEntry, "snapshot"> {
  slot: string;
  index: number;
  snapshot_id: string;
}
interface StoredSnapshot { slot: string; id: string; snapshot: GameDraft }

function requested<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
function completed(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Recovery transaction aborted"));
    transaction.onerror = () => reject(transaction.error);
  });
}
function slotRange(key: string): IDBKeyRange {
  return IDBKeyRange.bound([key], [key, []]);
}
function deleteSlot(transaction: IDBTransaction, key: string): void {
  transaction.objectStore("slots").delete(key);
  transaction.objectStore("events").delete(slotRange(key));
  transaction.objectStore("snapshots").delete(slotRange(key));
}

/** Never evict unsaved work or a tab holding a live lease. Refuse new slots at capacity. */
function pruneSlots(transaction: IDBTransaction, slots: StoredSlot[], current: string, now: number): void {
  let retained = slots.length + (slots.some((slot) => slot.key === current) ? 0 : 1);
  const inactiveClean = slots.filter((slot) => slot.key !== current && !slot.dirty &&
    slot.record !== null && slot.lease_until <= now).sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  for (const [index, slot] of inactiveClean.entries()) {
    if (inactiveClean.length - index <= CLEAN_RECOVERY_SLOTS && retained <= MAX_RECOVERY_SLOTS) break;
    deleteSlot(transaction, slot.key);
    retained -= 1;
  }
  if (retained > MAX_RECOVERY_SLOTS) {
    throw new Error("Recovery storage has 20 protected drafts. Save existing drafts before opening another tab.");
  }
}

export class RecoveryStore {
  private database: Promise<IDBDatabase> | null = null;
  private queue: Promise<void> = Promise.resolve();
  private snapshotIds = new WeakMap<GameDraft, string>();
  private previous: { key: string; timeline: TimelineEntry[]; revision: string } | null = null;

  private readonly name: string;

  constructor(name = "botc-bench-recovery-v2") { this.name = name; }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open(this.name, 1);
        request.onupgradeneeded = () => {
          const database = request.result;
          database.createObjectStore("slots", { keyPath: "key" });
          database.createObjectStore("events", { keyPath: ["slot", "index"] });
          database.createObjectStore("snapshots", { keyPath: ["slot", "id"] });
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => request.result.close();
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
      });
    }
    return this.database;
  }

  async read(key: string): Promise<DraftRecovery | null> {
    const database = await this.open();
    const transaction = database.transaction(STORE_NAMES, "readonly");
    const done = completed(transaction);
    const slots: StoredSlot[] = await requested(transaction.objectStore("slots").getAll());
    const slot = slots.find((item) => item.key === key) ??
      slots.sort((a, b) => b.saved_at.localeCompare(a.saved_at))[0];
    if (!slot) { await done; return null; }
    const [events, snapshots]: [StoredEvent[], StoredSnapshot[]] = await Promise.all([
      requested(transaction.objectStore("events").getAll(slotRange(slot.key))),
      requested(transaction.objectStore("snapshots").getAll(slotRange(slot.key))),
    ]);
    await done;
    const byId = new Map(snapshots.map((item) => [item.id, item.snapshot]));
    const snapshot = (id: string): GameDraft => {
      const value = byId.get(id);
      if (!value) throw new Error("Recovery snapshot is missing; the checkpoint was preserved.");
      return value;
    };
    if (events.length !== slot.event_count) throw new Error("Recovery timeline is incomplete.");
    return {
      schema_version: slot.schema_version, saved_at: slot.saved_at, record: slot.record,
      branch_origin: slot.branch_origin, dirty: slot.dirty,
      timeline: events.map(({ slot: _slot, index: _index, snapshot_id, ...entry }) =>
        ({ ...entry, snapshot: snapshot(snapshot_id) })),
      history: { past: slot.history.past.map(snapshot), future: slot.history.future.map(snapshot) },
    };
  }

  /** Writes are ordered; a failed checkpoint does not prevent a later retry. */
  write(key: string, draft: DraftRecovery): Promise<void> {
    const write = this.queue.catch(() => undefined).then(() => this.persist(key, draft));
    this.queue = write;
    return write;
  }

  private encode(key: string, draft: DraftRecovery): { slot: StoredSlot; snapshots: Map<string, GameDraft>; events: StoredEvent[] } {
    const snapshots = new Map<string, GameDraft>();
    const snapshotId = (snapshot: GameDraft): string => {
      let id = this.snapshotIds.get(snapshot);
      if (!id) { id = crypto.randomUUID(); this.snapshotIds.set(snapshot, id); }
      snapshots.set(id, snapshot);
      return id;
    };
    const events = draft.timeline.map(({ snapshot, ...entry }, index) =>
      ({ ...entry, slot: key, index, snapshot_id: snapshotId(snapshot) }));
    const history = { past: draft.history.past.map(snapshotId), future: draft.history.future.map(snapshotId) };
    return {
      events, snapshots,
      slot: {
        key, revision: crypto.randomUUID(), schema_version: draft.schema_version, saved_at: draft.saved_at, record: draft.record,
        branch_origin: draft.branch_origin, dirty: draft.dirty, history,
        event_count: events.length, snapshot_ids: [...snapshots.keys()], lease_until: Date.now() + RECOVERY_LEASE_MS,
      },
    };
  }

  private async persist(key: string, draft: DraftRecovery): Promise<void> {
    const database = await this.open();
    const { slot, snapshots, events } = this.encode(key, draft);
    const transaction = database.transaction(STORE_NAMES, "readwrite");
    const done = completed(transaction);
    try {
      const slots: StoredSlot[] = await requested(transaction.objectStore("slots").getAll());
      pruneSlots(transaction, slots, key, Date.now());
      const previousSlot = slots.find((item) => item.key === key);
      const previousIds = new Set(previousSlot?.snapshot_ids ?? []);
      const canAppend = previousSlot && this.previous?.key === key && this.previous.revision === previousSlot.revision;
      for (const [id, snapshot] of snapshots) {
        if (!previousIds.has(id)) transaction.objectStore("snapshots").put({ slot: key, id, snapshot });
      }
      for (const id of previousIds) {
        if (!snapshots.has(id)) transaction.objectStore("snapshots").delete([key, id]);
      }
      for (const event of events) {
        if (!canAppend || this.previous?.timeline[event.index] !== draft.timeline[event.index]) {
          transaction.objectStore("events").put(event);
        }
      }
      transaction.objectStore("events").delete(IDBKeyRange.bound([key, events.length], [key, []]));
      transaction.objectStore("slots").put(slot);
      await done;
      this.previous = { key, timeline: draft.timeline, revision: slot.revision };
    } catch (error) {
      // Roll back metadata and payloads together, including a failed structured clone.
      try { transaction.abort(); } catch { /* The transaction may already have aborted. */ }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async lease(key: string, isActive: boolean): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction("slots", "readwrite");
    const done = completed(transaction);
    const slot: StoredSlot | undefined = await requested(transaction.objectStore("slots").get(key));
    if (slot) transaction.objectStore("slots").put({ ...slot, lease_until: isActive ? Date.now() + RECOVERY_LEASE_MS : 0 });
    await done;
  }

  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    if (this.database) (await this.database).close();
  }
}
