import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, ApiFailure } from "./api";
import { CodexPanel } from "./components/CodexPanel";
import { GrimoireBoard } from "./components/GrimoireBoard";
import { Inspector } from "./components/Inspector";
import { NightChecklist } from "./components/NightChecklist";
import { RolePalette } from "./components/RolePalette";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import {
  allRoles,
  compositionTotal,
  createDraft,
  hasSeatData,
  resizeSeats,
  suggestedComposition,
  validateDraft,
} from "./game";
import { nextNightStep, nightStepSeats } from "./night";
import { createEntry, createManualEntry, recordChange } from "./timeline";
import { emptyHistory, rememberChange, stepHistory } from "./history";
import { recoverySlot, writeRecovery } from "./recovery";
import type {
  BranchOrigin,
  Composition,
  EventDetails,
  GameDraft,
  GameRecord,
  GameSummary,
  HarnessStatus,
  ManualEventKind,
  Script,
  Seat,
  TimelineEntry,
  RecordState,
  SavedAnalysis,
} from "./types";

export default function App() {
  const [scripts, setScripts] = useState<Script[]>([]);
  const [savedGames, setSavedGames] = useState<GameSummary[]>([]);
  const [harnessStatus, setHarnessStatus] = useState<HarnessStatus | null>(null);
  const [editor, setEditor] = useState({ timeline: [] as TimelineEntry[], history: emptyHistory() });
  const { timeline, history } = editor;
  const setTimeline = useCallback((next: TimelineEntry[] | ((current: TimelineEntry[]) => TimelineEntry[])) => {
    setEditor((current) => ({ ...current, timeline: typeof next === "function" ? next(current.timeline) : next }));
  }, []);
  const [analyses, setAnalyses] = useState<SavedAnalysis[]>([]);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  const recoveryKeyRef = useRef<string | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const game = timeline[timeline.length - 1]?.snapshot ?? null;
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [branchOrigin, setBranchOrigin] = useState<BranchOrigin | null>(null);
  const [branching, setBranching] = useState(false);
  const [autoSaveFailed, setAutoSaveFailed] = useState(false);
  const protectedTimelineLengthRef = useRef(0);
  const branchingRef = useRef(false);
  const displayedGame = replayIndex === null ? game : timeline[replayIndex]?.snapshot ?? game;
  const replaying = replayIndex !== null;
  const [record, setRecord] = useState<RecordState | null>(null);
  const [selectedSeatId, setSelectedSeatId] = useState<string | null>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [panelTab, setPanelTab] = useState<"night" | "inspector" | "codex">("night");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingGame, setLoadingGame] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [codexBusy, setCodexBusy] = useState(false);
  const [codexAnswer, setCodexAnswer] = useState("");
  const [codexError, setCodexError] = useState<string | null>(null);
  const gameRevisionRef = useRef(0);
  const codexContextEpochRef = useRef(0);
  const documentEpochRef = useRef(0);
  const savingRef = useRef(false);
  const loadingGameRef = useRef(false);

  useEffect(() => {
    let active = true;
    void Promise.all([api.scripts(), api.games(), api.harnessStatus()])
      .then(async ([scriptData, gameData, status]) => {
        if (!active) return;
        if (!scriptData.length) throw new Error("后端没有返回可用剧本");
        setScripts(scriptData);
        setSavedGames(gameData);
        setHarnessStatus(status);
        try {
          const slot = recoverySlot(window.localStorage, window.sessionStorage);
          recoveryKeyRef.current = slot.key;
          if (slot.raw) {
            const recovered = await api.validateRecovery(JSON.parse(slot.raw));
            const saved = recovered.record && gameData.some((item) => item.id === recovered.record?.id)
              ? await api.game(recovered.record.id) : null;
            if (!active) return;
            const compatible = saved && saved.version === recovered.record?.version &&
              JSON.stringify(saved.timeline) === JSON.stringify(recovered.timeline.slice(0, saved.timeline.length));
            setEditor({ timeline: recovered.timeline, history: recovered.history });
            setRecord(compatible ? { id: saved.id, version: saved.version, updatedAt: saved.updated_at } : null);
            protectedTimelineLengthRef.current = compatible ? saved.timeline.length : 0;
            setBranchOrigin(recovered.branch_origin);
            setAnalyses(compatible ? saved.analyses : []);
            setSelectedSeatId(recovered.timeline.at(-1)?.snapshot.seats[0]?.id ?? null);
            setDirty(recovered.dirty || !compatible);
            setAutoSaveFailed(false);
            setNotice(compatible || !recovered.record
              ? "已恢复本机草稿及撤销记录，自动保存将继续"
              : "原存档已有变化或已删除，草稿已作为独立副本恢复");
            setRecoveryReady(true);
            return;
          }
        } catch (error) {
          if (!active) return;
          // Preserve a damaged checkpoint instead of replacing it with an empty game.
          recoveryKeyRef.current = null;
          setRecoveryError(`草稿恢复不可用：${readError(error)}。原草稿缓存已保留，请先保存到本地存档。`);
        }
        if (!active) return;
        const initial = createDraft(scriptData[0]);
        setTimeline([createEntry(initial, "开始记录", "initial")]);
        setSelectedSeatId(initial.seats[0].id);
        setRecoveryReady(true);
      })
      .catch((error: unknown) => {
        if (active) setFatalError(readError(error));
      });
    return () => {
      active = false;
    };
  }, [setTimeline]);

  useLayoutEffect(() => {
    if (!recoveryReady || !timeline.length || !recoveryKeyRef.current) return;
    try {
      writeRecovery(window.localStorage, recoveryKeyRef.current, {
        schema_version: 1, saved_at: new Date().toISOString(), record, timeline, history,
        branch_origin: branchOrigin, dirty,
      });
      setRecoveryError(null);
    } catch (error) {
      setRecoveryError(`草稿缓存失败：${readError(error)}。请保存局面或导出 JSON 备份。`);
    }
  }, [recoveryReady, timeline, history, record, branchOrigin, dirty]);

  const script = useMemo(
    () => scripts.find((item) => item.id === displayedGame?.script_id) ?? null,
    [displayedGame?.script_id, scripts],
  );
  const selectedSeat = useMemo(
    () => displayedGame?.seats.find((seat) => seat.id === selectedSeatId) ?? null,
    [displayedGame?.seats, selectedSeatId],
  );
  const issues = useMemo(
    () => (displayedGame && script ? validateDraft(displayedGame, script) : []),
    [displayedGame, script],
  );

  const invalidateCodexContext = useCallback(() => {
    codexContextEpochRef.current += 1;
    setCodexAnswer("");
    setCodexError(null);
  }, []);

  const updateGame = useCallback(
    (updater: (current: GameDraft) => GameDraft) => {
      if (replaying || branchingRef.current) return;
      gameRevisionRef.current += 1;
      invalidateCodexContext();
      const metadata = { id: crypto.randomUUID(), recorded_at: new Date().toISOString() };
      const protectedLength = protectedTimelineLengthRef.current;
      setEditor((current) => {
        const last = current.timeline.at(-1);
        if (!last) return current;
        const next = recordChange(current.timeline, updater(last.snapshot), scripts, metadata, protectedLength);
        return { timeline: next, history: rememberChange(current.history, current.timeline, next) };
      });
      setDirty(true);
      setNotice(null);
    },
    [invalidateCodexContext, replaying, scripts],
  );

  const refreshSavedGames = useCallback(async () => {
    setSavedGames(await api.games());
  }, []);

  const saveGame = useCallback(async () => {
    if (!game || savingRef.current) return null;
    if (loadingGameRef.current) {
      setNotice("请等待当前存档载入完成后再保存");
      return null;
    }
    const savedRevision = gameRevisionRef.current;
    const savedDocument = documentEpochRef.current;
    protectedTimelineLengthRef.current = timeline.length;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const saved = record
        ? await api.updateGame(record.id, { ...game, timeline, expected_version: record.version })
        : await api.createGame({ ...game, timeline });
      if (documentEpochRef.current !== savedDocument) {
        await refreshSavedGames();
        return null;
      }
      setRecord({ id: saved.id, version: saved.version, updatedAt: saved.updated_at });
      setAnalyses((current) => [...saved.analyses, ...current.filter((item) => !saved.analyses.some((savedItem) => savedItem.id === item.id))]);
      if (gameRevisionRef.current === savedRevision) {
        setTimeline(saved.timeline);
        setDirty(false);
        setNotice(null);
      } else {
        setNotice("保存期间产生了新修改：旧快照已保存，当前修改仍待保存");
      }
      setAutoSaveFailed(false);
      await refreshSavedGames();
      return gameRevisionRef.current === savedRevision ? saved : null;
    } catch (error) {
      setAutoSaveFailed(true);
      const message = readError(error);
      setNotice(
        error instanceof ApiFailure && error.status === 409
          ? "保存冲突：该存档已被其他页面更新，请重新载入后再保存"
          : `保存失败：${message}。自动保存已暂停，请修正后点击保存重试。`,
      );
      return null;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [game, timeline, record, refreshSavedGames, setTimeline]);

  const undoRedo = useCallback((direction: "undo" | "redo") => {
    if (replaying || branchingRef.current || loadingGameRef.current) return;
    const metadata = { id: crypto.randomUUID(), recorded_at: new Date().toISOString() };
    // Prevent the next typed change from merging into an undo/redo event.
    protectedTimelineLengthRef.current = timeline.length + 1;
    setEditor((current) => {
      const snapshot = current.timeline.at(-1)?.snapshot;
      const step = snapshot && stepHistory(current.history, snapshot, direction);
      if (!step) return current;
      return {
        timeline: [...current.timeline, createEntry(step.snapshot, direction === "undo" ? "撤销局面修改" : "重做局面修改", direction, "", metadata)],
        history: step.history,
      };
    });
    gameRevisionRef.current += 1;
    invalidateCodexContext();
    setSelectedRoleId(null);
    setDirty(true);
    setNotice(null);
  }, [invalidateCodexContext, replaying, timeline.length]);

  const adoptRecord = (loaded: GameRecord) => {
    documentEpochRef.current += 1;
    gameRevisionRef.current += 1;
    invalidateCodexContext();
    setEditor({ timeline: loaded.timeline, history: emptyHistory() });
    protectedTimelineLengthRef.current = loaded.timeline.length;
    setAnalyses(loaded.analyses);
    setReplayIndex(null);
    setBranchOrigin(loaded.branch_origin);
    setAutoSaveFailed(false);
    setRecord({ id: loaded.id, version: loaded.version, updatedAt: loaded.updated_at });
    setSelectedSeatId(loaded.draft.seats[0]?.id ?? null);
    setSelectedRoleId(null);
    setDirty(false);
  };

  useEffect(() => {
    if (
      !dirty || saving || loadingGame || branching || autoSaveFailed || !game ||
      !game.name.trim() || compositionTotal(game.composition) !== game.player_count ||
      game.seats.some((seat) => seat.markers.some((marker) => !marker.label))
    ) return;
    const timer = window.setTimeout(() => { void saveGame(); }, 1500);
    return () => window.clearTimeout(timer);
  }, [dirty, saving, loadingGame, branching, autoSaveFailed, game, saveGame]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!branchingRef.current && !loadingGameRef.current) void saveGame();
        return;
      }
      const target = event.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable=true]");
      if (typing || event.isComposing || !(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const direction = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
      if (direction) {
        event.preventDefault();
        if (history[direction === "undo" ? "past" : "future"].length) undoRedo(direction);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [saveGame, undoRedo, history]);

  const changeScript = (scriptId: string) => {
    if (!game || scriptId === game.script_id) return;
    const nextScript = scripts.find((item) => item.id === scriptId);
    if (!nextScript) return;
    const allowed = new Set(allRoles(nextScript).map((role) => role.id));
    const affected = game.seats.filter((seat) => seat.role_id && !allowed.has(seat.role_id));
    const affectedMarkers = game.seats.flatMap((seat) =>
      seat.markers.filter((item) => item.source_role_id && !allowed.has(item.source_role_id)),
    );
    if (
      (affected.length > 0 || affectedMarkers.length > 0) &&
      !window.confirm(
        `切换剧本会清除 ${affected.length} 个不兼容角色和 ${affectedMarkers.length} 个角色专属标记；玩家名、座次及通用标记会保留。继续吗？`,
      )
    ) {
      return;
    }
    updateGame((current) => {
      const seats = current.seats.map((seat) => ({
        ...seat,
        role_id: seat.role_id && allowed.has(seat.role_id) ? seat.role_id : null,
        markers: seat.markers.filter(
          (item) => !item.source_role_id || allowed.has(item.source_role_id),
        ),
      }));
      return {
        ...current,
        script_id: scriptId,
        composition: suggestedComposition(
          current.player_count,
          seats.map((seat) => seat.role_id),
          nextScript.travellers.map((role) => role.id),
        ),
        seats,
      };
    });
    setSelectedRoleId(null);
    setCodexAnswer("");
  };

  const changePlayerCount = (nextCount: number) => {
    if (!game || !Number.isFinite(nextCount)) return;
    const bounded = Math.max(5, Math.min(20, Math.round(nextCount)));
    if (bounded === game.player_count) return;
    if (
      bounded < game.player_count &&
      game.seats.slice(bounded).some(hasSeatData) &&
      !window.confirm(`减少玩家会移除末尾 ${game.player_count - bounded} 个已有数据的座位。继续吗？`)
    ) {
      return;
    }
    updateGame((current) => {
      const seats = resizeSeats(current.seats, bounded);
      return {
        ...current,
        player_count: bounded,
        seats,
        composition: suggestedComposition(
          bounded,
          seats.map((seat) => seat.role_id),
          script?.travellers.map((role) => role.id) ?? [],
        ),
      };
    });
    setSelectedSeatId((current) =>
      current && game.seats.slice(0, bounded).some((seat) => seat.id === current)
        ? current
        : game.seats[0]?.id ?? null,
    );
  };

  const chooseSeat = (seatId: string) => {
    if (seatId !== selectedSeatId) invalidateCodexContext();
    setSelectedSeatId(seatId);
    setPanelTab("inspector");
    if (replaying || branchingRef.current || !selectedRoleId || !script) return;
    const selectedRole = allRoles(script).find((role) => role.id === selectedRoleId);
    updateGame((current) => {
      const seats = current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              role_id: selectedRoleId,
              alignment:
                seat.alignment === "unknown" && selectedRole?.team !== "traveller"
                  ? selectedRole?.team === "minion" || selectedRole?.team === "demon"
                    ? "evil"
                    : "good"
                  : seat.alignment,
            }
          : seat,
      );
      return {
        ...current,
        seats,
        composition: current.composition.manual
          ? current.composition
          : suggestedComposition(
              current.player_count,
              seats.map((seat) => seat.role_id),
              script?.travellers.map((role) => role.id) ?? [],
            ),
      };
    });
    setSelectedRoleId(null);
  };

  const changeSeat = (nextSeat: Seat) => {
    updateGame((current) => {
      const seats = current.seats.map((seat) => (seat.id === nextSeat.id ? nextSeat : seat));
      return {
        ...current,
        seats,
        composition: current.composition.manual
          ? current.composition
          : suggestedComposition(
              current.player_count,
              seats.map((seat) => seat.role_id),
              script?.travellers.map((role) => role.id) ?? [],
            ),
      };
    });
  };

  const moveSeat = (direction: -1 | 1) => {
    if (!game || !selectedSeatId) return;
    const index = game.seats.findIndex((seat) => seat.id === selectedSeatId);
    if (index < 0) return;
    const target = (index + direction + game.seats.length) % game.seats.length;
    updateGame((current) => {
      const seats = [...current.seats];
      [seats[index], seats[target]] = [seats[target], seats[index]];
      return {
        ...current,
        seats: seats.map((seat, seatIndex) => ({ ...seat, position: seatIndex + 1 })),
      };
    });
  };

  const newGame = () => {
    if (!script || branchingRef.current) return;
    if (loadingGameRef.current) {
      setNotice("请等待当前存档载入完成后再新建局面");
      return;
    }
    if (savingRef.current) {
      setNotice("请等待当前保存完成后再新建局面");
      return;
    }
    if (dirty && !window.confirm("当前局面还有未保存修改。仍要新建吗？")) return;
    const draft = createDraft(script, game?.player_count ?? 7);
    documentEpochRef.current += 1;
    gameRevisionRef.current += 1;
    invalidateCodexContext();
    setEditor({ timeline: [createEntry(draft, "开始记录", "initial")], history: emptyHistory() });
    setAnalyses([]);
    protectedTimelineLengthRef.current = 0;
    setReplayIndex(null);
    setBranchOrigin(null);
    setAutoSaveFailed(false);
    setRecord(null);
    setSelectedSeatId(draft.seats[0].id);
    setSelectedRoleId(null);
    setDirty(false);
    setNotice(null);
    setCodexAnswer("");
  };

  const loadGame = async (id: string) => {
    if (!id || branchingRef.current) return;
    if (loadingGameRef.current) {
      setNotice("已有存档正在载入，请稍候");
      return;
    }
    if (savingRef.current) {
      setNotice("请等待当前保存完成后再载入其他存档");
      return;
    }
    if (dirty && !window.confirm("当前局面还有未保存修改。仍要载入存档吗？")) return;
    const requestedDocument = documentEpochRef.current;
    const requestedRevision = gameRevisionRef.current;
    loadingGameRef.current = true;
    setLoadingGame(true);
    try {
      const loaded: GameRecord = await api.game(id);
      if (
        documentEpochRef.current !== requestedDocument ||
        gameRevisionRef.current !== requestedRevision
      ) {
        setNotice("载入期间当前局面已变化，迟到的存档响应未覆盖这些修改");
        return;
      }
      adoptRecord(loaded);
      setNotice(`已载入「${loaded.draft.name}」`);
      setCodexAnswer("");
    } catch (error) {
      setNotice(`载入失败：${readError(error)}`);
    } finally {
      loadingGameRef.current = false;
      setLoadingGame(false);
    }
  };

  const askCodex = async (question: string) => {
    if (!displayedGame || codexBusy || savingRef.current || loadingGameRef.current || branchingRef.current) return;
    const requestDocument = documentEpochRef.current;
    const requestContext = codexContextEpochRef.current;
    const eventId = timeline[replayIndex ?? timeline.length - 1].id;
    const seatId = selectedSeatId;
    setCodexBusy(true);
    setCodexError(null);
    setCodexAnswer("");
    try {
      const source = dirty || !record ? await saveGame() : record;
      if (!source) {
        setCodexError("请先完成配置并保存局面，再运行分析。");
        return;
      }
      const result = await api.analyseGame(source.id, eventId, question, seatId);
      if (documentEpochRef.current === requestDocument) {
        setAnalyses((current) => current.some((item) => item.id === result.id) ? current : [...current, result]);
        if (codexContextEpochRef.current === requestContext) setCodexAnswer(result.answer);
        else setCodexError("分析已保存到原始局面快照，可在下方历史分析中查看。");
      } else {
        setNotice("分析已保存到原存档；载入原存档即可查看。");
      }
    } catch (error) {
      if (documentEpochRef.current === requestDocument) setCodexError(readError(error));
    } finally {
      setCodexBusy(false);
    }
  };

  const seek = (index: number | null) => {
    invalidateCodexContext();
    setSelectedRoleId(null);
    setReplayIndex(index);
  };

  const addEvent = (kind: ManualEventKind, note: string, details: EventDetails) => {
    if (!game || replaying || branchingRef.current || !note.trim()) return;
    gameRevisionRef.current += 1;
    const entry = createManualEntry(game, kind, note, details);
    setTimeline((current) => [...current, entry]);
    setDirty(true);
    setNotice(null);
  };

  const branchFromReplay = async () => {
    if (
      replayIndex === null || !timeline[replayIndex] || branchingRef.current || savingRef.current
    ) return;
    const eventId = timeline[replayIndex].id;
    branchingRef.current = true;
    setBranching(true);
    try {
      const source = dirty || !record ? await saveGame() : record;
      if (!source) return;
      const branched = await api.branchGame(source.id, eventId, source.version);
      adoptRecord(branched);
      setNotice("已创建并保存分支，可以从这个时刻继续编辑");
      await refreshSavedGames();
    } catch (error) {
      setNotice(`创建分支失败：${readError(error)}`);
    } finally {
      branchingRef.current = false;
      setBranching(false);
    }
  };

  const duplicateGame = async () => {
    if (!record || branchingRef.current || savingRef.current || loadingGameRef.current) return;
    branchingRef.current = true;
    setBranching(true);
    try {
      const source = dirty ? await saveGame() : record;
      if (!source) return;
      adoptRecord(await api.duplicateGame(source.id, source.version));
      setNotice("已创建独立副本，原局面与分析仍保留");
      await refreshSavedGames();
    } catch (error) {
      setNotice(`复制失败：${readError(error)}`);
    } finally { branchingRef.current = false; setBranching(false); }
  };

  const exportGame = async () => {
    if (branchingRef.current || savingRef.current || loadingGameRef.current) return;
    branchingRef.current = true;
    setBranching(true);
    try {
      const source = dirty || !record ? await saveGame() : record;
      if (!source) return;
      const archive = await api.exportGame(source.id);
      downloadJson(archive, `${archive.game.draft.name.replace(/[\\/:*?"<>|]/g, "_") || "game"}.json`);
      setNotice("已导出完整存档：当前局面、时间线和已保存分析");
    } catch (error) {
      setNotice(`导出失败：${readError(error)}`);
    } finally { branchingRef.current = false; setBranching(false); }
  };

  const importGame = async (file: File) => {
    if (branchingRef.current || savingRef.current || loadingGameRef.current) return;
    if (dirty && !window.confirm("当前局面还有未保存修改。仍要导入并载入新存档吗？")) return;
    branchingRef.current = true;
    setBranching(true);
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("文件超过 50 MB，请使用较小的单局备份");
      const archive: unknown = JSON.parse(await file.text());
      const imported = await api.importGame(archive);
      adoptRecord(imported);
      setNotice(`已导入「${imported.draft.name}」为独立存档`);
      await refreshSavedGames();
    } catch (error) {
      setNotice(`导入失败：${readError(error)}`);
    } finally { branchingRef.current = false; setBranching(false); }
  };

  if (fatalError) {
    return (
      <div className="fatal-screen">
        <AlertTriangle size={30} />
        <h1>无法连接本地工作区</h1>
        <p>{fatalError}</p>
        <code>uv run uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000</code>
      </div>
    );
  }

  if (!game || !displayedGame || !script) {
    return (
      <div className="loading-screen">
        <LoaderCircle size={24} className="spin" />
        正在打开魔典…
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Toolbar
        readOnly={replaying || branching}
        scripts={scripts}
        game={displayedGame}
        script={script}
        savedGames={savedGames}
        currentGameId={record?.id ?? null}
        dirty={dirty}
        saving={saving}
        loadingGame={loadingGame || branching}
        lastSavedAt={record?.updatedAt ?? null}
        onNameChange={(name) => updateGame((current) => ({ ...current, name }))}
        onScriptChange={changeScript}
        onPlayerCountChange={changePlayerCount}
        onLoadGame={(id) => void loadGame(id)}
        onNewGame={newGame}
        onSave={() => void saveGame()}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        onUndo={() => undoRedo("undo")}
        onRedo={() => undoRedo("redo")}
        onDuplicate={() => void duplicateGame()}
        onExport={() => void exportGame()}
        onImport={(file) => void importGame(file)}
      />

      {recoveryError && <div className="recovery-warning" role="alert">{recoveryError}</div>}
      {notice && (
        <div className={`notice-bar ${notice.includes("失败") || notice.includes("冲突") ? "error" : ""}`}>
          {notice}
          <button type="button" onClick={() => setNotice(null)} aria-label="关闭通知">
            <X size={13} />
          </button>
        </div>
      )}

      <div className="workspace-grid">
        <fieldset className="workspace-controls" disabled={replaying || branching}>
          <RolePalette
            script={script}
            game={displayedGame}
            selectedRoleId={selectedRoleId}
            onSelectRole={setSelectedRoleId}
            onCompositionChange={(composition: Composition) =>
              updateGame((current) => ({ ...current, composition }))
            }
            onResetComposition={() =>
              updateGame((current) => ({
                ...current,
                composition: suggestedComposition(
                  current.player_count,
                  current.seats.map((seat) => seat.role_id),
                  script.travellers.map((role) => role.id),
                ),
              }))
            }
          />
        </fieldset>
        <GrimoireBoard
          game={displayedGame}
          script={script}
          selectedSeatId={selectedSeatId}
          selectedRoleId={replaying ? null : selectedRoleId}
          replaying={replaying}
          nextNightSeatIds={nightStepSeats(displayedGame, script, nextNightStep(displayedGame))}
          issues={issues}
          onSeatClick={chooseSeat}
        />

        <aside className="right-panel panel-shell">
          <nav className="right-panel-tabs" aria-label="说书人工具">
            {([["night", "今晚清单"], ["inspector", "玩家检查器"], ["codex", "Codex 辅助"]] as const).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                aria-pressed={panelTab === tab}
                className={panelTab === tab ? "active" : ""}
                onClick={() => setPanelTab(tab)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="right-panel-content" hidden={panelTab !== "night"}>
            <NightChecklist
              key={`${documentEpochRef.current}-${displayedGame.night_checklist?.id ?? "new"}`}
              game={displayedGame}
              script={script}
              readOnly={replaying || branching}
              onUpdate={updateGame}
              onFocusSeat={(id) => {
                setSelectedRoleId(null);
                setSelectedSeatId(id);
                invalidateCodexContext();
              }}
            />
          </div>
          <div className="right-panel-content" hidden={panelTab !== "inspector"}>
            <Inspector
              readOnly={replaying || branching}
              game={displayedGame}
              script={script}
              seat={selectedSeat}
              onSeatChange={changeSeat}
              onMoveSeat={moveSeat}
              onGameMetaChange={(patch) =>
                updateGame((current) => ({ ...current, ...patch }))
              }
            />
          </div>
          <div className="right-panel-content" hidden={panelTab !== "codex"}>
            <CodexPanel
              script={script}
              selectedSeat={selectedSeat}
              status={harnessStatus}
              answer={codexAnswer}
              busy={codexBusy}
            disabled={saving || loadingGame || branching}
            analyses={analyses}
            currentEventId={timeline[replayIndex ?? timeline.length - 1]?.id ?? null}
            onViewSnapshot={(analysis) => {
              const index = timeline.findIndex((entry) => entry.id === analysis.event_id);
              if (index >= 0) { seek(index); setSelectedSeatId(analysis.selected_seat_id); }
            }}
              error={codexError}
              onAsk={askCodex}
              onOpenNight={() => setPanelTab("night")}
            />
          </div>
        </aside>
      </div>
      <Timeline
        key={documentEpochRef.current}
        entries={timeline}
        replayIndex={replayIndex}
        branchOrigin={branchOrigin}
        busy={saving || loadingGame || branching}
        dirty={dirty || !record}
        saveFailed={autoSaveFailed}
        onSeek={seek}
        onAddEvent={addEvent}
        onBranch={() => void branchFromReplay()}
      />
    </div>
  );
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "未知错误";
}

function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
