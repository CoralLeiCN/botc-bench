import { useState } from "react";
import { Check, Vote } from "lucide-react";
import {
  currentNominations, executionStanding, finishNomination, nominationError, openNomination,
  playerLabel, recordVote, startNomination, voteTotal,
} from "../voting";
import type { GameDraft, Script } from "../types";

interface VotingTrackerProps {
  game: GameDraft;
  script: Script;
  readOnly: boolean;
  onChange: (updater: (game: GameDraft) => GameDraft) => void;
}

export function VotingTracker({ game, script, readOnly, onChange }: VotingTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const [nominator, setNominator] = useState("");
  const [nominee, setNominee] = useState("");
  const active = openNomination(game);
  const today = currentNominations(game);
  const standing = executionStanding(game);
  const dead = game.seats.filter((seat) => !seat.alive);
  const reserved = new Set(active?.votes.filter((v) => v.dead_vote).map((v) => v.player.id));
  const remaining = dead.filter((seat) => seat.dead_vote_available && !reserved.has(seat.id)).length;
  const error = nominationError(game, nominator, nominee, script);
  const pending = active?.votes.filter((vote) => vote.choice === "pending").length ?? 0;
  const label = standing.candidate ? `待处决：${playerLabel(standing.candidate)}` : standing.tied ? "最高票平票 · 无人待处决" : "无人待处决";
  const options = game.seats.map((seat) => <option key={seat.id} value={seat.id}>{playerLabel(seat)}{seat.alive ? "" : "（死亡）"}</option>);

  return <section className="voting-panel panel-shell" aria-label="提名与投票">
    <button type="button" className="voting-heading" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <Vote size={17} /><strong>提名与投票</strong>
      <span className="execution-standing" aria-live="polite">第 {game.day_number} 天 · {label}{standing.high > 0 ? ` · ${standing.high} 票` : ""}</span>
      <span>亡者票 {remaining} / {dead.length}{reserved.size ? `（暂占 ${reserved.size}）` : ""}</span>
      <span>{expanded ? "收起" : active ? "继续投票" : "展开"}</span>
    </button>
    {expanded && <div className="voting-body">
      <div className="voting-ballot">
        <fieldset disabled={readOnly} className="voting-controls">
          {!active ? <>
            <div className="nomination-form">
              <label>提名者<select aria-label="提名者" value={nominator} onChange={(e) => setNominator(e.target.value)}><option value="">选择玩家</option>{options}</select></label>
              <span>→</span>
              <label>被提名者<select aria-label="被提名者" value={nominee} onChange={(e) => setNominee(e.target.value)}><option value="">选择玩家</option>{options}</select></label>
              <button type="button" disabled={Boolean(error)} onClick={() => {
                const id = crypto.randomUUID();
                onChange((current) => startNomination(current, nominator, nominee, script, id));
                setNominator(""); setNominee("");
              }}>发起提名</button>
            </div>
            <p className="voting-help">{error ?? "可以开始记录本次投票。"}</p>
          </> : <>
            <div className="ballot-summary"><strong>{playerLabel(active.nominator)} → {playerLabel(active.nominee)}</strong>
              <span aria-live="polite">{voteTotal(active)} 票 · 当前门槛 {Math.ceil(game.seats.filter((seat) => seat.alive).length / 2)} · {pending} 人未记录</span>
            </div>
            <div className="individual-votes">
              {active.votes.map((vote) => {
                const seat = game.seats.find((s) => s.id === vote.player.id);
                const canVote = seat && (seat.alive || seat.dead_vote_available);
                return <div className="individual-vote" key={vote.player.id}>
                  <span title={playerLabel(vote.player)}>{playerLabel(vote.player)}{!seat?.alive ? " †" : ""}</span>
                  <select aria-label={`${playerLabel(vote.player)} 的投票`} value={vote.choice}
                    onChange={(e) => onChange((current) => recordVote(current, active.id, vote.player.id, e.target.value as typeof vote.choice, vote.weight))}>
                    <option value="pending">未记录</option>
                    <option value="no">未投票</option>
                    <option value="yes" disabled={!canVote}>投票{!seat?.alive ? "（亡者票）" : ""}</option>
                  </select>
                  {vote.choice === "yes" && <input type="number" min={-20} max={20} value={vote.weight}
                    title="计入票数；角色能力可调整权重"
                    aria-label={`${playerLabel(vote.player)} 的计票权重`}
                    onChange={(e) => onChange((current) => recordVote(current, active.id, vote.player.id, "yes", Number(e.target.value)))} />}
                </div>;
              })}
            </div>
            <div className="ballot-actions">
              <button type="button" disabled={!pending} onClick={() => onChange((current) => {
                let next = current;
                for (const vote of openNomination(current)?.votes ?? []) {
                  if (vote.choice === "pending") next = recordVote(next, active.id, vote.player.id, "no");
                }
                return next;
              })}>其余记为未投票</button>
              <button type="button" className="complete-ballot" disabled={pending > 0}
                onClick={() => onChange((current) => finishNomination(current, active.id))}><Check size={13} /> 完成计票</button>
              <button type="button" onClick={() => onChange((current) => finishNomination(current, active.id, true))}>取消投票</button>
            </div>
            <p className="voting-help">完成计票后消耗亡者票并锁定本次结果。取消保留提名记录。票数权重可按角色能力调整。</p>
          </>}
        </fieldset>
        <div className="dead-vote-list" aria-label="亡者票余额">
          {dead.length === 0 ? <span>暂无死亡玩家</span> : dead.map((seat) => <span key={seat.id} className={seat.dead_vote_available ? "available" : "spent"}>
            {playerLabel(seat)} · {reserved.has(seat.id) ? "本轮暂占" : seat.dead_vote_available ? "剩余 1 票" : "已用"}
          </span>)}
        </div>
      </div>
      <div className="nomination-history">
        <strong>第 {game.day_number} 天 · {today.length} 次提名</strong>
        {!today.length && <p>提名、每位玩家的投票与计票结果将自动进入时间线。</p>}
        {today.map((n) => <details key={n.id}>
          <summary>{playerLabel(n.nominator)} → {playerLabel(n.nominee)}<span>{n.status === "open" ? "计票中" : n.status === "cancelled" ? "已取消" : `${voteTotal(n)} 票 / 门槛 ${Math.ceil(n.alive_count / 2)}`}</span></summary>
          <ul>{n.votes.map((vote) => <li key={vote.player.id}>{playerLabel(vote.player)}：{vote.choice === "yes" ? `投票 · ${vote.weight} 票${vote.dead_vote ? " · 亡者票" : ""}` : vote.choice === "no" ? "未投票" : "未记录"}</li>)}</ul>
        </details>)}
        <p className="voting-help">候选人按常规票数计算，处决不会自动杀死玩家。特殊裁定请补充到时间线；亡者票可在玩家检查器修正。</p>
      </div>
    </div>}
  </section>;
}
