import type { DraftRecovery } from "./types";

const PREFIX = "botc-bench.draft.v1.";
const SESSION_KEY = "botc-bench.draft-session";

export interface RecoveryLocks {
  request(name: string, options: { ifAvailable: true }, callback: (lock: object | null) => Promise<void>): Promise<void>;
}

export interface ClaimedRecoverySlot {
  key: string;
  sourceKey: string;
  raw: string | null;
  legacyKey: string | null;
  release: () => Promise<void>;
}

/** Hold ownership until cleanup or document termination, without an expiring lease. */
function claim(locks: RecoveryLocks, key: string): Promise<ClaimedRecoverySlot["release"] | null> {
  let unlock!: () => void;
  const held = new Promise<void>((resolve) => { unlock = resolve; });
  return new Promise((resolve, reject) => {
    const request = locks.request(key, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(null); return; }
      resolve(async () => { unlock(); await request; });
      await held;
    });
    void request.catch(reject);
  });
}

/** Copied sessionStorage identifies what to restore, but cannot establish ownership. */
export async function claimRecoverySlot(storage: Storage, session: Storage, locks: RecoveryLocks | undefined): Promise<ClaimedRecoverySlot> {
  if (!locks) throw new Error("This browser does not support safe draft recovery (Web Locks).");
  const source = recoverySlot(storage, session);
  let key = source.key;
  let release = await claim(locks, key);
  while (!release) {
    key = PREFIX + crypto.randomUUID();
    release = await claim(locks, key);
  }
  try {
    session.setItem(SESSION_KEY, key.slice(PREFIX.length));
  } catch (error) {
    await release();
    throw error;
  }
  return { ...source, key, sourceKey: source.key, release };
}

/** Locate legacy localStorage drafts for migration; new checkpoints live in IndexedDB. */
export function recoverySlot(storage: Storage, session: Storage): { key: string; raw: string | null; legacyKey: string | null } {
  let id = session.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    session.setItem(SESSION_KEY, id);
  }
  const key = PREFIX + id;
  const own = storage.getItem(key);
  if (own !== null) return { key, raw: own, legacyKey: key };
  let latest: { raw: string; time: number; key: string } | null = null;
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index);
    if (!candidate?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(candidate);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Partial<DraftRecovery>;
      const time = Date.parse(data.saved_at ?? "");
      if (Number.isFinite(time) && (!latest || time > latest.time)) latest = { raw, time, key: candidate };
    } catch { /* Keep malformed slots intact for manual recovery. */ }
  }
  return { key, raw: latest?.raw ?? null, legacyKey: latest?.key ?? null };
}
