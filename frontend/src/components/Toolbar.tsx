import {
  Archive,
  CirclePlus,
  CloudOff,
  Save,
  ShieldCheck,
  Users,
  Copy,
  Download,
  Upload,
  Undo2,
  Redo2,
} from "lucide-react";
import { useRef, useState } from "react";
import { allRoles, assignedCounts, TEAM_SHORT } from "../game";
import type { GameDraft, GameSummary, Script, Team } from "../types";

interface ToolbarProps {
  readOnly?: boolean;
  scripts: Script[];
  game: GameDraft;
  script: Script;
  savedGames: GameSummary[];
  currentGameId: string | null;
  dirty: boolean;
  saving: boolean;
  loadingGame: boolean;
  lastSavedAt: string | null;
  onNameChange: (name: string) => void;
  onScriptChange: (scriptId: string) => void;
  onPlayerCountChange: (count: number) => void;
  onLoadGame: (id: string) => void;
  onNewGame: () => void;
  onSave: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onImport: (file: File) => void;
}

const teams: Team[] = ["townsfolk", "outsider", "minion", "demon"];

export function Toolbar({
  readOnly = false,
  scripts,
  game,
  script,
  savedGames,
  currentGameId,
  dirty,
  saving,
  loadingGame,
  lastSavedAt,
  onNameChange,
  onScriptChange,
  onPlayerCountChange,
  onLoadGame,
  onNewGame,
  onSave,
  canUndo, canRedo, onUndo, onRedo, onDuplicate, onExport, onImport,
}: ToolbarProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const counts = assignedCounts(game.seats, allRoles(script));
  const needsSave = dirty || !currentGameId;

  return (
    <header className="topbar">
      <div className="brand-block" aria-label="Ravenswood Desk">
        <div className="brand-mark" aria-hidden="true">
          <span>R</span>
        </div>
        <div>
          <strong>Ravenswood Desk</strong>
          <span>LOCAL STORYTELLER WORKSPACE</span>
        </div>
      </div>

      <div className="topbar-main">
        <label className="compact-field game-name-field">
          <span>局面</span>
          <input
            disabled={readOnly}
            value={game.name}
            onChange={(event) => onNameChange(event.target.value)}
            maxLength={120}
          />
        </label>

        <label className="compact-field script-field">
          <span>剧本</span>
          <select disabled={readOnly} value={game.script_id} onChange={(event) => onScriptChange(event.target.value)}>
            {scripts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name.zh_hans} · {item.name.en}
              </option>
            ))}
          </select>
        </label>

        <label className="compact-field players-field">
          <span>
            <Users size={12} /> 玩家
          </span>
          <div className="stepper">
            <button
              type="button"
              onClick={() => onPlayerCountChange(game.player_count - 1)}
              disabled={readOnly || game.player_count <= 5}
              aria-label="减少玩家"
            >
              −
            </button>
            <input
              disabled={readOnly}
              type="number"
              min={5}
              max={20}
              value={game.player_count}
              onChange={(event) => onPlayerCountChange(Number(event.target.value))}
            />
            <button
              type="button"
              onClick={() => onPlayerCountChange(game.player_count + 1)}
              disabled={readOnly || game.player_count >= 20}
              aria-label="增加玩家"
            >
              +
            </button>
          </div>
        </label>

        <div className="composition-strip" aria-label="当前角色配比">
          {teams.map((team) => (
            <span key={team} className={`composition-pill ${team}`}>
              <b>{TEAM_SHORT[team]}</b>
              {counts[team]}/{game.composition[team]}
            </span>
          ))}
          {game.composition.traveller > 0 && (
            <span className="composition-pill traveller">
              <b>旅</b>{counts.traveller}/{game.composition.traveller}
            </span>
          )}
        </div>
      </div>

      <div className="topbar-actions">
        <div className="edit-actions">
          <button type="button" className="icon-button" onClick={onUndo}
            disabled={readOnly || loadingGame || !canUndo} title="撤销局面修改 (Cmd/Ctrl+Z)" aria-label="撤销局面修改"><Undo2 size={15} /></button>
          <button type="button" className="icon-button" onClick={onRedo}
            disabled={readOnly || loadingGame || !canRedo} title="重做局面修改 (Cmd/Ctrl+Shift+Z)" aria-label="重做局面修改"><Redo2 size={15} /></button>
          <div className="file-menu">
            <button type="button" className="file-menu-trigger" aria-expanded={menuOpen}
              disabled={saving || loadingGame} onClick={() => setMenuOpen(!menuOpen)}>存档操作 ▾</button>
            {menuOpen && <>
              <button className="file-menu-dismiss" aria-label="关闭存档操作" onClick={() => setMenuOpen(false)} />
              <div className="file-menu-items" onKeyDown={(event) => { if (event.key === "Escape") setMenuOpen(false); }}>
                <button type="button" disabled={!currentGameId || saving || loadingGame}
                  onClick={() => { setMenuOpen(false); onDuplicate(); }}><Copy size={14} />复制当前存档</button>
                <button type="button" disabled={saving || loadingGame}
                  onClick={() => { setMenuOpen(false); onExport(); }}><Download size={14} />导出 JSON</button>
                <button type="button" disabled={saving || loadingGame}
                  onClick={() => { setMenuOpen(false); fileInput.current?.click(); }}><Upload size={14} />导入 JSON</button>
              </div>
            </>}
          </div>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden
            aria-label="导入 JSON 文件" onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) onImport(file);
            }} />
        </div>
        <label className="archive-select" title="载入本地存档">
          <Archive size={15} />
          <select
            value={currentGameId ?? ""}
            onChange={(event) => onLoadGame(event.target.value)}
            disabled={saving || loadingGame}
          >
            <option value="">本地存档</option>
            {savedGames.map((saved) => (
              <option key={saved.id} value={saved.id}>
                {saved.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="icon-button"
          onClick={onNewGame}
          title="新建局面"
          disabled={saving || loadingGame}
        >
          <CirclePlus size={17} />
        </button>
        <button
          type="button"
          className="save-button"
          onClick={onSave}
          disabled={saving || loadingGame}
        >
          {saving ? (
            <CloudOff size={16} />
          ) : needsSave ? (
            <Save size={16} />
          ) : (
            <ShieldCheck size={16} />
          )}
          {saving ? "保存中" : needsSave ? "保存局面" : "已保存"}
        </button>
        <span className={`save-state ${dirty ? "dirty" : ""}`}>
          {dirty
            ? "有未保存修改"
            : lastSavedAt
              ? `保存于 ${new Date(lastSavedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
              : "本地草稿"}
        </span>
      </div>
    </header>
  );
}
