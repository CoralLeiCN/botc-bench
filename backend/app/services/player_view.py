"""Application visibility policy: project explicit knowledge, never infer it from truth."""

from __future__ import annotations

from ..models import GameSnapshot, PlayerKnowledge, PlayerView, PublicSeat


def build_player_view(game: GameSnapshot, seat_id: str) -> PlayerView:
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
    )
