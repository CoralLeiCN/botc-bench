import { useEffect, useRef, useState } from "react";
import { uiMessage, type UiMessage } from "../language";
import { readError } from "../errors";
import { recoverySlot } from "../recovery";
import { RecoveryStore } from "../recoveryStore";
import type { DraftRecovery } from "../types";
import type { GameDocument } from "./useGameDocument";

export function useDraftRecovery(document: GameDocument) {
  const [store] = useState(() => new RecoveryStore());
  const [isReady, setReady] = useState(false);
  const [isPending, setPending] = useState(false);
  const [error, setError] = useState<UiMessage | null>(null);
  const slotRef = useRef<ReturnType<typeof recoverySlot> | null>(null);
  const waiting = useRef<{ slot: NonNullable<typeof slotRef.current>; draft: DraftRecovery } | null>(null);
  const writing = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const renew = (): void => { if (slotRef.current) void store.lease(slotRef.current.key, true).catch(() => undefined); };
    const timer = window.setInterval(renew, 30_000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      // StrictMode immediately remounts effects; only release a genuinely closed view.
      window.setTimeout(() => {
        if (!mounted.current) void (async () => {
          if (slotRef.current) await store.lease(slotRef.current.key, false);
          await store.close();
        })().catch(() => undefined);
      }, 0);
    };
  }, [store]);

  useEffect(() => {
    const slot = slotRef.current;
    if (!isReady || !slot || !document.timeline.length) return;
    const draft: DraftRecovery = {
      schema_version: 1, saved_at: new Date().toISOString(), record: document.record,
      timeline: document.timeline, history: document.history, branch_origin: document.branchOrigin,
      dirty: document.dirty,
    };
    waiting.current = { slot, draft };
    setPending(true);
    const timer = window.setTimeout(() => {
      if (writing.current) return;
      writing.current = true;
      void (async () => {
        // Keep at most one in-flight checkpoint and one replacement. The newest
        // timeline contains all intermediate edits, including coalesced typing.
        while (waiting.current) {
          const checkpoint = waiting.current;
          waiting.current = null;
          try {
            await store.write(checkpoint.slot.key, checkpoint.draft);
            if (checkpoint.slot.legacyKey && checkpoint.slot.raw === window.localStorage.getItem(checkpoint.slot.legacyKey)) {
              window.localStorage.removeItem(checkpoint.slot.legacyKey);
              checkpoint.slot.legacyKey = null;
            }
            setError(null);
          } catch (failure) {
            setError(uiMessage("草稿缓存失败：{0}。请保存局面或导出 JSON 备份。", [readError(failure)]));
          }
        }
      })().finally(() => { writing.current = false; setPending(false); });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isReady, store, document.timeline, document.history, document.record, document.branchOrigin, document.dirty]);

  const load = async (): Promise<DraftRecovery | null> => {
    const slot = slotRef.current ?? recoverySlot(window.localStorage, window.sessionStorage);
    slotRef.current = slot;
    const stored = await store.read(slot.key);
    const legacy: DraftRecovery | null = slot.raw ? JSON.parse(slot.raw) : null;
    if (legacy && (!stored || Date.parse(legacy.saved_at) > Date.parse(stored.saved_at))) return legacy;
    slot.legacyKey = null;
    return stored;
  };
  const fail = (failure: unknown): void => {
    setError(uiMessage("草稿恢复不可用：{0}。原草稿缓存已保留，请先保存到本地存档。", [readError(failure)]));
  };
  return { load, enable: () => setReady(true), fail, error, isPending };
}
export type DraftRecoveryController = ReturnType<typeof useDraftRecovery>;
