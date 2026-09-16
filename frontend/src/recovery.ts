import type { DraftRecovery } from "./types";

const PREFIX = "botc-bench.draft.v1.";
const SESSION_KEY = "botc-bench.draft-session";

/** Each tab writes its own slot; reopening a browser can find the most recent slot. */
export function recoverySlot(storage: Storage, session: Storage): { key: string; raw: string | null } {
  let id = session.getItem(SESSION_KEY);
  if (!id) {
    id = crypto.randomUUID();
    session.setItem(SESSION_KEY, id);
  }
  const key = PREFIX + id;
  const own = storage.getItem(key);
  if (own !== null) return { key, raw: own };
  let latest: { raw: string; time: number } | null = null;
  for (let index = 0; index < storage.length; index += 1) {
    const candidate = storage.key(index);
    if (!candidate?.startsWith(PREFIX)) continue;
    const raw = storage.getItem(candidate);
    if (!raw) continue;
    try {
      const data = JSON.parse(raw) as Partial<DraftRecovery>;
      const time = Date.parse(data.saved_at ?? "");
      if (Number.isFinite(time) && (!latest || time > latest.time)) latest = { raw, time };
    } catch { /* Keep malformed slots intact for manual recovery. */ }
  }
  return { key, raw: latest?.raw ?? null };
}

export function writeRecovery(storage: Storage, key: string, draft: DraftRecovery): void {
  // setItem is atomic: quota failures leave the last successful checkpoint intact.
  storage.setItem(key, JSON.stringify(draft));
}
