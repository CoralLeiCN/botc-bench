import type { GameDraft, Script, TimelineEntry } from "./types";

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
    if (previous.alive !== seat.alive) changes.push(`${name} ${seat.alive ? "复活" : "死亡"}`);
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
