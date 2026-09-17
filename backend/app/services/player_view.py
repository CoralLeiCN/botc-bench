"""Application visibility policy: project explicit knowledge, never infer it from truth."""

from __future__ import annotations

from typing import List, Optional

from ..models import (
    GameSnapshot,
    PlayerHistoryEntry,
    PlayerKnowledge,
    PlayerRef,
    PlayerView,
    PublicSeat,
    TimelineEntry,
)


def build_player_view(
    game: GameSnapshot, seat_id: str, timeline: Optional[List[TimelineEntry]] = None,
) -> PlayerView:
    viewer = next((seat for seat in game.seats if seat.id == seat_id), None)
    if viewer is None:
        raise ValueError("selected_seat_id is not present in game")
    # Construct an allowlist instead of deleting known secrets from a full dump.
    # New storyteller fields must remain private by default, including after death.
    return PlayerView(
        script_id=game.script_id,
        player_count=game.player_count,
        phase=game.phase,
        day_number=game.day_number,
        seats=[
            PublicSeat(
                id=seat.id,
                position=seat.position,
                player_name=seat.player_name,
                alive=seat.alive,
                public_claim=seat.public_claim,
            )
            for seat in sorted(game.seats, key=lambda item: item.position)
        ],
        public_information=game.public_information,
        you=PlayerKnowledge(
            seat_id=viewer.id,
            shown_role_id=viewer.shown_role_id,
            shown_alignment=viewer.shown_alignment,
            private_information=viewer.private_information,
        ),
        nominations=[nomination.model_copy(deep=True) for nomination in game.nominations],
        history=build_player_history(timeline or [], seat_id),
    )


def build_player_history(timeline: List[TimelineEntry], seat_id: str) -> List[PlayerHistoryEntry]:
    """Project only allowed fields; never share generated summaries or full snapshots.

    Callers supply the timeline prefix ending at the requested snapshot. Observation
    changes reflect recorded edits (including undo), not inferred game actions.
    """
    history = []
    previous = None
    for entry in timeline:
        game = entry.snapshot

        def append(suffix, kind, text, visibility="public", source=entry, **fields):
            history.append(PlayerHistoryEntry(
                id=f"{source.id}:{suffix}", event_id=source.id, recorded_at=source.recorded_at,
                phase=source.snapshot.phase, day_number=source.snapshot.day_number, kind=kind,
                visibility=visibility, text=text, **fields,
            ))

        old_nominations = {item.id: item for item in previous.nominations} if previous else {}
        for nomination in game.nominations:
            if nomination != old_nominations.get(nomination.id):
                append(
                    f"nomination:{nomination.id}", "nomination", "公开提名 / 投票记录更新",
                    nomination=nomination.model_copy(deep=True),
                )
        removed = old_nominations.keys() - {item.id for item in game.nominations}
        for nomination_id in sorted(removed):
            nomination = old_nominations[nomination_id]
            append(
                f"removed:{nomination_id}", "observation",
                f"已撤回提名记录：{nomination.nominator.player_name} → "
                f"{nomination.nominee.player_name}（{nomination_id}）",
            )

        # Preserve baseline knowledge so later edits cannot erase earlier observations.
        # A baseline records what was already known, not when/how it was acquired.
        update = "更新" if previous else "起点记录"
        if game.public_information != (previous.public_information if previous else ""):
            append("public_information", "observation",
                   f"公开信息{update}：{game.public_information or '（已清空）'}")
        old_seats = {seat.id: seat for seat in previous.seats} if previous else {}
        for seat in game.seats:
            old = old_seats.get(seat.id)
            label = f"{seat.position} 号 {seat.player_name}"
            update = "更新" if old else "起点记录"
            if seat.public_claim != (old.public_claim if old else ""):
                append(f"{seat.id}:claim", "observation",
                       f"{label} 公开声明{update}：{seat.public_claim or '（已清空）'}")
            if old and seat.alive != old.alive:
                append(f"{seat.id}:alive", "observation",
                       f"{label} 生死记录更新：{'存活' if seat.alive else '死亡'}")
            if seat.id == seat_id:
                for field, title, default in (
                    ("shown_role_id", "展示角色", None),
                    ("shown_alignment", "告知阵营", "unknown"),
                    ("private_information", "私人信息", ""),
                ):
                    value = getattr(seat, field)
                    if value != (getattr(old, field) if old else default):
                        append(f"{seat.id}:{field}", "observation",
                               f"你的{title}{update}：{value or '（未记录）'}", "private")

        audience = entry.audience
        if entry.kind in {"note", "action", "information"} and (
            audience.visibility == "public" or
            (audience.visibility == "private" and seat_id in audience.recipient_seat_ids)
        ):
            def ref(player_id, snapshot=game):
                seat = next(seat for seat in snapshot.seats if seat.id == player_id)
                return PlayerRef(id=seat.id, position=seat.position, player_name=seat.player_name)

            details = entry.details
            append(
                "manual", entry.kind, entry.note, audience.visibility,
                actor=ref(details.actor_seat_id) if details and details.actor_seat_id else None,
                targets=[ref(target) for target in details.target_seat_ids] if details else [],
            )
        previous = game
    return history
