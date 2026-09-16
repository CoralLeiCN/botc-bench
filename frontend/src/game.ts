import { localizedText, translate, type Language } from "./language.ts";
import type {
  Composition,
  GameDraft,
  Marker,
  Role,
  Script,
  Seat,
  Team,
  ValidationIssue,
} from "./types";

export const TEAM_LABELS: Record<Team, string> = {
  townsfolk: "镇民",
  outsider: "外来者",
  minion: "爪牙",
  demon: "恶魔",
  traveller: "旅行者",
};

export const TEAM_SHORT: Record<Team, string> = {
  townsfolk: "镇",
  outsider: "外",
  minion: "爪",
  demon: "魔",
  traveller: "旅",
};

export function allRoles(script: Script): Role[] {
  return [...script.roles, ...script.travellers];
}

const STANDARD_COMPOSITIONS: Record<number, Omit<Composition, "manual">> = {
  5: { townsfolk: 3, outsider: 0, minion: 1, demon: 1, traveller: 0 },
  6: { townsfolk: 3, outsider: 1, minion: 1, demon: 1, traveller: 0 },
  7: { townsfolk: 5, outsider: 0, minion: 1, demon: 1, traveller: 0 },
  8: { townsfolk: 5, outsider: 1, minion: 1, demon: 1, traveller: 0 },
  9: { townsfolk: 5, outsider: 2, minion: 1, demon: 1, traveller: 0 },
  10: { townsfolk: 7, outsider: 0, minion: 2, demon: 1, traveller: 0 },
  11: { townsfolk: 7, outsider: 1, minion: 2, demon: 1, traveller: 0 },
  12: { townsfolk: 7, outsider: 2, minion: 2, demon: 1, traveller: 0 },
  13: { townsfolk: 9, outsider: 0, minion: 3, demon: 1, traveller: 0 },
  14: { townsfolk: 9, outsider: 1, minion: 3, demon: 1, traveller: 0 },
  15: { townsfolk: 9, outsider: 2, minion: 3, demon: 1, traveller: 0 },
};

const SETUP_OUTSIDER_DELTAS: Record<string, number> = {
  baron: 2,
  fanggu: 1,
  vigormortis: -1,
};

export function setupModifierRoleIds(roleIds: Array<string | null>): string[] {
  return [...new Set(roleIds.filter((id): id is string => Boolean(id && id in SETUP_OUTSIDER_DELTAS)))];
}

export function suggestedComposition(
  playerCount: number,
  roleIds: Array<string | null> = [],
  travellerRoleIds: string[] = [],
): Composition {
  const travellerIds = new Set(travellerRoleIds);
  const assignedTravellers = roleIds.filter((roleId) => roleId && travellerIds.has(roleId)).length;
  const travellerCount = Math.min(
    Math.max(0, playerCount - 5),
    Math.max(0, playerCount - 15, assignedTravellers),
  );
  const coreCount = playerCount - travellerCount;
  const core = STANDARD_COMPOSITIONS[coreCount];
  const composition = {
    ...core,
    traveller: travellerCount,
    manual: false,
  };
  for (const roleId of setupModifierRoleIds(roleIds)) {
    const requestedDelta = SETUP_OUTSIDER_DELTAS[roleId];
    const actualDelta = Math.max(
      -composition.outsider,
      Math.min(composition.townsfolk, requestedDelta),
    );
    composition.outsider += actualDelta;
    composition.townsfolk -= actualDelta;
  }
  return {
    ...composition,
  };
}

export function newSeat(position: number, language: Language = "zh_hans"): Seat {
  return {
    id: crypto.randomUUID(),
    position,
    player_name: translate(language, "玩家 {0}", [position]),
    role_id: null,
    shown_role_id: null,
    shown_alignment: "unknown",
    public_claim: "",
    private_information: "",
    alive: true,
    dead_vote_available: true,
    alignment: "unknown",
    markers: [],
    notes: "",
  };
}

export function createDraft(script: Script, playerCount = 7, language: Language = "zh_hans"): GameDraft {
  return {
    schema_version: 1,
    name: `${localizedText(script.name, language)} · ${translate(language, "新局")}`,
    script_id: script.id,
    player_count: playerCount,
    composition: suggestedComposition(playerCount),
    seats: Array.from({ length: playerCount }, (_, index) => newSeat(index + 1, language)),
    phase: "setup",
    day_number: 0,
    notes: "",
    nominations: [],
    public_information: "",
  };
}

export function resizeSeats(seats: Seat[], playerCount: number, language: Language = "zh_hans"): Seat[] {
  const next = seats.slice(0, playerCount).map((seat, index) => ({
    ...seat,
    position: index + 1,
  }));
  while (next.length < playerCount) next.push(newSeat(next.length + 1, language));
  return next;
}

export function marker(type: Marker["type"], label: string): Marker {
  return {
    id: crypto.randomUUID(),
    type,
    label,
    source_role_id: null,
    expires: null,
    note: "",
  };
}

export function assignedCounts(seats: Seat[], roles: Role[]): Record<Team, number> {
  const roleById = new Map(roles.map((role) => [role.id, role]));
  const counts: Record<Team, number> = {
    townsfolk: 0,
    outsider: 0,
    minion: 0,
    demon: 0,
    traveller: 0,
  };
  for (const seat of seats) {
    const role = seat.role_id ? roleById.get(seat.role_id) : undefined;
    if (role) counts[role.team] += 1;
  }
  return counts;
}

export function compositionTotal(composition: Composition): number {
  return (
    composition.townsfolk +
    composition.outsider +
    composition.minion +
    composition.demon +
    composition.traveller
  );
}

export function validateDraft(game: GameDraft, script: Script, language: Language = "zh_hans"): ValidationIssue[] {
  const t = (message: string, values?: readonly (string | number)[]) => translate(language, message, values);
  const issues: ValidationIssue[] = [];
  const availableRoles = allRoles(script);
  const roleById = new Map(availableRoles.map((role) => [role.id, role]));
  const counts = assignedCounts(game.seats, availableRoles);
  const unassigned = game.seats.filter((seat) => !seat.role_id).length;
  const duplicates = new Map<string, number>();

  if (compositionTotal(game.composition) !== game.player_count) {
    issues.push({ level: "error", message: t("角色配比总数与玩家数不一致") });
  }
  for (const seat of game.seats) {
    if (seat.role_id && !roleById.has(seat.role_id)) {
      issues.push({ level: "error", message: t("{0} 的角色不属于当前剧本", [seat.player_name]) });
    }
    if (seat.role_id) duplicates.set(seat.role_id, (duplicates.get(seat.role_id) ?? 0) + 1);
    if (seat.shown_role_id && !roleById.has(seat.shown_role_id)) {
      issues.push({ level: "error", message: t("{0} 的展示角色不属于当前剧本", [seat.player_name]) });
    }
    if (seat.role_id === "drunk" && roleById.get(seat.shown_role_id ?? "")?.team !== "townsfolk") {
      issues.push({ level: "warning", message: t("{0} 的酒鬼身份需要另行设置展示的镇民角色", [seat.player_name]) });
    }
  }
  for (const [roleId, count] of duplicates) {
    if (count > 1) {
      const role = roleById.get(roleId);
      issues.push({
        level: "warning",
        message: t("{0} 被分配了 {1} 次", [localizedText(role?.name, language, roleId), count]),
      });
    }
  }
  if (unassigned > 0) {
    issues.push({ level: "warning", message: t("还有 {0} 个座位未分配角色", [unassigned]) });
  }
  const targets: Array<[Team, number]> = [
    ["townsfolk", game.composition.townsfolk],
    ["outsider", game.composition.outsider],
    ["minion", game.composition.minion],
    ["demon", game.composition.demon],
    ["traveller", game.composition.traveller],
  ];
  for (const [team, target] of targets) {
    if (counts[team] > target) {
      issues.push({
        level: "warning",
        message: t("{0}已分配 {1}，超过配比 {2}", [translate(language, TEAM_LABELS[team]), counts[team], target]),
      });
    }
  }
  const setupRoles = game.seats
    .map((seat) => (seat.role_id ? roleById.get(seat.role_id) : undefined))
    .filter((role): role is Role => Boolean(role?.setup));
  for (const role of setupRoles) {
    issues.push({
      level: "warning",
      message: t("{0} 的配置影响：{1}", [localizedText(role.name, language), localizedText(role.setup_effect, language, localizedText(role.ability, language))]),
    });
  }
  return issues;
}

export function hasSeatData(seat: Seat): boolean {
  return Boolean(
    seat.role_id ||
      seat.shown_role_id ||
      seat.shown_alignment !== "unknown" ||
      seat.public_claim ||
      seat.private_information ||
      seat.markers.length ||
      seat.notes ||
      !seat.alive ||
      !seat.dead_vote_available ||
      seat.alignment !== "unknown" ||
      (seat.player_name !== `玩家 ${seat.position}` && seat.player_name !== `Player ${seat.position}`),
  );
}
