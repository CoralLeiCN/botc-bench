import type { GameDraft, Marker, NightChecklist, NightPhase, NightStep, Script } from "./types";

export function isCurrentNight(game: GameDraft): boolean {
  const checklist = game.night_checklist;
  return Boolean(checklist && checklist.script_id === game.script_id &&
    checklist.phase === game.phase && checklist.day_number === game.day_number);
}

export function nextNightStep(game: GameDraft): NightStep | null {
  return isCurrentNight(game)
    ? game.night_checklist?.steps.find((step) => step.status === "pending") ?? null
    : null;
}

/** Group information is delivered together; highlight every participant. */
export function nightStepSeats(game: GameDraft, script: Script, step: NightStep | null): string[] {
  if (!step) return [];
  if (step.seat_id) return game.seats.some((seat) => seat.id === step.seat_id) ? [step.seat_id] : [];
  const team = step.instruction_id === "minioninfo" ? "minion"
    : step.instruction_id === "demoninfo" ? "demon" : null;
  if (!team) return [];
  const roles = [...script.roles, ...script.travellers];
  return game.seats.filter((seat) => roles.find((role) => role.id === seat.role_id)?.team === team)
    .map((seat) => seat.id);
}

export function newNightStep(title: string, seatId: string | null = null, instructionId: string | null = null): NightStep {
  return {
    id: crypto.randomUUID(), instruction_id: instructionId, seat_id: seatId, title,
    status: "pending", choice: "", information: "", decision: "",
  };
}

export function createNightChecklist(game: GameDraft, script: Script, phase: NightPhase, dayNumber: number): NightChecklist {
  const steps: NightStep[] = [];
  const roles = [...script.roles, ...script.travellers];
  const coreCount = game.seats.filter((seat) =>
    roles.find((role) => role.id === seat.role_id)?.team !== "traveller").length;
  for (const instruction of script.night_order?.[phase] ?? []) {
    const title = instruction.name.zh_hans ?? instruction.name.en ?? instruction.id;
    if (["dusk", "dawn", "minioninfo", "demoninfo"].includes(instruction.id)) {
      if (["minioninfo", "demoninfo"].includes(instruction.id) && coreCount < 7) continue;
      steps.push(newNightStep(title, null, instruction.id));
    } else {
      // Keep dead and impaired players for explicit review: triggered abilities and
      // retained abilities cannot be inferred safely from the alive flag alone.
      for (const seat of [...game.seats].sort((a, b) => a.position - b.position)) {
        if (seat.role_id === instruction.id) {
          steps.push(newNightStep(`${seat.player_name || `${seat.position} 号`} · ${title}`, seat.id, instruction.id));
        }
      }
    }
  }
  if (!steps.length) steps.push(newNightStep("说书人：确认夜间行动顺序"));
  return {
    id: crypto.randomUUID(), script_id: script.id, phase, day_number: dayNumber,
    steps, reviewed_effects: [],
  };
}

export function updateNightStep(game: GameDraft, stepId: string, patch: Partial<Pick<NightStep, "choice" | "information" | "decision" | "status">>): GameDraft {
  if (!isCurrentNight(game) || !game.night_checklist) return game;
  return { ...game, night_checklist: { ...game.night_checklist,
    steps: game.night_checklist.steps.map((step) => {
      if (step.id !== stepId) return step;
      const next = { ...step, ...patch };
      return next.status === "skipped" && !next.decision.trim() ? step : next;
    }),
  } };
}

export function moveNightStep(game: GameDraft, stepId: string, direction: -1 | 1): GameDraft {
  if (!isCurrentNight(game) || !game.night_checklist) return game;
  const steps = [...game.night_checklist.steps];
  const index = steps.findIndex((step) => step.id === stepId);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= steps.length) return game;
  [steps[index], steps[target]] = [steps[target], steps[index]];
  return { ...game, night_checklist: { ...game.night_checklist, steps } };
}

export function addNightStep(game: GameDraft, step: NightStep): GameDraft {
  if (!isCurrentNight(game) || !game.night_checklist || game.night_checklist.steps.length >= 200) return game;
  const steps = [...game.night_checklist.steps];
  const dawn = steps.findIndex((item) => item.instruction_id === "dawn");
  steps.splice(dawn < 0 ? steps.length : dawn, 0, step);
  return { ...game, night_checklist: { ...game.night_checklist, steps } };
}

/** Add newly assigned actions without discarding any completed or edited records. */
export function syncNightSteps(game: GameDraft, script: Script): GameDraft {
  if (!isCurrentNight(game) || !game.night_checklist) return game;
  const checklist = game.night_checklist;
  const generated = createNightChecklist(game, script, checklist.phase, checklist.day_number);
  const steps = [...checklist.steps];
  const order = script.night_order?.[checklist.phase] ?? [];
  const rank = (step: NightStep) => order.findIndex((item) => item.id === step.instruction_id);
  for (const step of generated.steps) {
    if (steps.length >= 200) break;
    if (steps.some((item) => item.instruction_id === step.instruction_id && item.seat_id === step.seat_id)) continue;
    const index = steps.findIndex((item) => rank(item) > rank(step));
    steps.splice(index < 0 ? steps.length : index, 0, step);
  }
  return { ...game, night_checklist: { ...checklist, steps } };
}

export function effectKey(seatId: string, marker: Marker): string {
  return JSON.stringify([seatId, marker.id, marker.type, marker.label, marker.source_role_id, marker.expires, marker.note]);
}

export function expiringEffects(game: GameDraft) {
  return game.seats.flatMap((seat) => seat.markers.filter((marker) => marker.expires?.trim())
    .map((marker) => ({ seat, marker, key: effectKey(seat.id, marker) })));
}

export function reviewEffect(game: GameDraft, key: string, remove: boolean): GameDraft {
  if (!isCurrentNight(game) || !game.night_checklist) return game;
  const effect = expiringEffects(game).find((item) => item.key === key);
  if (!effect) return game;
  return {
    ...game,
    seats: remove ? game.seats.map((seat) => seat.id === effect.seat.id
      ? { ...seat, markers: seat.markers.filter((marker) => marker.id !== effect.marker.id) } : seat) : game.seats,
    night_checklist: { ...game.night_checklist,
      reviewed_effects: [...new Set([...game.night_checklist.reviewed_effects, key])],
    },
  };
}

export function canFinishNight(game: GameDraft): boolean {
  return isCurrentNight(game) && Boolean(game.night_checklist?.steps.every((step) => step.status !== "pending")) &&
    expiringEffects(game).every((effect) => game.night_checklist?.reviewed_effects.includes(effect.key));
}

export function finishNight(game: GameDraft): GameDraft {
  return canFinishNight(game) ? { ...game, phase: "day" } : game;
}
