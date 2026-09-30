"""Application visibility policy: project explicit knowledge, never infer it from truth."""

from __future__ import annotations

from typing import List, Literal, Optional

from ..models import (
    GameSnapshot,
    Nomination,
    PlayerHistoryEntry,
    PlayerKnowledge,
    PlayerRef,
    PlayerView,
    PublicSeat,
    Seat,
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


HistoryKind = Literal["note", "action", "information", "observation", "nomination"]
Visibility = Literal["public", "private"]


def _history_entry(
    source: TimelineEntry, suffix: str, kind: HistoryKind, text: str,
    visibility: Visibility = "public", *, actor: Optional[PlayerRef] = None,
    targets: Optional[List[PlayerRef]] = None, nomination: Optional[Nomination] = None,
) -> PlayerHistoryEntry:
    return PlayerHistoryEntry(
        id=f"{source.id}:{suffix}", event_id=source.id, recorded_at=source.recorded_at,
        phase=source.snapshot.phase, day_number=source.snapshot.day_number, kind=kind,
        visibility=visibility, text=text, actor=actor, targets=targets or [],
        nomination=nomination,
    )


def _nomination_history(
    entry: TimelineEntry, previous: Optional[GameSnapshot],
) -> List[PlayerHistoryEntry]:
    old_nominations = {item.id: item for item in previous.nominations} if previous else {}
    history = [
        _history_entry(
            entry, f"nomination:{nomination.id}", "nomination", "公开提名 / 投票记录更新",
            nomination=nomination.model_copy(deep=True),
        )
        for nomination in entry.snapshot.nominations
        if nomination != old_nominations.get(nomination.id)
    ]
    removed = old_nominations.keys() - {item.id for item in entry.snapshot.nominations}
    for nomination_id in sorted(removed):
        nomination = old_nominations[nomination_id]
        history.append(_history_entry(
            entry, f"removed:{nomination_id}", "observation",
            f"已撤回提名记录：{nomination.nominator.player_name} → "
            f"{nomination.nominee.player_name}（{nomination_id}）",
        ))
    return history


def _knowledge_history(
    entry: TimelineEntry, seat: Seat, old: Optional[Seat],
) -> List[PlayerHistoryEntry]:
    update = "更新" if old else "起点记录"
    # Explicit values keep the privacy boundary statically visible.
    fields = (
        ("shown_role_id", "展示角色", seat.shown_role_id, old.shown_role_id if old else None),
        ("shown_alignment", "告知阵营", seat.shown_alignment,
         old.shown_alignment if old else "unknown"),
        ("private_information", "私人信息", seat.private_information,
         old.private_information if old else ""),
    )
    return [
        _history_entry(entry, f"{seat.id}:{field}", "observation",
                       f"你的{title}{update}：{value or '（未记录）'}", "private")
        for field, title, value, before in fields if value != before
    ]


def _observation_history(
    entry: TimelineEntry, previous: Optional[GameSnapshot], seat_id: str,
) -> List[PlayerHistoryEntry]:
    game = entry.snapshot
    history: List[PlayerHistoryEntry] = []
    update = "更新" if previous else "起点记录"
    if game.public_information != (previous.public_information if previous else ""):
        history.append(_history_entry(
            entry, "public_information", "observation",
            f"公开信息{update}：{game.public_information or '（已清空）'}",
        ))
    old_seats = {seat.id: seat for seat in previous.seats} if previous else {}
    for seat in game.seats:
        old = old_seats.get(seat.id)
        label = f"{seat.position} 号 {seat.player_name}"
        update = "更新" if old else "起点记录"
        if seat.public_claim != (old.public_claim if old else ""):
            history.append(_history_entry(
                entry, f"{seat.id}:claim", "observation",
                f"{label} 公开声明{update}：{seat.public_claim or '（已清空）'}",
            ))
        if old and seat.alive != old.alive:
            history.append(_history_entry(
                entry, f"{seat.id}:alive", "observation",
                f"{label} 生死记录更新：{'存活' if seat.alive else '死亡'}",
            ))
        if seat.id == seat_id:
            history.extend(_knowledge_history(entry, seat, old))
    return history


def _player_ref(player_id: str, snapshot: GameSnapshot) -> PlayerRef:
    seat = next(seat for seat in snapshot.seats if seat.id == player_id)
    return PlayerRef(id=seat.id, position=seat.position, player_name=seat.player_name)


def _manual_history(entry: TimelineEntry, seat_id: str) -> List[PlayerHistoryEntry]:
    if entry.kind not in {"note", "action", "information"}:
        return []
    audience = entry.audience
    if audience.visibility == "storyteller":
        return []
    if audience.visibility == "private" and seat_id not in audience.recipient_seat_ids:
        return []
    details = entry.details
    return [_history_entry(
        entry, "manual", entry.kind, entry.note, audience.visibility,
        actor=_player_ref(details.actor_seat_id, entry.snapshot)
        if details and details.actor_seat_id else None,
        targets=[_player_ref(target, entry.snapshot) for target in details.target_seat_ids]
        if details else [],
    )]


def build_player_history(timeline: List[TimelineEntry], seat_id: str) -> List[PlayerHistoryEntry]:
    """Project the supplied timeline prefix, preserving baseline knowledge and corrections."""
    history: List[PlayerHistoryEntry] = []
    previous: Optional[GameSnapshot] = None
    for entry in timeline:
        history.extend(_nomination_history(entry, previous))
        history.extend(_observation_history(entry, previous, seat_id))
        history.extend(_manual_history(entry, seat_id))
        previous = entry.snapshot
    return history
