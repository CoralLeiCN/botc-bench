import { type UiMessage } from "./language";
import { useLanguage, LanguageSwitch } from "./LanguageProvider";
import { AlertTriangle, Eye, LoaderCircle, X } from "lucide-react";
import { useMemo, useState } from "react";
import { CodexPanel } from "./components/CodexPanel";
import { GrimoireBoard } from "./components/GrimoireBoard";
import { Inspector } from "./components/Inspector";
import { PlayerView } from "./components/PlayerView";
import { NightChecklist } from "./components/NightChecklist";
import { RolePalette } from "./components/RolePalette";
import { Timeline } from "./components/Timeline";
import { Toolbar } from "./components/Toolbar";
import { VotingTracker } from "./components/VotingTracker";
import { suggestedComposition, validateDraft } from "./game";
import { nextNightStep, nightStepSeats } from "./night";
import { useGameDocument } from "./hooks/useGameDocument";
import { useDraftRecovery } from "./hooks/useDraftRecovery";
import { useGamePersistence } from "./hooks/useGamePersistence";
import { useGameEdits } from "./hooks/useGameEdits";
import { useAgentAnalysis } from "./hooks/useAgentAnalysis";
import { useArchiveActions } from "./hooks/useArchiveActions";
import { useWorkspaceShortcuts } from "./hooks/useWorkspaceShortcuts";
import type { Composition, EventAudience, EventDetails, ManualEventKind } from "./types";

export default function App() {
  const { t, language } = useLanguage();
  const [notice, setNotice] = useState<UiMessage | null>(null);
  const [panelTab, setPanelTab] = useState<"night" | "inspector" | "codex">("night");
  const document = useGameDocument();
  const recovery = useDraftRecovery(document);
  const persistence = useGamePersistence(document, recovery, language, setNotice);
  const { scripts, savedGames, harnessStatus, fatalError, autoSaveFailed, saveGame, loadGame } = persistence;
  const { game, displayedGame, timeline, history, analyses, branchOrigin, record, selectedSeatId,
    selectedRoleId, viewAsSeatId, dirty, replayIndex, seek } = document;
  const replaying = replayIndex !== null;
  const branching = persistence.operation === "archive";
  const loadingGame = persistence.operation === "loading";
  const saving = persistence.isSaving;
  const script = useMemo(() => scripts.find((item) => item.id === displayedGame?.script_id) ?? null,
    [scripts, displayedGame?.script_id]);
  const selectedSeat = displayedGame?.seats.find((seat) => seat.id === selectedSeatId) ?? null;
  const issues = useMemo(() => displayedGame && script ? validateDraft(displayedGame, script, language) : [],
    [displayedGame, script, language]);
  const edits = useGameEdits(document, scripts, script, branching, setNotice, () => setPanelTab("inspector"));
  const { updateGame, changeScript, changePlayerCount, chooseSeat, changeSeat, moveSeat } = edits;
  const archive = useArchiveActions(document, persistence, script, setNotice);
  const { newGame, branch: branchFromReplay, duplicate: duplicateGame, exportGame, importGame } = archive;
  const agent = useAgentAnalysis(document, persistence, setNotice);
  const { question, preview, previewError, playerView, answer: codexAnswer, error: codexError,
    isBusy: codexBusy, ask: askCodex } = agent;
  const changePerspective = document.setPerspective;
  const undoRedo = (direction: "undo" | "redo"): void => {
    if (!persistence.operation) document.undoRedo(direction);
  };
  const addEvent = (kind: ManualEventKind, note: string, details: EventDetails, audience: EventAudience): void => {
    if (!persistence.isBusy()) document.addEvent(kind, note, details, audience);
  };
  const recoveryError = recovery.error;
  useWorkspaceShortcuts(document, persistence, recovery.isPending);

  if (fatalError) {
    return (
      <div className="fatal-screen">
        <LanguageSwitch />
        <AlertTriangle size={30} />
        <h1>{t("无法连接本地工作区")}</h1>
        <p>{fatalError}</p>
        <code>uv run uvicorn backend.app.main:app --reload --host 127.0.0.1 --port 8000</code>
      </div>
    );
  }

  if (!game || !displayedGame || !script) {
    return (
      <div className="loading-screen">
        <LanguageSwitch />
        <LoaderCircle size={24} className="spin" />

       {t("正在打开魔典…")}
      </div>
    );
  }

  const codexPanel = (
    <CodexPanel
      script={script}
      selectedSeat={viewAsSeatId ? playerView?.seats.find((seat) => seat.id === viewAsSeatId) ?? null : selectedSeat}
      playerMode={Boolean(viewAsSeatId)}
      question={question}
      onQuestionChange={agent.setQuestion}
      preview={preview}
      previewError={previewError}
      onRefreshPreview={agent.refreshPreview}
      status={harnessStatus}
      answer={codexAnswer}
      busy={codexBusy}
      disabled={saving || loadingGame || branching}
      analyses={viewAsSeatId ? [] : analyses}
      currentEventId={timeline[replayIndex ?? timeline.length - 1]?.id ?? null}
      onViewSnapshot={(analysis) => {
        const index = timeline.findIndex((entry) => entry.id === analysis.event_id);
        if (index >= 0) { seek(index); document.selectSeat(analysis.selected_seat_id); }
      }}
      error={codexError}
      onAsk={askCodex}
      onOpenNight={viewAsSeatId ? undefined : () => setPanelTab("night")}
    />
  );

  if (viewAsSeatId) {
    return (
      <div className="app-shell player-mode">
        <header className="perspective-toolbar panel-shell">
          <Eye size={20} />
          <LanguageSwitch />
          <div><strong>{t("玩家视角")}</strong><small>{replaying ? t("当前选定的历史时刻") : t("当前局面")} {t("· 只读预览")}</small></div>
          <label>
            <span>{t("查看玩家")}</span>
            <select aria-label={t("查看玩家")} value={viewAsSeatId} onChange={(event) => changePerspective(event.target.value)}>
              {displayedGame.seats.map((seat) => <option key={seat.id} value={seat.id}>{seat.position} {t("号 ·")} {seat.player_name}</option>)}
            </select>
          </label>
          <button type="button" onClick={() => changePerspective(null)}>{t("返回说书人视角")}</button>
        </header>
        <div className="player-workspace">
          {playerView ? <PlayerView view={playerView} script={script} /> : (
            <main className="player-view panel-shell" role="status">{previewError ?? t("正在生成玩家视角…")}</main>
          )}
          <aside className="player-agent panel-shell">{codexPanel}</aside>
        </div>
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

      {recoveryError && <div className="recovery-warning" role="alert">{t(recoveryError.key, recoveryError.values)}</div>}
      {notice && (
        <div className={`notice-bar ${/失败|冲突/.test(notice.key) ? "error" : ""}`}>
          {t(notice.key, notice.values)}
          <button type="button" onClick={() => setNotice(null)} aria-label={t("关闭通知")}>
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
            onSelectRole={document.selectRole}
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
          <nav className="right-panel-tabs" aria-label={t("说书人工具")}>
            {([["night", t("今晚清单")], ["inspector", t("玩家检查器")], ["codex", t("Codex 辅助")]] as const).map(([tab, label]) => (
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
              key={`${document.epoch}-${displayedGame.night_checklist?.id ?? "new"}`}
              game={displayedGame}
              script={script}
              readOnly={replaying || branching}
              onUpdate={updateGame}
              onFocusSeat={(id) => {
                document.selectRole(null);
                document.selectSeat(id);
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
              onViewAsPlayer={changePerspective}
              onGameMetaChange={(patch) =>
                updateGame((current) => ({ ...current, ...patch }))
              }
            />
          </div>
          <div className="right-panel-content" hidden={panelTab !== "codex"}>
            {codexPanel}
          </div>
        </aside>
      </div>
      <VotingTracker
        key={`voting-${document.epoch}`}
        game={displayedGame}
        script={script}
        readOnly={replaying || branching || loadingGame}
        onChange={updateGame}
      />
      <Timeline
        key={document.epoch}
        entries={timeline}
        scripts={scripts}
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
