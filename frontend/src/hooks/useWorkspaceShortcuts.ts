import { useEffect } from "react";
import type { GameDocument } from "./useGameDocument";
import type { GamePersistence } from "./useGamePersistence";

export function useWorkspaceShortcuts(document: GameDocument, persistence: GamePersistence, recoveryPending: boolean): void {
  useEffect(() => {
    if (!document.dirty && !recoveryPending) return;
    const warn = (event: BeforeUnloadEvent): void => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [document.dirty, recoveryPending]);
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.isComposing) return;
      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        if (!persistence.isBusy()) void persistence.saveGame();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]") || event.altKey) return;
      const direction = key === "z" ? (event.shiftKey ? "redo" : "undo") : key === "y" ? "redo" : null;
      if (direction) {
        event.preventDefault();
        if (persistence.operation === null) document.undoRedo(direction);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [document, persistence]);
}
