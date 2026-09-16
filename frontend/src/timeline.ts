import type { EventDetails, GameDraft, ManualEventKind, Script, TimelineEntry } from "./types";
import { executionStanding, playerLabel, voteTotal } from "./voting.ts";

export const EVENT_LABELS = {
  initial: "起点", change: "局面变化", note: "说书人记录", branch: "分支",
  action: "行动", information: "信息", death: "死亡", revival: "复活", role_change: "角色变化",
  phase: "阶段变化", undo: "撤销", redo: "重做",
};
export type EventCategory = keyof typeof EVENT_LABELS;

/** Derive state changes from snapshots, including older untyped histories. */
export function eventCategories(entry: TimelineEntry, previous?: TimelineEntry): EventCategory[] {
  const categories: EventCategory[] = [entry.kind];
  if (!previous) return categories;
  if (entry.snapshot.phase !== previous.snapshot.phase || entry.snapshot.day_number !== previous.snapshot.day_number) {
    categories.push("phase");
  }
  for (const seat of entry.snapshot.seats) {
    const before = previous.snapshot.seats.find((item) => item.id === seat.id);
    if (!before) continue;
    if (before.alive !== seat.alive) categories.push(seat.alive ? "revival" : "death");
    if (before.role_id !== seat.role_id) categories.push("role_change");
  }
  return [...new Set(categories)];
}

/** Group consecutive phases, so revisiting a phase never reorders history. */
export function timelineChapters(entries: TimelineEntry[]) {
  const chapters: { id: string; label: string; start: number; end: number }[] = [];
  entries.forEach((entry, index) => {
    const previous = entries[index - 1]?.snapshot;
    if (!previous || previous.phase !== entry.snapshot.phase || previous.day_number !== entry.snapshot.day_number) {
      chapters.push({ id: entry.id, label: phaseLabel(entry.snapshot), start: index, end: index });
    } else {
      chapters[chapters.length - 1].end = index;
    }
  });
  return chapters;
}

export function createManualEntry(snapshot: GameDraft, kind: ManualEventKind, note: string, details: EventDetails): TimelineEntry {
  const entry = createEntry(snapshot, EVENT_LABELS[kind], kind, note.trim());
  if (kind !== "note") entry.details = structuredClone(details);
  return entry;
}

export function eventParticipants(entry: TimelineEntry): string {
  if (!entry.details) return "";
  const name = (id: string) => {
    const seat = entry.snapshot.seats.find((item) => item.id === id);
    return seat ? `${seat.position} 号 ${seat.player_name}` : id;
  };
  const actor = entry.details.actor_seat_id ? name(entry.details.actor_seat_id) : "说书人";
  const targets = entry.details.target_seat_ids.map(name).join("、");
  return targets ? `${actor} → ${targets}` : actor;
}

export function phaseLabel(game: Pick<GameDraft, "phase" | "day_number">): string {
  if (game.phase === "setup") return "配置中";
  if (game.phase === "first_night") return "首夜";
  if (game.phase === "finished") return "已结束";
  return `第 ${game.day_number} ${game.phase === "day" ? "天" : "夜"}`;
}

export function createEntry(
  snapshot: GameDraft,
  summary: string,
  kind: TimelineEntry["kind"] = "change",
  note = "",
  metadata: Pick<TimelineEntry, "id" | "recorded_at"> = { id: crypto.randomUUID(), recorded_at: new Date().toISOString() },
): TimelineEntry {
  return { ...metadata, kind, summary, note, snapshot: structuredClone(snapshot) };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function describeChange(before: GameDraft, after: GameDraft, scripts: Script[]) {
  const changes: string[] = [];
  const textKeys: string[] = [];
  const roleName = (id: string | null) => {
    if (!id) return "未分配";
    const role = scripts.flatMap((script) => [...script.roles, ...script.travellers])
      .find((item) => item.id === id);
    return role?.name.zh_hans ?? role?.name.en ?? id;
  };
  const addText = (key: string, label: string) => {
    textKeys.push(key);
    changes.push(label);
  };
  if (before.name !== after.name) addText("name", `局名：${after.name || "未命名"}`);
  if (before.script_id !== after.script_id) {
    changes.push(`切换剧本：${scripts.find((s) => s.id === after.script_id)?.name.zh_hans ?? after.script_id}`);
  }
  if (before.player_count !== after.player_count) {
    changes.push(`玩家人数：${before.player_count} → ${after.player_count}`);
  }
  if (before.phase !== after.phase || before.day_number !== after.day_number) {
    changes.push(`阶段：${phaseLabel(before)} → ${phaseLabel(after)}`);
  }
  if (!same(before.composition, after.composition)) changes.push("调整角色配比");
  if (before.notes !== after.notes) addText("notes", "更新全局备注");
  for (const nomination of after.nominations) {
    const previous = before.nominations.find((n) => n.id === nomination.id);
    const label = `${playerLabel(nomination.nominator)} 提名 ${playerLabel(nomination.nominee)}`;
    if (!previous) changes.push(`提名：${label}`);
    else {
      for (const vote of nomination.votes) {
        const old = previous.votes.find((v) => v.player.id === vote.player.id);
        if (!same(old, vote)) changes.push(`${playerLabel(vote.player)} → ${playerLabel(nomination.nominee)}：${
          vote.choice === "yes" ? `投票（${vote.weight} 票${vote.dead_vote ? "，亡者票" : ""}）` :
          vote.choice === "no" ? "未投票" : "改为未记录"
        }`);
      }
      if (previous.status !== nomination.status) changes.push(nomination.status === "closed"
        ? `投票结束：${label}，${voteTotal(nomination)} 票 / 门槛 ${Math.ceil(nomination.alive_count / 2)}`
        : `取消投票：${label}`);
    }
  }
  const oldStanding = executionStanding(before);
  const standing = executionStanding(after);
  if (!same(oldStanding, standing)) changes.push(standing.candidate
    ? `待处决：${playerLabel(standing.candidate)}（${standing.high} 票）`
    : standing.tied ? `最高票平票（${standing.high} 票），无人待处决` : "无人待处决");
  if (before.public_information !== after.public_information) addText("public_information", "更新公开信息");

  if (!same(before.night_checklist ?? null, after.night_checklist ?? null)) {
    const old = before.night_checklist;
    const next = after.night_checklist;
    if (next && old?.id !== next.id) changes.push(`建立${phaseLabel(next)}清单`);
    else if (old && next) {
      if (!same(old.steps.map((step) => step.id), next.steps.map((step) => step.id))) {
        changes.push("调整夜间步骤");
      }
      for (const step of next.steps) {
        const previous = old.steps.find((item) => item.id === step.id);
        if (!previous) continue;
        if (previous.status !== step.status) {
          const label = { pending: "重新打开", completed: "完成", skipped: "跳过" };
          changes.push(`${label[step.status]}夜间步骤：${step.title}`);
        }
        for (const [field, label] of [["choice", "玩家选择"], ["information", "收到的信息"], ["decision", "说书人决定"]] as const) {
          if (previous[field] !== step[field]) addText(`night.${step.id}.${field}`, `${step.title}：记录${label}`);
        }
      }
      if (!same(old.reviewed_effects, next.reviewed_effects)) changes.push("核对夜间持续效果");
    } else changes.push("更新夜间清单");
  }
  const alignments = { good: "善良", evil: "邪恶", unknown: "未知" };
  for (const seat of after.seats) {
    const previous = before.seats.find((item) => item.id === seat.id);
    if (!previous) continue;
    const name = `${seat.position} 号 ${seat.player_name}`;
    if (previous.player_name !== seat.player_name) {
      addText(`${seat.id}.name`, `${previous.player_name || "玩家"} 更名为 ${seat.player_name || "未命名"}`);
    }
    if (previous.position !== seat.position) changes.push(`${seat.player_name}：${previous.position} → ${seat.position} 号座位`);
    if (previous.role_id !== seat.role_id) changes.push(`${name}：${roleName(previous.role_id)} → ${roleName(seat.role_id)}`);
    if (previous.shown_role_id !== seat.shown_role_id) changes.push(`${name} 展示角色：${roleName(previous.shown_role_id)} → ${roleName(seat.shown_role_id)}`);
    if (previous.shown_alignment !== seat.shown_alignment) changes.push(`${name}：更新告知阵营`);
    if (previous.public_claim !== seat.public_claim) addText(`${seat.id}.public_claim`, `${name}：更新公开声明`);
    if (previous.private_information !== seat.private_information) addText(`${seat.id}.private_information`, `${name}：更新私人信息`);
    if (previous.alive !== seat.alive) changes.push(`${name} ${seat.alive ? "复活" : "死亡"}`);
    if (previous.dead_vote_available !== seat.dead_vote_available) changes.push(`${name}：亡者票${seat.dead_vote_available ? "恢复" : "已用"}`);
    if (previous.alignment !== seat.alignment) changes.push(`${name} 阵营：${alignments[previous.alignment]} → ${alignments[seat.alignment]}`);
    if (previous.notes !== seat.notes) addText(`${seat.id}.notes`, `${name}：更新玩家备注`);
    for (const marker of seat.markers) {
      const old = previous.markers.find((item) => item.id === marker.id);
      if (!old) changes.push(`${name}：添加「${marker.label}」`);
      else if (!same(old, marker)) {
        const fields = (Object.keys(marker) as Array<keyof typeof marker>).filter((key) => old[key] !== marker[key]);
        if (fields.length === 1 && ["label", "note", "expires"].includes(fields[0])) {
          addText(`${seat.id}.${marker.id}.${fields[0]}`, `${name}：更新「${marker.label}」标记`);
        } else changes.push(`${name}：更新「${marker.label}」标记`);
      }
    }
    for (const marker of previous.markers) {
      if (!seat.markers.some((item) => item.id === marker.id)) changes.push(`${name}：移除「${marker.label}」`);
    }
  }
  return {
    summary: (changes.join("；") || "更新局面").slice(0, 500),
    mergeKey: changes.length === 1 && textKeys.length === 1 ? textKeys[0] : null,
  };
}

/** Coalesce only adjacent unsaved typing; discrete actions and saved history stay intact. */
export function recordChange(
  timeline: TimelineEntry[],
  next: GameDraft,
  scripts: Script[],
  metadata: Pick<TimelineEntry, "id" | "recorded_at"> = { id: crypto.randomUUID(), recorded_at: new Date().toISOString() },
  protectedLength = 0,
): TimelineEntry[] {
  const last = timeline[timeline.length - 1];
  if (!last) return [createEntry(next, "开始记录", "initial", "", metadata)];
  if (same(last.snapshot, next)) return timeline;
  const change = describeChange(last.snapshot, next, scripts);
  const previous = timeline[timeline.length - 2];
  const elapsed = Date.parse(metadata.recorded_at) - Date.parse(last.recorded_at);
  if (previous && last.kind === "change" && timeline.length > protectedLength &&
      change.mergeKey && elapsed >= 0 && elapsed < 1500 &&
      describeChange(previous.snapshot, last.snapshot, scripts).mergeKey === change.mergeKey) {
    return [...timeline.slice(0, -1), createEntry(next, describeChange(previous.snapshot, next, scripts).summary,
      "change", "", { ...metadata, id: last.id })];
  }
  return [...timeline, createEntry(next, change.summary, "change", "", metadata)];
}
