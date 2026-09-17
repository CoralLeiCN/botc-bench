import { localizedText, translate, type Language } from "./language.ts";
import type { EventAudience, EventDetails, GameDraft, ManualEventKind, Script, TimelineEntry } from "./types";
import { nightStepTitle } from "./night.ts";
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
export function timelineChapters(entries: TimelineEntry[], language: Language = "zh_hans") {
  const chapters: { id: string; label: string; start: number; end: number }[] = [];
  entries.forEach((entry, index) => {
    const previous = entries[index - 1]?.snapshot;
    if (!previous || previous.phase !== entry.snapshot.phase || previous.day_number !== entry.snapshot.day_number) {
      chapters.push({ id: entry.id, label: phaseLabel(entry.snapshot, language), start: index, end: index });
    } else {
      chapters[chapters.length - 1].end = index;
    }
  });
  return chapters;
}

export function createManualEntry(
  snapshot: GameDraft, kind: ManualEventKind, note: string, details: EventDetails,
  audience: EventAudience = { visibility: "storyteller", recipient_seat_ids: [] },
): TimelineEntry {
  const entry = createEntry(snapshot, EVENT_LABELS[kind], kind, note.trim());
  if (kind !== "note") entry.details = structuredClone(details);
  entry.audience = structuredClone(audience);
  return entry;
}

export function eventAudienceLabel(entry: TimelineEntry, language: Language = "zh_hans"): string {
  if (!entry.audience || entry.audience.visibility === "storyteller") return translate(language, "仅说书人");
  if (entry.audience.visibility === "public") return translate(language, "所有玩家可见");
  const names = entry.audience.recipient_seat_ids.map((id) => {
    const seat = entry.snapshot.seats.find((item) => item.id === id);
    return seat ? playerLabel(seat, language) : id;
  }).join(language === "en" ? ", " : "、");
  return translate(language, "仅指定玩家可见：{0}", [names]);
}

export function eventParticipants(entry: TimelineEntry, language: Language = "zh_hans"): string {
  if (!entry.details) return "";
  const name = (id: string) => {
    const seat = entry.snapshot.seats.find((item) => item.id === id);
    return seat ? playerLabel(seat, language) : id;
  };
  const actor = entry.details.actor_seat_id ? name(entry.details.actor_seat_id) : translate(language, "说书人");
  const targets = entry.details.target_seat_ids.map(name).join(language === "en" ? ", " : "、");
  return targets ? `${actor} → ${targets}` : actor;
}

export function phaseLabel(game: Pick<GameDraft, "phase" | "day_number">, language: Language = "zh_hans"): string {
  if (game.phase === "setup") return translate(language, "配置中");
  if (game.phase === "first_night") return translate(language, "首夜");
  if (game.phase === "finished") return translate(language, "已结束");
  return language === "en" ? `${game.phase === "day" ? "Day" : "Night"} ${game.day_number}` : `第 ${game.day_number} ${game.phase === "day" ? "天" : "夜"}`;
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

function describeChange(before: GameDraft, after: GameDraft, scripts: Script[], language: Language = "zh_hans") {
  const t = (message: string, values?: readonly (string | number)[]) => translate(language, message, values);
  const changes: string[] = [];
  const textKeys: string[] = [];
  const roleName = (id: string | null) => {
    if (!id) return t("未分配");
    const role = scripts.flatMap((script) => [...script.roles, ...script.travellers])
      .find((item) => item.id === id);
    return localizedText(role?.name, language, id);
  };
  const stepTitle = (step: NonNullable<GameDraft["night_checklist"]>["steps"][number]) => {
    const script = scripts.find((item) => item.id === after.script_id);
    return language === "en" && script ? nightStepTitle(step, after, script, language) : step.title;
  };
  const addText = (key: string, label: string) => {
    textKeys.push(key);
    changes.push(label);
  };
  if (before.name !== after.name) addText("name", t("局名：{0}", [after.name || t("未命名")]));
  if (before.script_id !== after.script_id) {
    changes.push(t("切换剧本：{0}", [localizedText(scripts.find((s) => s.id === after.script_id)?.name, language, after.script_id)]));
  }
  if (before.player_count !== after.player_count) {
    changes.push(t("玩家人数：{0} → {1}", [before.player_count, after.player_count]));
  }
  if (before.phase !== after.phase || before.day_number !== after.day_number) {
    changes.push(t("阶段：{0} → {1}", [phaseLabel(before, language), phaseLabel(after, language)]));
  }
  if (!same(before.composition, after.composition)) changes.push(t("调整角色配比"));
  if (before.notes !== after.notes) addText("notes", t("更新全局备注"));
  for (const nomination of after.nominations) {
    const previous = before.nominations.find((n) => n.id === nomination.id);
    const label = t("{0} 提名 {1}", [playerLabel(nomination.nominator, language), playerLabel(nomination.nominee, language)]);
    if (!previous) changes.push(t("提名：{0}", [label]));
    else {
      for (const vote of nomination.votes) {
        const old = previous.votes.find((v) => v.player.id === vote.player.id);
        if (!same(old, vote)) changes.push(`${playerLabel(vote.player, language)} → ${playerLabel(nomination.nominee, language)}：${
          vote.choice === "yes" ? t("投票（{0} 票{1}）", [vote.weight, vote.dead_vote ? t("，亡者票") : ""]) :
          vote.choice === "no" ? t("未投票") : t("改为未记录")
        }`);
      }
      if (previous.status !== nomination.status) changes.push(nomination.status === "closed"
        ? t("投票结束：{0}，{1} 票 / 门槛 {2}", [label, voteTotal(nomination), Math.ceil(nomination.alive_count / 2)])
        : t("取消投票：{0}", [label]));
    }
  }
  const oldStanding = executionStanding(before);
  const standing = executionStanding(after);
  if (!same(oldStanding, standing)) changes.push(standing.candidate
    ? t("待处决：{0}（{1} 票）", [playerLabel(standing.candidate, language), standing.high])
    : standing.tied ? t("最高票平票（{0} 票），无人待处决", [standing.high]) : t("无人待处决"));
  if (before.public_information !== after.public_information) addText("public_information", t("更新公开信息"));

  if (!same(before.night_checklist ?? null, after.night_checklist ?? null)) {
    const old = before.night_checklist;
    const next = after.night_checklist;
    if (next && old?.id !== next.id) changes.push(t("建立{0}清单", [phaseLabel(next, language)]));
    else if (old && next) {
      if (!same(old.steps.map((step) => step.id), next.steps.map((step) => step.id))) {
        changes.push(t("调整夜间步骤"));
      }
      for (const step of next.steps) {
        const previous = old.steps.find((item) => item.id === step.id);
        if (!previous) continue;
        if (previous.status !== step.status) {
          const label = { pending: t("重新打开"), completed: t("完成"), skipped: t("跳过") };
          changes.push(t("{0}夜间步骤：{1}", [label[step.status], stepTitle(step)]));
        }
        for (const [field, label] of [["choice", t("玩家选择")], ["information", t("收到的信息")], ["decision", t("说书人决定")]] as const) {
          if (previous[field] !== step[field]) addText(`night.${step.id}.${field}`, t("{0}：记录{1}", [stepTitle(step), label]));
        }
      }
      if (!same(old.reviewed_effects, next.reviewed_effects)) changes.push(t("核对夜间持续效果"));
    } else changes.push(t("更新夜间清单"));
  }
  const alignments = { good: t("善良"), evil: t("邪恶"), unknown: t("未知") };
  for (const seat of after.seats) {
    const previous = before.seats.find((item) => item.id === seat.id);
    if (!previous) continue;
    const name = t("{0} 号 {1}", [seat.position, seat.player_name]);
    if (previous.player_name !== seat.player_name) {
      addText(`${seat.id}.name`, t("{0} 更名为 {1}", [previous.player_name || t("玩家"), seat.player_name || t("未命名")]));
    }
    if (previous.position !== seat.position) changes.push(t("{0}：{1} → {2} 号座位", [seat.player_name, previous.position, seat.position]));
    if (previous.role_id !== seat.role_id) changes.push(`${name}：${roleName(previous.role_id)} → ${roleName(seat.role_id)}`);
    if (previous.shown_role_id !== seat.shown_role_id) changes.push(t("{0} 展示角色：{1} → {2}", [name, roleName(previous.shown_role_id), roleName(seat.shown_role_id)]));
    if (previous.shown_alignment !== seat.shown_alignment) changes.push(t("{0}：更新告知阵营", [name]));
    if (previous.public_claim !== seat.public_claim) addText(`${seat.id}.public_claim`, t("{0}：更新公开声明", [name]));
    if (previous.private_information !== seat.private_information) addText(`${seat.id}.private_information`, t("{0}：更新私人信息", [name]));
    if (previous.alive !== seat.alive) changes.push(`${name} ${seat.alive ? t("复活") : t("死亡")}`);
    if (previous.dead_vote_available !== seat.dead_vote_available) changes.push(t("{0}：亡者票{1}", [name, seat.dead_vote_available ? t("恢复") : t("已用")]));
    if (previous.alignment !== seat.alignment) changes.push(t("{0} 阵营：{1} → {2}", [name, alignments[previous.alignment], alignments[seat.alignment]]));
    if (previous.notes !== seat.notes) addText(`${seat.id}.notes`, t("{0}：更新玩家备注", [name]));
    for (const marker of seat.markers) {
      const old = previous.markers.find((item) => item.id === marker.id);
      if (!old) changes.push(t("{0}：添加「{1}」", [name, marker.label]));
      else if (!same(old, marker)) {
        const fields = (Object.keys(marker) as Array<keyof typeof marker>).filter((key) => old[key] !== marker[key]);
        if (fields.length === 1 && ["label", "note", "expires"].includes(fields[0])) {
          addText(`${seat.id}.${marker.id}.${fields[0]}`, t("{0}：更新「{1}」标记", [name, marker.label]));
        } else changes.push(t("{0}：更新「{1}」标记", [name, marker.label]));
      }
    }
    for (const marker of previous.markers) {
      if (!seat.markers.some((item) => item.id === marker.id)) changes.push(t("{0}：移除「{1}」", [name, marker.label]));
    }
  }
  return {
    summary: (changes.join(language === "en" ? "; " : "；") || t("更新局面")).slice(0, 500),
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

/** Re-render only recognized generated summaries; custom/imported text stays verbatim. */
export function timelineSummary(entry: TimelineEntry, previous: TimelineEntry | undefined, scripts: Script[], language: Language): string {
  if (entry.kind === "change" && previous) {
    const chinese = describeChange(previous.snapshot, entry.snapshot, scripts).summary;
    const english = describeChange(previous.snapshot, entry.snapshot, scripts, "en").summary;
    if (entry.summary === chinese || entry.summary === english) return language === "en" ? english : chinese;
  }
  const standard = ["开始记录", "撤销局面修改", "重做局面修改", ...Object.values(EVENT_LABELS)];
  const key = standard.find((message) => entry.summary === message || entry.summary === translate("en", message));
  return key ? translate(language, key) : entry.summary;
}
