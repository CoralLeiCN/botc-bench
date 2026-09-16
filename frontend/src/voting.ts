import { translate, type Language } from "./language.ts";
import type { GameDraft, IndividualVote, Nomination, PlayerRef, Script, Seat } from "./types";

// Standard-rule implementation sources and verification date: reference/voting-sources.json.

const playerRef = ({ id, position, player_name }: Seat): PlayerRef => ({ id, position, player_name });
export const playerLabel = (player: PlayerRef, language: Language = "zh_hans") => translate(language, "{0} 号 {1}", [player.position, player.player_name]);
export const voteTotal = (nomination: Nomination) => nomination.votes
  .reduce((total, vote) => total + (vote.choice === "yes" ? vote.weight : 0), 0);
export const currentNominations = (game: GameDraft) => game.nominations
  .filter((nomination) => nomination.day_number === game.day_number);
export const openNomination = (game: GameDraft) => game.nominations.find((n) => n.status === "open");

/** Standard execution tally. Historical thresholds stay fixed when players later die. */
export function executionStanding(game: GameDraft) {
  const closed = currentNominations(game).filter((n) => n.status === "closed");
  const high = Math.max(0, ...closed.map(voteTotal));
  const leaders = closed.filter((n) => voteTotal(n) === high);
  const qualified = leaders.some((n) => high >= Math.ceil(n.alive_count / 2));
  return {
    high,
    tied: high > 0 && qualified && leaders.length > 1,
    candidate: high > 0 && qualified && leaders.length === 1 ? leaders[0].nominee : null,
  };
}

export function nominationError(game: GameDraft, nominatorId: string, nomineeId: string, script: Script): string | null {
  if (game.phase !== "day") return "请先将局面阶段设为白天。";
  if (openNomination(game)) return "请先完成或取消当前投票。";
  const nominator = game.seats.find((seat) => seat.id === nominatorId);
  const nominee = game.seats.find((seat) => seat.id === nomineeId);
  if (!nominator || !nominee) return "请选择提名者与被提名者。";
  if (!nominator.alive) return "死亡玩家不能发起常规提名。";
  if (script.travellers.some((role) => role.id === nominee.role_id)) return "旅行者使用流放，请在时间线记录。";
  const today = currentNominations(game);
  if (today.some((n) => n.nominator.id === nominatorId)) return "该玩家今天已经提名。";
  if (today.some((n) => n.nominee.id === nomineeId)) return "该玩家今天已经被提名。";
  return null;
}

export function startNomination(game: GameDraft, nominatorId: string, nomineeId: string, script: Script, id: string): GameDraft {
  if (nominationError(game, nominatorId, nomineeId, script)) return game;
  return {
    ...game,
    nominations: [...game.nominations, {
      id, day_number: game.day_number,
      nominator: playerRef(game.seats.find((seat) => seat.id === nominatorId)!),
      nominee: playerRef(game.seats.find((seat) => seat.id === nomineeId)!),
      status: "open", alive_count: game.seats.filter((seat) => seat.alive).length,
      votes: game.seats.map((seat) => ({ player: playerRef(seat), choice: "pending", weight: 1, dead_vote: false })),
    }],
  };
}

export function recordVote(game: GameDraft, nominationId: string, seatId: string, choice: IndividualVote["choice"], weight = 1): GameDraft {
  const nomination = openNomination(game);
  const seat = game.seats.find((item) => item.id === seatId);
  if (!nomination || nomination.id !== nominationId || !seat || game.phase !== "day" ||
      nomination.day_number !== game.day_number || !Number.isInteger(weight) || weight < -20 || weight > 20 ||
      (choice === "yes" && !seat.alive && !seat.dead_vote_available)) return game;
  return {
    ...game,
    nominations: game.nominations.map((n) => n.id !== nominationId ? n : {
      ...n, votes: n.votes.map((vote) => vote.player.id !== seatId ? vote : {
        ...vote, choice, weight: choice === "yes" ? weight : 1,
        dead_vote: choice === "yes" && !seat.alive,
      }),
    }),
  };
}

export function finishNomination(game: GameDraft, nominationId: string, cancel = false): GameDraft {
  const nomination = openNomination(game);
  if (!nomination || nomination.id !== nominationId || game.phase !== "day" ||
      nomination.day_number !== game.day_number) return game;
  if (!cancel && (nomination.votes.some((v) => v.choice === "pending") ||
      nomination.votes.some((v) => v.dead_vote && !game.seats.find((s) => s.id === v.player.id)?.dead_vote_available))) return game;
  const spent = new Set(cancel ? [] : nomination.votes.filter((v) => v.dead_vote).map((v) => v.player.id));
  return {
    ...game,
    seats: game.seats.map((seat) => spent.has(seat.id) && !seat.alive ? { ...seat, dead_vote_available: false } : seat),
    nominations: game.nominations.map((n) => n.id !== nominationId ? n : {
      ...n, status: cancel ? "cancelled" : "closed", alive_count: game.seats.filter((seat) => seat.alive).length,
    }),
  };
}

/** Keep an open ballot's roster stable; allow later removal without erasing history. */
export function votingEditError(before: GameDraft, after: GameDraft): string | null {
  if (!openNomination(before)) return null;
  if (before.phase !== after.phase || before.day_number !== after.day_number ||
      before.script_id !== after.script_id || before.player_count !== after.player_count) {
    return "请先完成或取消当前投票，再切换阶段、天数、剧本或人数。";
  }
  if (before.seats.some((seat) => {
    const next = after.seats.find((s) => s.id === seat.id);
    const vote = openNomination(before)?.votes.find((v) => v.player.id === seat.id);
    return next && vote?.choice === "yes" &&
      (next.alive !== seat.alive || next.dead_vote_available !== seat.dead_vote_available);
  }) && openNomination(after)) return "该玩家已投票；请先将该票改为未记录，再更改生死或亡者票。";
  return null;
}
