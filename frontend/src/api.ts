import type {
  GameDraft,
  GameRecord,
  GameSummary,
  GameWrite,
  HarnessStatus,
  ReasonResponse,
  Script,
  TimelineEntry,
} from "./types";

export class ApiFailure extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body
      ? { "Content-Type": "application/json", ...init.headers }
      : init?.headers,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) {
        message = body.detail.map((issue: { msg?: string }) => issue.msg ?? "无效数据").join("；");
      }
    } catch {
      // Preserve the HTTP fallback when an upstream error has no JSON body.
    }
    throw new ApiFailure(message, response.status);
  }
  return (await response.json()) as T;
}

export const api = {
  scripts: () => request<Script[]>("/api/scripts"),
  games: () => request<GameSummary[]>("/api/games"),
  game: (id: string) => request<GameRecord>(`/api/games/${encodeURIComponent(id)}`),
  createGame: (game: GameWrite) =>
    request<GameRecord>("/api/games", { method: "POST", body: JSON.stringify(game) }),
  updateGame: (id: string, game: GameWrite) =>
    request<GameRecord>(`/api/games/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(game),
    }),
  branchGame: (id: string, eventId: string, version: number) =>
    request<GameRecord>(`/api/games/${encodeURIComponent(id)}/branch`, {
      method: "POST",
      body: JSON.stringify({ event_id: eventId, expected_version: version }),
    }),
  harnessStatus: () => request<HarnessStatus>("/api/harness/status"),
  reason: (game: GameDraft, question: string, selectedSeatId: string | null, timeline: TimelineEntry[]) =>
    request<ReasonResponse>("/api/reason", {
      method: "POST",
      body: JSON.stringify({
        game,
        question,
        selected_seat_id: selectedSeatId,
        timeline,
      }),
    }),
};
