import { ArrowDown, ArrowUp, Check, ListChecks, Moon, Plus, RotateCcw, Sun } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  addNightStep, canFinishNight, createNightChecklist, expiringEffects, finishNight,
  isCurrentNight, moveNightStep, newNightStep, nextNightStep, nightStepSeats,
  reviewEffect, syncNightSteps, updateNightStep,
} from "../night";
import { phaseLabel } from "../timeline";
import type { GameDraft, NightStep, Script } from "../types";

interface Props {
  game: GameDraft;
  script: Script;
  readOnly: boolean;
  onUpdate: (updater: (game: GameDraft) => GameDraft) => void;
  onFocusSeat: (seatId: string) => void;
}

export function NightChecklist({ game, script, readOnly, onUpdate, onFocusSeat }: Props) {
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [customTitle, setCustomTitle] = useState("");
  const [customSeat, setCustomSeat] = useState("");
  const [customRole, setCustomRole] = useState("");
  const detailRef = useRef<HTMLElement | null>(null);
  const checklist = game.night_checklist;
  const active = isCurrentNight(game);
  const next = nextNightStep(game);
  const inspected = checklist?.steps.find((step) => step.id === inspectedId) ?? next ?? checklist?.steps.at(-1);
  const locked = readOnly || !active;
  const finished = checklist?.steps.filter((step) => step.status !== "pending").length ?? 0;
  const effects = expiringEffects(game);
  const pendingEffects = effects.filter((effect) => !checklist?.reviewed_effects.includes(effect.key));
  const instructions = script.night_order?.[checklist?.phase ?? "first_night"] ?? [];
  const instruction = instructions.find((item) => item.id === inspected?.instruction_id);
  const seat = game.seats.find((item) => item.id === inspected?.seat_id);
  const roles = [...script.roles, ...script.travellers];
  const role = roles.find((item) => item.id === inspected?.instruction_id);
  const canStart = !readOnly && game.phase !== "finished" && !(game.phase === "day" && game.day_number >= 99);

  useEffect(() => {
    detailRef.current?.scrollIntoView({ block: "start" });
  }, [inspected?.id]);

  const start = () => {
    if (!canStart) return;
    const phase = game.phase === "setup" || game.phase === "first_night" ? "first_night" : "night";
    const day = game.phase === "setup" ? 1 : game.phase === "day" ? game.day_number + 1 : game.day_number;
    const created = createNightChecklist(game, script, phase, day);
    onUpdate((current) => ({ ...current, phase, day_number: day, night_checklist: created }));
    setInspectedId(null);
  };

  const patch = (changes: Partial<Pick<NightStep, "choice" | "information" | "decision" | "status">>) => {
    if (!inspected || locked) return;
    onUpdate((current) => updateNightStep(current, inspected.id, changes));
    if (changes.status) setInspectedId(null);
  };

  const add = () => {
    if (!customTitle.trim() || locked) return;
    const step = newNightStep(customTitle.trim(), customSeat || null, customRole || null);
    onUpdate((current) => addNightStep(current, step));
    setCustomTitle("");
    setCustomSeat("");
    setCustomRole("");
    setInspectedId(step.id);
  };

  return (
    <section className="night-section" aria-label="引导式夜间清单">
      <div className="panel-title-row">
        <div><span className="eyebrow">GUIDED NIGHT</span><h2><Moon size={15} /> 今晚清单</h2></div>
        {checklist && <span className="night-count">{finished} / {checklist.steps.length}</span>}
      </div>
      <p className="night-help">按官方夜序逐步记录选择、收到的信息与说书人裁定。进度随局面自动保存。</p>

      {!active && (
        <div className="night-start">
          <p>{checklist ? `上份清单：${phaseLabel(checklist)}。当前：${phaseLabel(game)}。` : "开始夜晚后，下一步玩家会在魔典中高亮。"}</p>
          <button type="button" className="night-primary" disabled={!canStart} onClick={start}>
            <ListChecks size={14} /> {game.phase === "setup" ? "开始首夜" : game.phase === "day" ? "开始下一夜" : "建立当前夜晚清单"}
          </button>
          {checklist && <small>新夜晚将建立独立清单；往夜记录可在时间线中回放。</small>}
          {game.phase === "finished" && <small>游戏已结束；切换阶段后可继续夜间流程。</small>}
        </div>
      )}

      {checklist && (
        <>
          <div className="night-progress" role="progressbar" aria-label="夜间完成进度" aria-valuemin={0} aria-valuemax={checklist.steps.length} aria-valuenow={finished}>
            <span style={{ width: `${finished / checklist.steps.length * 100}%` }} />
          </div>
          <div className="night-next" aria-live="polite">
            <b>{active ? next ? `下一步：${next.title}` : "行动已完成 · 核对提醒后进入白天" : "历史清单 · 只读"}</b>
            {next && <button type="button" onClick={() => {
              setInspectedId(null);
              const ids = nightStepSeats(game, script, next);
              if (ids[0]) onFocusSeat(ids[0]);
            }}>定位下一步</button>}
          </div>
          <p className="night-help">流程提示（本地）：死亡、醉酒及条件行动仍列出供核对；不适用时填写原因并跳过。获得的能力可手动添加。</p>
          {game.seats.some((item) => !item.role_id) && <p className="night-warning">有玩家尚未分配角色；分配后点击「补入新角色行动」。</p>}
          <button type="button" className="night-sync" disabled={locked} onClick={() => onUpdate((current) => syncNightSteps(current, script))}>
            <RotateCcw size={12} /> 补入新角色行动
          </button>
          <ol className="night-step-list">
            {checklist.steps.map((step, index) => (
              <li key={step.id}>
                <button type="button" className={`${step.id === inspected?.id ? "selected" : ""} ${step.id === next?.id ? "next" : ""}`}
                  aria-current={step.id === next?.id ? "step" : undefined}
                  aria-pressed={step.id === inspected?.id}
                  onClick={() => { setInspectedId(step.id); if (step.seat_id) onFocusSeat(step.seat_id); }}>
                  <span className="night-step-number">{step.status === "completed" ? <Check size={12} /> : index + 1}</span>
                  <span>{step.title}</span>
                  <small>{step.status === "completed" ? "完成" : step.status === "skipped" ? "跳过" : step.id === next?.id ? "下一步" : "待办"}</small>
                </button>
              </li>
            ))}
          </ol>

          {inspected && (
            <article className="night-step-detail" key={inspected.id} ref={detailRef}>
              <header><h3>{inspected.title}</h3>
                <button type="button" aria-label="提前此步骤" disabled={locked || checklist.steps[0].id === inspected.id}
                  onClick={() => onUpdate((current) => moveNightStep(current, inspected.id, -1))}><ArrowUp size={13} /></button>
                <button type="button" aria-label="推后此步骤" disabled={locked || checklist.steps.at(-1)?.id === inspected.id}
                  onClick={() => onUpdate((current) => moveNightStep(current, inspected.id, 1))}><ArrowDown size={13} /></button>
              </header>
              {inspected.seat_id && !seat && <p className="night-warning">该座位已移除；请核对并跳过此步骤。</p>}
              {seat && <div className="night-seat-context">
                <b>{seat.position} 号 · {seat.player_name} · {seat.alive ? "存活" : "死亡：请确认本步是否触发"}</b>
                {seat.role_id !== inspected.instruction_id && <p className="night-warning">此步骤与当前真实角色不同，请确认是否为获得的能力或需要跳过。</p>}
                {seat.markers.map((marker) => <span key={marker.id}>{marker.label}{marker.expires ? ` · 至${marker.expires}` : ""}{marker.note ? ` · ${marker.note}` : ""}</span>)}
              </div>}
              {instruction && <div className="night-official">
                <small>官方夜间提醒 · 中文 / English</small>
                <p>{instruction.reminder.zh_hans ?? "暂无官方中文提醒"}</p>
                <p lang="en">{instruction.reminder.en ?? "No official English reminder available."}</p>
              </div>}
              {role && <details className="night-ability"><summary>查看官方能力（含行动条件）</summary>
                <p>{role.ability.zh_hans}</p><p lang="en">{role.ability.en}</p>
              </details>}
              {inspected.instruction_id === "dusk" && <p className="night-help">说书人核对：持续效果、今晚触发的能力、信息与裁定。请在下方记录决定。</p>}
              {inspected.instruction_id === "dawn" && <p className="night-help">说书人核对：未结算死亡、持续效果、白天公告；处理下方到期提醒后进入白天。</p>}
              <fieldset disabled={locked || inspected.status !== "pending"} className="night-fields">
                <label><span>玩家选择 / 目标</span><textarea rows={2} maxLength={2000} value={inspected.choice} onChange={(event) => patch({ choice: event.target.value })} placeholder="例如：选择 2 号与 5 号" /></label>
                <label><span>玩家收到的信息</span><textarea rows={2} maxLength={2000} value={inspected.information} onChange={(event) => patch({ information: event.target.value })} placeholder="记录实际展示的数字、角色或信息" /></label>
                <label><span>说书人决定 / 跳过原因</span><textarea rows={2} maxLength={2000} value={inspected.decision} onChange={(event) => patch({ decision: event.target.value })} placeholder="条件是否满足、醉酒信息、效果结算…" /></label>
              </fieldset>
              <div className="night-actions">
                {inspected.status === "pending" ? <>
                  <button type="button" className="night-primary" disabled={locked} onClick={() => patch({ status: "completed" })}><Check size={14} /> 完成步骤</button>
                  <button type="button" disabled={locked || !inspected.decision.trim()} onClick={() => patch({ status: "skipped" })}>跳过（需原因）</button>
                </> : <button type="button" disabled={locked} onClick={() => patch({ status: "pending" })}><RotateCcw size={13} /> 重新打开步骤</button>}
              </div>
            </article>
          )}

          <details className="night-custom">
            <summary><Plus size={12} /> 添加行动或说书人决定</summary>
            <fieldset disabled={locked || checklist.steps.length >= 200} className="night-fields">
              <label><span>步骤名称</span><input maxLength={200} value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="如：酒鬼的共情者信息 / 复活结算" /></label>
              <label><span>关联玩家</span><select value={customSeat} onChange={(event) => setCustomSeat(event.target.value)}><option value="">说书人 / 无玩家</option>{game.seats.map((item) => <option key={item.id} value={item.id}>{item.position} 号 · {item.player_name}</option>)}</select></label>
              <label><span>参考能力</span><select value={customRole} onChange={(event) => setCustomRole(event.target.value)}><option value="">自定义决定</option>{roles.map((item) => <option key={item.id} value={item.id}>{item.name.zh_hans ?? item.name.en}</option>)}</select></label>
              <button type="button" disabled={!customTitle.trim()} onClick={add}>添加到黎明之前</button>
            </fieldset>
          </details>

          <div className="night-effects">
            <h3>持续效果提醒 <small>{pendingEffects.length} 待核对</small></h3>
            <p className="night-help">按「持续到」文本人工判断到期时间。每夜重新核对；确认到期后才移除标记。</p>
            {!effects.length && <p className="night-help">暂无设置了「持续到」的标记，可在玩家检查器中添加。</p>}
            {effects.map(({ seat: effectSeat, marker, key }) => {
              const reviewed = checklist.reviewed_effects.includes(key);
              return <div className="night-effect" key={key}>
                <b>{effectSeat.position} 号 {effectSeat.player_name} · {marker.label}</b>
                <p>持续到：{marker.expires}{marker.note && ` · ${marker.note}`}</p>
                <div className="night-actions">
                  <button type="button" disabled={locked || reviewed} onClick={() => onUpdate((current) => reviewEffect(current, key, false))}>{reviewed ? "已核对 · 保留" : "尚未到期 · 保留"}</button>
                  <button type="button" disabled={locked} onClick={() => onUpdate((current) => reviewEffect(current, key, true))}>已到期 · 移除标记</button>
                </div>
              </div>;
            })}
          </div>
          <button type="button" className="night-finish night-primary" disabled={readOnly || !canFinishNight(game)} onClick={() => onUpdate(finishNight)}>
            <Sun size={14} /> 完成夜晚 · 进入白天
          </button>
          {active && <p className="night-help">完成或跳过全部步骤，并核对持续效果后可进入白天。</p>}
        </>
      )}
      <div className="source-links">
        {script.sources.nightsheet && <a href={script.sources.nightsheet} target="_blank" rel="noreferrer">TPI 官方夜序 ↗</a>}
        <a href={script.sources.english_roles} target="_blank" rel="noreferrer">英文原文 ↗</a>
        <a href={script.sources.zh_hans} target="_blank" rel="noreferrer">官方中文 ↗</a>
      </div>
    </section>
  );
}
