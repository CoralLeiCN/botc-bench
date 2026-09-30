import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiFailure } from "../api";
import { createDraft, compositionTotal } from "../game";
import { readError } from "../errors";
import { translate, uiMessage, type Language, type UiMessage } from "../language";
import type { GameRecord, GameSummary, HarnessStatus, Script } from "../types";
import type { GameDocument } from "./useGameDocument";
import type { DraftRecoveryController } from "./useDraftRecovery";

type Notify = (message: UiMessage | null) => void;
type Operation = "loading" | "archive" | null;

export function useGamePersistence(document: GameDocument, recovery: DraftRecoveryController, language: Language, notify: Notify) {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [savedGames, setSavedGames] = useState<GameSummary[]>([]);
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [operation, setOperation] = useState<Operation>(null);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const documentRef = useRef(document);
  documentRef.current = document;
  const busy = useRef<"saving" | Operation>(null);
  const refreshGames = useCallback(async (): Promise<void> => setSavedGames(await api.games()), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [available, games, status] = await Promise.all([api.scripts(), api.games(), api.harnessStatus()]);
      if (!active) return;
      if (!available.length) throw new Error("No scripts returned by the backend");
      setScripts(available); setSavedGames(games); setHarnessStatus(status);
      try {
        const checkpoint = await recovery.load();
        if (!active) return;
        if (checkpoint) {
          const recovered = await api.validateRecovery(checkpoint);
          const saved = recovered.record && games.some((item) => item.id === recovered.record?.id)
            ? await api.game(recovered.record.id) : null;
          if (!active) return;
          const compatible = saved && saved.version === recovered.record?.version &&
            JSON.stringify(saved.timeline) === JSON.stringify(recovered.timeline.slice(0, saved.timeline.length));
          documentRef.current.restore(recovered, compatible ? saved : null);
          notify(compatible || !recovered.record
            ? uiMessage("已恢复本机草稿及撤销记录，自动保存将继续")
            : uiMessage("原存档已有变化或已删除，草稿已作为独立副本恢复"));
        } else {
          documentRef.current.start(createDraft(available[0], 7, language));
        }
        recovery.enable();
      } catch (error) {
        if (!active) return;
        recovery.fail(error);
        documentRef.current.start(createDraft(available[0], 7, language));
      }
    })().catch((error: unknown) => { if (active) setFatalError(readError(error)); });
    return () => { active = false; };
  }, []);

  const saveGame = useCallback(async (): Promise<GameRecord | null> => {
    const doc = documentRef.current;
    if (!doc.capture().timeline.length || busy.current === "saving" || busy.current === "loading") return null;
    const priorOperation = busy.current;
    busy.current = "saving"; setSaving(true); notify(null);
    const source = doc.saveStarted();
    const game = source.timeline.at(-1)!.snapshot;
    try {
      const saved = source.record
        ? await api.updateGame(source.record.id, { ...game, timeline: source.timeline, expected_version: source.record.version })
        : await api.createGame({ ...game, timeline: source.timeline });
      const isCurrent = doc.saved(saved, source);
      if (!isCurrent && doc.capture().epoch === source.epoch) notify(uiMessage("保存期间产生了新修改：旧快照已保存，当前修改仍待保存"));
      setAutoSaveFailed(false);
      await refreshGames();
      return isCurrent ? saved : null;
    } catch (error) {
      setAutoSaveFailed(true);
      notify(error instanceof ApiFailure && error.status === 409
        ? uiMessage("保存冲突：该存档已被其他页面更新，请重新载入后再保存")
        : uiMessage("保存失败：{0}。自动保存已暂停，请修正后点击保存重试。", [readError(error)]));
      return null;
    } finally { busy.current = priorOperation; setSaving(false); }
  }, [notify, refreshGames]);

  useEffect(() => {
    const game = document.game;
    if (!document.dirty || isSaving || operation || autoSaveFailed || !game || !game.name.trim() ||
      compositionTotal(game.composition) !== game.player_count ||
      game.seats.some((seat) => seat.markers.some((marker) => !marker.label))) return;
    const timer = window.setTimeout(() => { void saveGame(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [document.dirty, document.game, isSaving, operation, autoSaveFailed, saveGame]);

  const loadGame = async (id: string): Promise<void> => {
    if (!id || busy.current) return;
    if (document.dirty && !window.confirm(translate(language, "当前局面还有未保存修改。仍要载入存档吗？"))) return;
    const source = document.capture();
    busy.current = "loading"; setOperation("loading");
    try {
      const loaded = await api.game(id);
      const current = document.capture();
      if (current.epoch !== source.epoch || current.revision !== source.revision) {
        notify(uiMessage("载入期间当前局面已变化，迟到的存档响应未覆盖这些修改"));
        return;
      }
      document.adopt(loaded); setAutoSaveFailed(false);
      notify(uiMessage("已载入「{0}」", [loaded.draft.name]));
    } catch (error) { notify(uiMessage("载入失败：{0}", [readError(error)])); }
    finally { busy.current = null; setOperation(null); }
  };
  const runArchive = async (action: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = "archive"; setOperation("archive");
    try { await action(); }
    finally { busy.current = null; setOperation(null); }
  };
  const adopt = (record: GameRecord): void => { document.adopt(record); setAutoSaveFailed(false); };
  return { scripts, savedGames, harnessStatus, fatalError, isSaving, operation, autoSaveFailed,
    isBusy: () => busy.current !== null, saveGame, loadGame, runArchive, adopt, refreshGames,
    resetFailure: () => setAutoSaveFailed(false) };
}
export type GamePersistence = ReturnType<typeof useGamePersistence>;
