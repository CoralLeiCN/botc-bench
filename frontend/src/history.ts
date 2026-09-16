import type { GameDraft, TimelineEntry, UndoHistory } from "./types";

export const emptyHistory = (): UndoHistory => ({ past: [], future: [] });

/** Typing merged into one timeline event is also one undo step. */
export function rememberChange(
  history: UndoHistory, before: TimelineEntry[], after: TimelineEntry[],
): UndoHistory {
  if (before === after || !before.length) return history;
  const coalesced = after.length === before.length && history.past.length > 0 &&
    after.at(-1)?.id === before.at(-1)?.id;
  return {
    past: coalesced ? history.past : [...history.past, before[before.length - 1].snapshot].slice(-100),
    future: [],
  };
}

/** Undo is a new snapshot: previously saved timeline entries are never rewritten. */
export function stepHistory(history: UndoHistory, current: GameDraft, direction: "undo" | "redo") {
  const from = direction === "undo" ? history.past : history.future;
  const snapshot = from.at(-1);
  if (!snapshot) return null;
  return {
    snapshot,
    history: direction === "undo"
      ? { past: history.past.slice(0, -1), future: [...history.future, current].slice(-100) }
      : { past: [...history.past, current].slice(-100), future: history.future.slice(0, -1) },
  };
}
