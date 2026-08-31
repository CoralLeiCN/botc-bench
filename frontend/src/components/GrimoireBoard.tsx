import type { CSSProperties } from "react";
import { AlertTriangle, CheckCircle2, MousePointer2, Skull, UserRound } from "lucide-react";
import { allRoles, assignedCounts } from "../game";
import type { GameDraft, Script, ValidationIssue } from "../types";

interface GrimoireBoardProps {
  game: GameDraft;
  script: Script;
  selectedSeatId: string | null;
  selectedRoleId: string | null;
  issues: ValidationIssue[];
  onSeatClick: (seatId: string) => void;
}

const phaseLabels: Record<GameDraft["phase"], string> = {
  setup: "配置中",
  first_night: "首夜",
  day: "白天",
  night: "夜晚",
  finished: "已结束",
};

export function GrimoireBoard({
  game,
  script,
  selectedSeatId,
  selectedRoleId,
  issues,
  onSeatClick,
}: GrimoireBoardProps) {
  const availableRoles = allRoles(script);
  const roleById = new Map(availableRoles.map((role) => [role.id, role]));
  const assigned = assignedCounts(game.seats, availableRoles);
  const assignedTotal = Object.values(assigned).reduce((sum, value) => sum + value, 0);
  const hasError = issues.some((issue) => issue.level === "error");
  const compact = game.player_count > 14;

  return (
    <main className="board-panel panel-shell">
      <div className="board-toolbar">
        <div>
          <span className="eyebrow">GRIMOIRE</span>
          <h1>{script.name.zh_hans}</h1>
          <small>{script.name.en}</small>
        </div>
        <div className="phase-chip">
          <span>{phaseLabels[game.phase]}</span>
          {game.phase !== "setup" && <b>第 {game.day_number} 天</b>}
        </div>
        <div className={`validation-chip ${hasError ? "error" : issues.length ? "warning" : "ok"}`}>
          {hasError || issues.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
          {hasError ? "需要修正" : issues.length ? `${issues.length} 条提示` : "局面有效"}
        </div>
      </div>

      <div className={`grimoire ${compact ? "compact" : ""}`}>
        <div className="grimoire-rings" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        {game.seats.map((seat, index) => {
          const angle = -Math.PI / 2 + (Math.PI * 2 * index) / game.seats.length;
          const x = 50 + Math.cos(angle) * (compact ? 44 : 42);
          const y = 50 + Math.sin(angle) * (compact ? 43 : 41);
          const role = seat.role_id ? roleById.get(seat.role_id) : undefined;
          const style = { "--seat-x": `${x}%`, "--seat-y": `${y}%` } as CSSProperties;
          return (
            <button
              type="button"
              key={seat.id}
              style={style}
              className={`seat-card ${role?.team ?? "unassigned"} ${
                selectedSeatId === seat.id ? "selected" : ""
              } ${seat.alive ? "" : "dead"}`}
              onClick={() => onSeatClick(seat.id)}
              aria-label={`${seat.position} 号 ${seat.player_name} ${role?.name.zh_hans ?? "未分配"}`}
            >
              <span className="seat-number">{seat.position}</span>
              <span className="seat-status" aria-label={seat.alive ? "存活" : "死亡"}>
                {seat.alive ? <UserRound size={11} /> : <Skull size={12} />}
              </span>
              <strong>{seat.player_name || `玩家 ${seat.position}`}</strong>
              <span className="seat-role">
                {role ? (
                  <>
                    <b>{role.name.zh_hans}</b>
                    <small>{role.name.en}</small>
                  </>
                ) : (
                  <em>未分配角色</em>
                )}
              </span>
              {seat.markers.length > 0 && (
                <span className="seat-markers">
                  {seat.markers.slice(0, 2).map((item) => (
                    <i key={item.id}>{item.label}</i>
                  ))}
                  {seat.markers.length > 2 && <i>+{seat.markers.length - 2}</i>}
                </span>
              )}
            </button>
          );
        })}

        <div className="board-center">
          <span className="clock-hand" aria-hidden="true" />
          <span className="center-kicker">CURRENT STATE</span>
          <strong>
            {assignedTotal}<small> / {game.player_count}</small>
          </strong>
          <span>角色已落位</span>
          {selectedRoleId ? (
            <p className="assignment-hint active">
              <MousePointer2 size={13} /> 点击座位分配
              <b>{roleById.get(selectedRoleId)?.name.zh_hans}</b>
            </p>
          ) : (
            <p className="assignment-hint">先在左侧选择角色，或直接检查玩家</p>
          )}
        </div>
      </div>

      <div className="board-footer">
        <span>顺时针座次 · 点击座位检查</span>
        <div className="issue-ticker">
          {issues[0] ? (
            <>
              <AlertTriangle size={12} /> {issues[0].message}
            </>
          ) : (
            <>
              <CheckCircle2 size={12} /> 配比与座位结构已通过本地校验
            </>
          )}
        </div>
      </div>
    </main>
  );
}
