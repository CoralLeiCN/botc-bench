import { useLanguage } from "../LanguageProvider";
import { allRoles, hasSeatData, resizeSeats, suggestedComposition } from "../game";
import { uiMessage, type UiMessage } from "../language";
import type { GameDraft, Script, Seat } from "../types";
import type { GameDocument } from "./useGameDocument";

export function useGameEdits(document: GameDocument, scripts: Script[], script: Script | null,
  isLocked: boolean, notify: (notice: UiMessage | null) => void, focusInspector: () => void) {
  const { t, language } = useLanguage();
  const { game, selectedSeatId, selectedRoleId } = document;
  const replaying = document.replayIndex !== null;
  const updateGame = (updater: (current: GameDraft) => GameDraft): void => {
    if (isLocked) return;
    const error = document.edit(updater, scripts);
    notify(error ? uiMessage(error) : null);
  };
  const changeScript = (scriptId: string) => {
    if (!game || scriptId === game.script_id) return;
    const nextScript = scripts.find((item) => item.id === scriptId);
    if (!nextScript) return;
    const allowed = new Set(allRoles(nextScript).map((role) => role.id));
    const affected = game.seats.filter((seat) =>
      (seat.role_id && !allowed.has(seat.role_id)) || (seat.shown_role_id && !allowed.has(seat.shown_role_id)),
    );
    const affectedMarkers = game.seats.flatMap((seat) =>
      seat.markers.filter((item) => item.source_role_id && !allowed.has(item.source_role_id)),
    );
    if (
      (affected.length > 0 || affectedMarkers.length > 0) &&
      !window.confirm(
        t("切换剧本会清除 {0} 个座位的不兼容真实或展示角色和 {1} 个角色专属标记；玩家名、声明、信息及通用标记会保留。继续吗？", [affected.length, affectedMarkers.length]),
      )
    ) {
      return;
    }
    updateGame((current) => {
      const seats = current.seats.map((seat) => ({
        ...seat,
        role_id: seat.role_id && allowed.has(seat.role_id) ? seat.role_id : null,
        shown_role_id: seat.shown_role_id && allowed.has(seat.shown_role_id) ? seat.shown_role_id : null,
        markers: seat.markers.filter(
          (item) => !item.source_role_id || allowed.has(item.source_role_id),
        ),
      }));
      return {
        ...current,
        script_id: scriptId,
        composition: suggestedComposition(
          current.player_count,
          seats.map((seat) => seat.role_id),
          nextScript.travellers.map((role) => role.id),
        ),
        seats,
      };
    });
    document.selectRole(null);
  };

  const changePlayerCount = (nextCount: number) => {
    if (!game || !Number.isFinite(nextCount)) return;
    const bounded = Math.max(5, Math.min(20, Math.round(nextCount)));
    if (bounded === game.player_count) return;
    if (
      bounded < game.player_count &&
      game.seats.slice(bounded).some(hasSeatData) &&
      !window.confirm(t("减少玩家会移除末尾 {0} 个已有数据的座位。继续吗？", [game.player_count - bounded]))
    ) {
      return;
    }
    updateGame((current) => {
      const seats = resizeSeats(current.seats, bounded, language);
      return {
        ...current,
        player_count: bounded,
        seats,
        composition: suggestedComposition(
          bounded,
          seats.map((seat) => seat.role_id),
          script?.travellers.map((role) => role.id) ?? [],
        ),
      };
    });
    document.selectSeat(selectedSeatId && game.seats.slice(0, bounded).some((seat) => seat.id === selectedSeatId)
      ? selectedSeatId : game.seats[0]?.id ?? null);
  };

  const chooseSeat = (seatId: string) => {
    document.selectSeat(seatId);
    focusInspector();
    if (replaying || isLocked || !selectedRoleId || !script) return;
    const selectedRole = allRoles(script).find((role) => role.id === selectedRoleId);
    updateGame((current) => {
      const seats = current.seats.map((seat) =>
        seat.id === seatId
          ? {
              ...seat,
              role_id: selectedRoleId,
              alignment:
                seat.alignment === "unknown" && selectedRole?.team !== "traveller"
                  ? selectedRole?.team === "minion" || selectedRole?.team === "demon"
                    ? "evil"
                    : "good"
                  : seat.alignment,
            }
          : seat,
      );
      return {
        ...current,
        seats,
        composition: current.composition.manual
          ? current.composition
          : suggestedComposition(
              current.player_count,
              seats.map((seat) => seat.role_id),
              script?.travellers.map((role) => role.id) ?? [],
            ),
      };
    });
    document.selectRole(null);
  };

  const changeSeat = (nextSeat: Seat) => {
    updateGame((current) => {
      const seats = current.seats.map((seat) => (seat.id === nextSeat.id
        ? { ...nextSeat, dead_vote_available: !seat.alive && nextSeat.alive ? true : nextSeat.dead_vote_available }
        : seat));
      return {
        ...current,
        seats,
        composition: current.composition.manual
          ? current.composition
          : suggestedComposition(
              current.player_count,
              seats.map((seat) => seat.role_id),
              script?.travellers.map((role) => role.id) ?? [],
            ),
      };
    });
  };

  const moveSeat = (direction: -1 | 1) => {
    if (!game || !selectedSeatId) return;
    const index = game.seats.findIndex((seat) => seat.id === selectedSeatId);
    if (index < 0) return;
    const target = (index + direction + game.seats.length) % game.seats.length;
    updateGame((current) => {
      const seats = [...current.seats];
      [seats[index], seats[target]] = [seats[target], seats[index]];
      return {
        ...current,
        seats: seats.map((seat, seatIndex) => ({ ...seat, position: seatIndex + 1 })),
      };
    });
  };

  return { updateGame, changeScript, changePlayerCount, chooseSeat, changeSeat, moveSeat };
}
