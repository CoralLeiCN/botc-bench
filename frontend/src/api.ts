import type {
  GameRecord,
  GameSummary,
  GameWrite,
  HarnessStatus,
  ReasonResponse,
  Script,
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
      const body = (await response.json()) as { detail?: string };
      if (body.detail) message = body.detail;
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
  harnessStatus: () => request<HarnessStatus>("/api/harness/status"),
  reason: (game: GameWrite, question: string, selectedSeatId: string | null) =>
    request<ReasonResponse>("/api/reason", {
      method: "POST",
      body: JSON.stringify({
        game: { ...game, expected_version: undefined },
        question,
        selected_seat_id: selectedSeatId,
      }),
    }),
};
