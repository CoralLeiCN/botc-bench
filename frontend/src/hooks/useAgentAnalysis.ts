import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { readError } from "../errors";
import { uiMessage, type UiMessage } from "../language";
import type { ReasonPreview, ReasonRequest } from "../types";
import type { GameDocument } from "./useGameDocument";
import type { GamePersistence } from "./useGamePersistence";

function useReasonPreview(request: ReasonRequest | null) {
  const [revision, setRevision] = useState(0);
  const [record, setRecord] = useState<{ request: ReasonRequest; result: ReasonPreview; revision: number } | null>(null);
  const [failure, setFailure] = useState<{ request: ReasonRequest; message: string } | null>(null);
  useEffect(() => {
    if (!request) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void api.previewReason(request, controller.signal).then((result) => {
        if (!controller.signal.aborted) { setRecord({ request, result, revision }); setFailure(null); }
      }).catch((error: unknown) => {
        if (!controller.signal.aborted) setFailure({ request, message: readError(error) });
      });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [request, revision]);
  const preview = record?.request === request && record.revision === revision ? record.result : null;
  const playerView = record?.request.game === request?.game &&
    record?.request.timeline?.at(-1)?.id === request?.timeline?.at(-1)?.id &&
    record?.request.perspective === "player" && record.request.selected_seat_id === request?.selected_seat_id
    ? record.result.player_view : null;
  return { preview, playerView, previewError: failure?.request === request ? failure?.message ?? null : null,
    refreshPreview: () => { setRevision((value) => value + 1); setFailure(null); } };
}

export function useAgentAnalysis(document: GameDocument, persistence: GamePersistence, notify: (notice: UiMessage | null) => void) {
  const [question, setQuestion] = useState("");
  const [isBusy, setBusy] = useState(false);
  const running = useRef(false);
  const [response, setResponse] = useState<{ request: ReasonRequest; answer?: string; error?: string } | null>(null);
  useEffect(() => { setQuestion(""); }, [document.viewAsSeatId, document.epoch]);
  const request = useMemo<ReasonRequest | null>(() => document.displayedGame ? {
    game: document.displayedGame, question: question.trim(),
    selected_seat_id: document.viewAsSeatId ?? document.selectedSeatId,
    perspective: document.viewAsSeatId ? "player" : "storyteller",
    timeline: document.timeline.slice(0, document.replayIndex === null ? document.timeline.length : document.replayIndex + 1),
  } : null, [document.displayedGame, document.selectedSeatId, document.viewAsSeatId, document.timeline, document.replayIndex, question]);
  const previewState = useReasonPreview(request);
  const ask = async (): Promise<void> => {
    if (!request || !request.question || !previewState.preview || running.current || persistence.isBusy()) return;
    const context = document.capture();
    const eventId = context.timeline[context.replayIndex ?? context.timeline.length - 1].id;
    running.current = true; setBusy(true); setResponse(null);
    try {
      const source = context.dirty || !context.record ? await persistence.saveGame() : context.record;
      if (!source) {
        setResponse({ request, error: "请先完成配置并保存局面，再运行分析。" });
        return;
      }
      const analysis = await api.analyseGame(source.id, eventId, request, previewState.preview.prompt_sha256);
      document.addAnalysis(analysis, context.epoch);
      if (document.capture().epoch === context.epoch) setResponse({ request, answer: analysis.answer });
      else notify(uiMessage("分析已保存到原存档；载入原存档即可查看。"));
    } catch (error) { setResponse({ request, error: readError(error) }); }
    finally { running.current = false; setBusy(false); }
  };
  return { ...previewState, question, setQuestion, isBusy, ask,
    answer: response?.request === request ? response.answer ?? "" : "",
    error: response?.request === request ? response.error ?? null : null };
}
