from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LocalizedText(StrictModel):
    en: Optional[str] = None
    zh_hans: Optional[str] = None


class Role(StrictModel):
    id: str
    team: Literal["townsfolk", "outsider", "minion", "demon", "traveller"]
    name: LocalizedText
    ability: LocalizedText
    setup: bool = False
    setup_effect: LocalizedText = Field(default_factory=LocalizedText)
    reminders: List[str] = Field(default_factory=list)


class ScriptSources(StrictModel):
    edition: str
    english_roles: str
    english_locale: str
    zh_hans: str
    nightsheet: Optional[str] = None


class NightInstruction(StrictModel):
    id: str
    name: LocalizedText
    reminder: LocalizedText


class NightOrder(StrictModel):
    first_night: List[NightInstruction] = Field(default_factory=list)
    night: List[NightInstruction] = Field(default_factory=list)


class Script(StrictModel):
    id: str
    edition: str
    official: bool
    difficulty: Literal["beginner", "intermediate"]
    name: LocalizedText
    description: LocalizedText
    roles: List[Role]
    travellers: List[Role]
    qa_path: str
    reference_path: str
    sources: ScriptSources
    night_order: NightOrder = Field(default_factory=NightOrder)


class MarkerType(str, Enum):
    DRUNK = "drunk"
    POISONED = "poisoned"
    PROTECTED = "protected"
    ABILITY_USED = "ability_used"
    RED_HERRING = "red_herring"
    MAD = "mad"
    CUSTOM = "custom"


class Marker(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    type: MarkerType
    label: str = Field(max_length=80)
    source_role_id: Optional[str] = Field(default=None, max_length=80)
    expires: Optional[str] = Field(default=None, max_length=120)
    note: str = Field(default="", max_length=500)


class Seat(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=1, le=20)
    player_name: str = Field(default="", max_length=80)
    role_id: Optional[str] = Field(default=None, max_length=80)
    alive: bool = True
    dead_vote_available: bool = True
    alignment: Literal["good", "evil", "unknown"] = "unknown"
    markers: List[Marker] = Field(default_factory=list, max_length=32)
    notes: str = Field(default="", max_length=2000)


class Composition(StrictModel):
    townsfolk: int = Field(ge=0, le=20)
    outsider: int = Field(ge=0, le=20)
    minion: int = Field(ge=0, le=20)
    demon: int = Field(ge=0, le=20)
    traveller: int = Field(default=0, ge=0, le=5)
    manual: bool = False

    @property
    def total(self) -> int:
        return self.townsfolk + self.outsider + self.minion + self.demon + self.traveller


class PlayerRef(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    position: int = Field(ge=1, le=20)
    player_name: str = Field(default="", max_length=80)


class IndividualVote(StrictModel):
    player: PlayerRef
    choice: Literal["pending", "yes", "no"] = "pending"
    weight: int = Field(default=1, ge=-20, le=20, strict=True)
    dead_vote: bool = False

    @model_validator(mode="after")
    def validate_vote(self) -> "IndividualVote":
        if self.choice != "yes" and (self.dead_vote or self.weight != 1):
            raise ValueError("only yes votes can consume dead votes or have custom weight")
        return self


class Nomination(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    day_number: int = Field(ge=0, le=99)
    nominator: PlayerRef
    nominee: PlayerRef
    status: Literal["open", "closed", "cancelled"] = "open"
    alive_count: int = Field(ge=0, le=20)
    votes: List[IndividualVote] = Field(min_length=5, max_length=20)

    @model_validator(mode="after")
    def validate_ballot(self) -> "Nomination":
        ids = [vote.player.id for vote in self.votes]
        if len(ids) != len(set(ids)):
            raise ValueError("voters must be unique")
        if self.nominator.id not in ids or self.nominee.id not in ids:
            raise ValueError("nomination participants must belong to the ballot roster")
        if self.alive_count > len(ids):
            raise ValueError("alive count must not exceed the ballot roster")
        if self.status == "closed" and any(v.choice == "pending" for v in self.votes):
            raise ValueError("closed ballots must record every individual vote")
        return self


class NightStep(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    instruction_id: Optional[str] = Field(default=None, max_length=80)
    seat_id: Optional[str] = Field(default=None, max_length=80)
    title: str = Field(min_length=1, max_length=200)
    status: Literal["pending", "completed", "skipped"] = "pending"
    choice: str = Field(default="", max_length=2000)
    information: str = Field(default="", max_length=2000)
    decision: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def validate_skip_reason(self) -> "NightStep":
        if self.status == "skipped" and not self.decision.strip():
            raise ValueError("skipped night steps require a storyteller decision")
        return self


class NightChecklist(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    script_id: str = Field(pattern=r"^script-\d{3}$")
    phase: Literal["first_night", "night"]
    day_number: int = Field(ge=0, le=99)
    steps: List[NightStep] = Field(min_length=1, max_length=200)
    reviewed_effects: List[str] = Field(default_factory=list, max_length=2000)

    @model_validator(mode="after")
    def validate_step_ids(self) -> "NightChecklist":
        ids = [step.id for step in self.steps]
        if len(ids) != len(set(ids)):
            raise ValueError("night step ids must be unique")
        return self


class GameSnapshot(StrictModel):
    schema_version: Literal[1] = 1
    name: str = Field(default="未命名局面", max_length=120)
    script_id: str = Field(pattern=r"^script-\d{3}$")
    player_count: int = Field(ge=5, le=20)
    composition: Composition
    seats: List[Seat] = Field(min_length=5, max_length=20)
    phase: Literal["setup", "first_night", "day", "night", "finished"] = "setup"
    day_number: int = Field(default=0, ge=0, le=99)
    notes: str = Field(default="", max_length=5000)
    nominations: List[Nomination] = Field(default_factory=list, max_length=2000)
    night_checklist: Optional[NightChecklist] = None

    @model_validator(mode="after")
    def validate_seats(self) -> "GameSnapshot":
        if len(self.seats) != self.player_count:
            raise ValueError("seats length must equal player_count")
        positions = sorted(seat.position for seat in self.seats)
        if positions != list(range(1, self.player_count + 1)):
            raise ValueError("seat positions must be unique and contiguous")
        ids = [seat.id for seat in self.seats]
        if len(ids) != len(set(ids)):
            raise ValueError("seat ids must be unique")
        nomination_ids = [nomination.id for nomination in self.nominations]
        if len(nomination_ids) != len(set(nomination_ids)):
            raise ValueError("nomination ids must be unique")
        active = [n for n in self.nominations if n.status == "open"]
        if len(active) > 1:
            raise ValueError("only one ballot may be open")
        if active:
            ballot = active[0]
            if self.phase != "day" or ballot.day_number != self.day_number:
                raise ValueError("open ballot must belong to the current day")
            if {v.player.id for v in ballot.votes} != set(ids):
                raise ValueError("open ballot roster must match current seats")
            seats = {seat.id: seat for seat in self.seats}
            for vote in ballot.votes:
                seat = seats[vote.player.id]
                if vote.choice == "yes" and (
                    vote.dead_vote != (not seat.alive)
                    or (vote.dead_vote and not seat.dead_vote_available)
                ):
                    raise ValueError("open ballot has an unavailable or inconsistent dead vote")
        return self


class GameDraft(GameSnapshot):
    name: str = Field(default="未命名局面", min_length=1, max_length=120)

    @model_validator(mode="after")
    def validate_complete_draft(self) -> "GameDraft":
        if self.composition.total != self.player_count:
            raise ValueError("composition total must equal player_count")
        if any(not marker.label for seat in self.seats for marker in seat.markers):
            raise ValueError("marker labels must not be empty")
        return self


class TimelineEntry(StrictModel):
    id: str = Field(min_length=1, max_length=80)
    recorded_at: datetime
    kind: Literal["initial", "change", "note", "branch"] = "change"
    summary: str = Field(min_length=1, max_length=500)
    note: str = Field(default="", max_length=2000)
    snapshot: GameSnapshot


class BranchOrigin(StrictModel):
    game_id: str
    game_name: str
    event_id: str


class BranchRequest(StrictModel):
    event_id: str = Field(min_length=1, max_length=80)
    expected_version: int = Field(ge=1)


class GameWrite(GameDraft):
    expected_version: Optional[int] = Field(default=None, ge=1)
    timeline: Optional[List[TimelineEntry]] = Field(default=None, max_length=20000)

    def as_draft(self) -> GameDraft:
        return GameDraft.model_validate(self.model_dump(exclude={"expected_version", "timeline"}))

    @model_validator(mode="after")
    def validate_timeline(self) -> "GameWrite":
        if self.timeline is not None:
            if not self.timeline:
                raise ValueError("timeline must include at least one snapshot")
            ids = [event.id for event in self.timeline]
            if len(ids) != len(set(ids)):
                raise ValueError("timeline event ids must be unique")
            if self.timeline[-1].snapshot.model_dump() != self.as_draft().model_dump():
                raise ValueError("last timeline snapshot must match the current draft")
        return self


class GameRecord(StrictModel):
    id: str
    version: int
    created_at: datetime
    updated_at: datetime
    draft: GameDraft
    timeline: List[TimelineEntry]
    branch_origin: Optional[BranchOrigin] = None


class GameSummary(StrictModel):
    id: str
    version: int
    name: str
    script_id: str
    player_count: int
    updated_at: datetime


class ReasonRequest(StrictModel):
    game: GameDraft
    question: str = Field(min_length=1, max_length=4000)
    selected_seat_id: Optional[str] = Field(default=None, max_length=80)
    timeline: Optional[List[TimelineEntry]] = Field(default=None, max_length=20000)

    @model_validator(mode="after")
    def validate_evidence(self) -> "ReasonRequest":
        if self.timeline is not None:
            if (
                not self.timeline
                or self.timeline[-1].snapshot.model_dump() != self.game.model_dump()
            ):
                raise ValueError("reasoning timeline must end at the supplied game state")
            ids = [event.id for event in self.timeline]
            if len(ids) != len(set(ids)):
                raise ValueError("timeline event ids must be unique")
        return self


class ReasonResponse(StrictModel):
    answer: str
    duration_ms: int


class HarnessStatus(StrictModel):
    enabled: bool
    available: bool
    mode: Literal["read-only"] = "read-only"
    detail: str


class ApiError(StrictModel):
    error: Dict[str, str]
