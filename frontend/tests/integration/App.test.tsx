import { StrictMode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { LanguageProvider } from "../../src/LanguageProvider";
import { api, ApiFailure } from "../../src/api";
import { createDraft } from "../../src/game";
import { createEntry } from "../../src/timeline";
import { RecoveryStore } from "../../src/recoveryStore";
import type { DraftRecovery, GameRecord, GameWrite, SavedAnalysis, Script } from "../../src/types";
import catalog from "../../../backend/app/data/official_scripts.json";

const scripts = catalog.scripts as Script[];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
function saved(payload: GameWrite, id = "game-1", version = 1): GameRecord {
  const { timeline, expected_version: _expected, ...draft } = payload;
  return { id, version, created_at: "2026-09-30T00:00:00Z", updated_at: "2026-09-30T00:00:00Z",
    draft, timeline: timeline ?? [createEntry(draft, "Start", "initial")], branch_origin: null, analyses: [] };
}
function mount() {
  return render(<StrictMode><LanguageProvider><App /></LanguageProvider></StrictMode>);
}
async function nameInput(): Promise<HTMLInputElement> {
  return screen.findByRole("textbox", { name: "局面" }) as Promise<HTMLInputElement>;
}
function clickSave(): void { fireEvent.click(screen.getByRole("button", { name: "保存局面" })); }

beforeEach(() => {
  vi.spyOn(api, "scripts").mockResolvedValue(scripts);
  vi.spyOn(api, "games").mockResolvedValue([]);
  vi.spyOn(api, "harnessStatus").mockResolvedValue({ enabled: true, available: true, mode: "read-only", detail: "Ready" });
  vi.spyOn(api, "validateRecovery").mockImplementation(async (checkpoint) => checkpoint as DraftRecovery);
  vi.spyOn(api, "previewReason").mockImplementation(async (request) => ({
    prompt: request.question, prompt_sha256: "a".repeat(64), player_view: null, template_id: null,
  }));
  vi.spyOn(api, "createGame").mockImplementation(async (payload) => {
    if (payload.timeline?.some((entry) => entry.snapshot.composition.traveller > 5)) {
      throw new ApiFailure("Traveller count exceeds five", 422);
    }
    return saved(payload);
  });
  vi.spyOn(api, "updateGame").mockImplementation(async (id, payload) => saved(payload, id, (payload.expected_version ?? 0) + 1));
});

describe("workspace persistence", () => {
  it("keeps edits made during a save and uses the returned version for the next save", async () => {
    const response = deferred<GameRecord>();
    vi.mocked(api.createGame).mockReturnValue(response.promise);
    mount();
    const input = await nameInput();
    fireEvent.change(input, { target: { value: "Sent revision" } });
    clickSave();
    await waitFor(() => expect(api.createGame).toHaveBeenCalledTimes(1));
    const sent = vi.mocked(api.createGame).mock.calls[0][0];
    fireEvent.change(input, { target: { value: "Edited during save" } });
    await act(async () => { response.resolve(saved(sent)); await response.promise; });
    expect(input.value).toBe("Edited during save");
    clickSave();
    await waitFor(() => expect(api.updateGame).toHaveBeenCalledTimes(1));
    const next = vi.mocked(api.updateGame).mock.calls[0][1];
    expect(next.name).toBe("Edited during save");
    expect(next.expected_version).toBe(1);
    expect(next.timeline?.slice(0, sent.timeline?.length)).toEqual(sent.timeline);
  });

  it("does not overwrite local edits with a delayed load response", async () => {
    const incoming = saved(createDraft(scripts[0]), "other");
    vi.mocked(api.games).mockResolvedValue([{ id: incoming.id, version: 1, name: "Other game",
      script_id: incoming.draft.script_id, player_count: 7, updated_at: incoming.updated_at }]);
    const response = deferred<GameRecord>();
    vi.spyOn(api, "game").mockReturnValue(response.promise);
    mount();
    const input = await nameInput();
    fireEvent.change(screen.getByTitle("载入本地存档").querySelector("select")!, { target: { value: "other" } });
    fireEvent.change(input, { target: { value: "Keep this edit" } });
    await act(async () => { response.resolve(incoming); await response.promise; });
    expect(input.value).toBe("Keep this edit");
    expect(screen.getByText("载入期间当前局面已变化，迟到的存档响应未覆盖这些修改")).toBeTruthy();
  });

  it("restores incomplete edits and undo from IndexedDB after remount", async () => {
    const view = mount();
    const input = await nameInput();
    const originalName = input.value;
    fireEvent.change(input, { target: { value: "" } });
    const key = `botc-bench.draft.v1.${sessionStorage.getItem("botc-bench.draft-session")}`;
    const storage = new RecoveryStore();
    await waitFor(async () => expect((await storage.read(key))?.timeline.at(-1)?.snapshot.name).toBe(""));
    view.unmount();
    mount();
    expect((await nameInput()).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "撤销局面修改" }));
    expect((await nameInput()).value).toBe(originalName);
    await storage.close();
  });

  it("preserves a legacy checkpoint on write failure and removes it only after successful migration", async () => {
    const legacyKey = "botc-bench.draft.v1.legacy";
    const draft = createDraft(scripts[0]); draft.name = "";
    const checkpoint: DraftRecovery = { schema_version: 1, saved_at: new Date().toISOString(), record: null,
      timeline: [createEntry(draft, "Legacy")], history: { past: [], future: [] }, branch_origin: null, dirty: true };
    localStorage.setItem(legacyKey, JSON.stringify(checkpoint));
    sessionStorage.setItem("botc-bench.draft-session", "legacy");
    const write = vi.spyOn(RecoveryStore.prototype, "write").mockRejectedValue(new DOMException("Storage full", "QuotaExceededError"));
    mount();
    const input = await nameInput();
    await screen.findByRole("alert");
    expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(checkpoint));
    write.mockRestore();
    fireEvent.change(input, { target: { value: "Recovered" } });
    await waitFor(() => expect(localStorage.getItem(legacyKey)).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("saves correction and undo after assigning a sixth Traveller", async () => {
    mount();
    await nameInput();
    for (let count = 7; count < 11; count += 1) fireEvent.click(screen.getByRole("button", { name: "增加玩家" }));
    fireEvent.click(screen.getByRole("button", { name: "玩家检查器" }));
    for (let index = 0; index < 6; index += 1) {
      fireEvent.change(screen.getByRole("combobox", { name: "真实角色" }), { target: { value: scripts[0].travellers[0].id } });
      if (index < 5) {
        fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${index + 2} 号`) }));
      }
    }
    fireEvent.change(screen.getByRole("combobox", { name: "真实角色" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "撤销局面修改" }));
    clickSave();
    await waitFor(() => expect(api.createGame).toHaveBeenCalled());
    const payload = vi.mocked(api.createGame).mock.calls[0][0];
    expect(payload.seats.filter((seat) => seat.role_id === scripts[0].travellers[0].id)).toHaveLength(6);
    expect(payload.timeline?.every((entry) => entry.snapshot.composition.traveller <= 5)).toBe(true);
    await screen.findByRole("button", { name: "已保存" });
  });
});

it("attaches delayed analysis to its source game without displaying it in a new game", async () => {
  const response = deferred<SavedAnalysis>();
  vi.spyOn(api, "analyseGame").mockReturnValue(response.promise);
  mount();
  await nameInput();
  fireEvent.click(screen.getByRole("button", { name: "Codex 辅助" }));
  fireEvent.change(screen.getByRole("textbox", { name: "说书人问题" }), { target: { value: "Check this game" } });
  const ask = screen.getByRole("button", { name: "触发本地 Codex" }) as HTMLButtonElement;
  await waitFor(() => expect(ask.disabled).toBe(false));
  fireEvent.click(ask);
  await waitFor(() => expect(api.analyseGame).toHaveBeenCalledTimes(1));
  const [id, eventId, request] = vi.mocked(api.analyseGame).mock.calls[0];
  fireEvent.click(screen.getByTitle("新建局面"));
  await act(async () => {
    response.resolve({ id: "analysis-1", source_game_id: id, source_game_version: 1,
      event_id: eventId, snapshot: request.game, question: request.question, answer: "OLD_GAME_ANSWER",
      created_at: new Date().toISOString(), duration_ms: 1, selected_seat_id: request.selected_seat_id,
      perspective: "storyteller", prompt_sha256: "a".repeat(64), model: null });
    await response.promise;
  });
  expect(id).toBe("game-1");
  expect(screen.queryByText("OLD_GAME_ANSWER")).toBeNull();
  expect(screen.getByText("分析已保存到原存档；载入原存档即可查看。")).toBeTruthy();
});

it("keeps a damaged legacy checkpoint untouched and shows the recovery error", async () => {
  const key = "botc-bench.draft.v1.damaged";
  localStorage.setItem(key, "broken JSON");
  sessionStorage.setItem("botc-bench.draft-session", "damaged");
  const write = vi.spyOn(RecoveryStore.prototype, "write");
  mount();
  await nameInput();
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(localStorage.getItem(key)).toBe("broken JSON");
  expect(write).not.toHaveBeenCalled();
});

it("ignores an old preview when its request resolves after a newer question", async () => {
  const older = deferred<Awaited<ReturnType<typeof api.previewReason>>>();
  vi.mocked(api.previewReason).mockImplementation(async (request) => request.question === "Old question"
    ? older.promise : { prompt: request.question, prompt_sha256: "a".repeat(64), player_view: null, template_id: null });
  mount();
  await nameInput();
  fireEvent.click(screen.getByRole("button", { name: "Codex 辅助" }));
  const question = screen.getByRole("textbox", { name: "说书人问题" });
  fireEvent.change(question, { target: { value: "Old question" } });
  await waitFor(() => expect(vi.mocked(api.previewReason).mock.calls.some(([request]) => request.question === "Old question")).toBe(true));
  fireEvent.change(question, { target: { value: "New question" } });
  await waitFor(() => expect(screen.getByLabelText("完整代理输入").textContent).toBe("New question"));
  await act(async () => {
    older.resolve({ prompt: "OBSOLETE_PREVIEW", prompt_sha256: "b".repeat(64), player_view: null, template_id: null });
    await older.promise;
  });
  expect(screen.getByLabelText("完整代理输入").textContent).toBe("New question");
});
