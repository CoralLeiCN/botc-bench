import { useCallback, useRef, useState } from "react";
import { emptyHistory, rememberChange, stepHistory } from "../history";
import { createEntry, createManualEntry, recordChange } from "../timeline";
import { votingEditError } from "../voting";
import type { BranchOrigin, DraftRecovery, EventAudience, EventDetails, GameDraft, GameRecord, ManualEventKind, RecordState, SavedAnalysis, Script, TimelineEntry, UndoHistory } from "../types";

interface DocumentState {
  timeline: TimelineEntry[];
  history: UndoHistory;
  analyses: SavedAnalysis[];
  record: RecordState | null;
  branchOrigin: BranchOrigin | null;
  dirty: boolean;
  replayIndex: number | null;
  selectedSeatId: string | null;
  selectedRoleId: string | null;
  viewAsSeatId: string | null;
  revision: number;
  epoch: number;
  protectedLength: number;
}
const initialState = (): DocumentState => ({
  timeline: [], history: emptyHistory(), analyses: [], record: null, branchOrigin: null,
  dirty: false, replayIndex: null, selectedSeatId: null, selectedRoleId: null,
  viewAsSeatId: null, revision: 0, epoch: 0, protectedLength: 0,
});
const recordState = (record: GameRecord): RecordState => ({ id: record.id, version: record.version, updatedAt: record.updated_at });

/** Synchronous transitions let async work compare the exact revision it captured. */
export function useGameDocument() {
  const [state, setState] = useState(initialState);
  const current = useRef(state);
  const transition = useCallback((update: (before: DocumentState) => DocumentState): void => {
    current.current = update(current.current);
    setState(current.current);
  }, []);
  const replace = (patch: Partial<DocumentState>): void => transition((before) => ({
    ...initialState(), ...patch, epoch: before.epoch + 1, revision: before.revision + 1,
  }));
  const start = (draft: GameDraft): void => replace({
    timeline: [createEntry(draft, "开始记录", "initial")], selectedSeatId: draft.seats[0].id,
  });
  const adopt = (record: GameRecord): void => replace({
    timeline: record.timeline, analyses: record.analyses, record: recordState(record),
    branchOrigin: record.branch_origin, protectedLength: record.timeline.length,
    selectedSeatId: record.draft.seats[0]?.id ?? null,
  });
  const restore = (draft: DraftRecovery, saved: GameRecord | null): void => replace({
    timeline: draft.timeline, history: draft.history, branchOrigin: draft.branch_origin,
    record: saved ? recordState(saved) : null, analyses: saved?.analyses ?? [],
    protectedLength: saved?.timeline.length ?? 0, dirty: draft.dirty || !saved,
    selectedSeatId: draft.timeline.at(-1)?.snapshot.seats[0]?.id ?? null,
  });
  const edit = (updater: (game: GameDraft) => GameDraft, scripts: Script[]): string | null => {
    const before = current.current;
    const game = before.timeline.at(-1)?.snapshot;
    if (!game || before.replayIndex !== null || before.viewAsSeatId) return null;
    const next = updater(game);
    const error = votingEditError(game, next);
    if (error) return error;
    const timeline = recordChange(before.timeline, next, scripts, undefined, before.protectedLength);
    if (timeline === before.timeline) return null;
    transition(() => ({ ...before, timeline, dirty: true, revision: before.revision + 1,
      history: rememberChange(before.history, before.timeline, timeline) }));
    return null;
  };
  const undoRedo = (direction: "undo" | "redo"): void => transition((before) => {
    const game = before.timeline.at(-1)?.snapshot;
    if (!game || before.replayIndex !== null || before.viewAsSeatId) return before;
    const step = stepHistory(before.history, game, direction);
    if (!step) return before;
    const timeline = [...before.timeline, createEntry(step.snapshot,
      direction === "undo" ? "撤销局面修改" : "重做局面修改", direction)];
    return { ...before, timeline, history: step.history, protectedLength: timeline.length,
      selectedRoleId: null, dirty: true, revision: before.revision + 1 };
  });
  const addEvent = (kind: ManualEventKind, note: string, details: EventDetails, audience: EventAudience): void => transition((before) => {
    const game = before.timeline.at(-1)?.snapshot;
    if (!game || before.replayIndex !== null || before.viewAsSeatId || !note.trim()) return before;
    return { ...before, timeline: [...before.timeline, createManualEntry(game, kind, note, details, audience)],
      dirty: true, revision: before.revision + 1 };
  });
  const saveStarted = (): DocumentState => {
    transition((before) => ({ ...before, protectedLength: before.timeline.length }));
    return current.current;
  };
  const saved = (record: GameRecord, source: DocumentState): boolean => {
    if (current.current.epoch !== source.epoch) return false;
    const isCurrent = current.current.revision === source.revision;
    transition((before) => ({ ...before, record: recordState(record), dirty: !isCurrent,
      // Local snapshots already passed the API schema. Keep their identity for incremental recovery.
      analyses: [...record.analyses, ...before.analyses.filter((item) => !record.analyses.some((saved) => saved.id === item.id))],
    }));
    return isCurrent;
  };
  const addAnalysis = (analysis: SavedAnalysis, epoch: number): void => transition((before) =>
    before.epoch !== epoch || before.analyses.some((item) => item.id === analysis.id) ? before :
      { ...before, analyses: [...before.analyses, analysis] });
  const selectSeat = (id: string | null): void => transition((before) => ({ ...before, selectedSeatId: id }));
  const selectRole = (id: string | null): void => transition((before) => ({ ...before, selectedRoleId: id }));
  const setPerspective = (id: string | null): void => transition((before) => ({ ...before, viewAsSeatId: id, selectedRoleId: null }));
  const seek = (index: number | null): void => transition((before) => {
    const game = before.timeline[index ?? before.timeline.length - 1]?.snapshot;
    return { ...before, replayIndex: index, selectedRoleId: null,
      selectedSeatId: game?.seats.some((seat) => seat.id === before.selectedSeatId)
        ? before.selectedSeatId : game?.seats[0]?.id ?? null };
  });
  const game = state.timeline.at(-1)?.snapshot ?? null;
  return { ...state, game, displayedGame: state.replayIndex === null ? game : state.timeline[state.replayIndex]?.snapshot ?? game,
    capture: () => current.current, start, adopt, restore, edit, undoRedo, addEvent,
    saveStarted, saved, addAnalysis, selectSeat, selectRole, setPerspective, seek };
}
export type GameDocument = ReturnType<typeof useGameDocument>;
