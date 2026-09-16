export type Team = "townsfolk" | "outsider" | "minion" | "demon" | "traveller";
export type Alignment = "good" | "evil" | "unknown";
export type GamePhase = "setup" | "first_night" | "day" | "night" | "finished";
export type MarkerType =
  | "drunk"
  | "poisoned"
  | "protected"
  | "ability_used"
  | "red_herring"
  | "mad"
  | "custom";

export interface LocalizedText {
  en: string | null;
  zh_hans: string | null;
}

export interface Role {
  id: string;
  team: Team;
  name: LocalizedText;
  ability: LocalizedText;
  setup: boolean;
  setup_effect: LocalizedText;
  reminders: string[];
}

export interface ScriptSources {
  edition: string;
  english_roles: string;
  english_locale: string;
  zh_hans: string;
  nightsheet?: string | null;
}

export interface NightInstruction {
  id: string;
  name: LocalizedText;
  reminder: LocalizedText;
}

export type NightPhase = "first_night" | "night";

export interface NightStep {
  id: string;
  instruction_id: string | null;
  seat_id: string | null;
  title: string;
  status: "pending" | "completed" | "skipped";
  choice: string;
  information: string;
  decision: string;
}

export interface NightChecklist {
  id: string;
  script_id: string;
  phase: NightPhase;
  day_number: number;
  steps: NightStep[];
  reviewed_effects: string[];
}

export interface Script {
  id: string;
  edition: string;
  official: boolean;
  difficulty: "beginner" | "intermediate";
  name: LocalizedText;
  description: LocalizedText;
  roles: Role[];
  travellers: Role[];
  qa_path: string;
  reference_path: string;
  sources: ScriptSources;
  night_order?: Record<NightPhase, NightInstruction[]>;
}

export interface Marker {
  id: string;
  type: MarkerType;
  label: string;
  source_role_id: string | null;
  expires: string | null;
  note: string;
}

export interface Seat {
  id: string;
  position: number;
  player_name: string;
  role_id: string | null;
  shown_role_id: string | null;
  shown_alignment: Alignment;
  public_claim: string;
  private_information: string;
  alive: boolean;
  dead_vote_available: boolean;
  alignment: Alignment;
  markers: Marker[];
  notes: string;
}

export interface Composition {
  townsfolk: number;
  outsider: number;
  minion: number;
  demon: number;
  traveller: number;
  manual: boolean;
}

export interface GameDraft {
  schema_version: 1;
  name: string;
  script_id: string;
  player_count: number;
  composition: Composition;
  seats: Seat[];
  phase: GamePhase;
  day_number: number;
  notes: string;
  nominations: Nomination[];
  night_checklist?: NightChecklist | null;
  public_information: string;
}

export interface PlayerView {
  script_id: string;
  player_count: number;
  phase: GamePhase;
  day_number: number;
  seats: Array<Pick<Seat, "id" | "position" | "player_name" | "alive" | "public_claim">>;
  public_information: string;
  you: {
    seat_id: string;
    shown_role_id: string | null;
    shown_alignment: Alignment;
    private_information: string;
  };
}

export interface ReasonRequest {
  game: GameDraft;
  timeline?: TimelineEntry[];
  question: string;
  selected_seat_id: string | null;
  perspective: "storyteller" | "player";
}

export interface ReasonPreview {
  prompt: string;
  prompt_sha256: string;
  player_view: PlayerView | null;
}

export interface PlayerRef {
  id: string;
  position: number;
  player_name: string;
}

export interface IndividualVote {
  player: PlayerRef;
  choice: "pending" | "yes" | "no";
  /** Counted contribution; zero or negative weights can record character effects. */
  weight: number;
  /** Reserved while open, consumed on completion, released on cancellation. */
  dead_vote: boolean;
}

export interface Nomination {
  id: string;
  day_number: number;
  nominator: PlayerRef;
  nominee: PlayerRef;
  status: "open" | "closed" | "cancelled";
  alive_count: number;
  votes: IndividualVote[];
}

export interface GameWrite extends GameDraft {
  expected_version?: number;
  timeline?: TimelineEntry[];
}

export interface EventDetails {
  actor_seat_id: string | null;
  target_seat_ids: string[];
}

export type ManualEventKind = "note" | "action" | "information";

export interface TimelineEntry {
  id: string;
  recorded_at: string;
  kind: "initial" | "change" | "branch" | ManualEventKind;
  summary: string;
  note: string;
  snapshot: GameDraft;
  details?: EventDetails | null;
}

export interface BranchOrigin {
  game_id: string;
  game_name: string;
  event_id: string;
}

export interface GameRecord {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  draft: GameDraft;
  timeline: TimelineEntry[];
  branch_origin: BranchOrigin | null;
}

export interface GameSummary {
  id: string;
  version: number;
  name: string;
  script_id: string;
  player_count: number;
  updated_at: string;
}

export interface HarnessStatus {
  enabled: boolean;
  available: boolean;
  mode: "read-only";
  detail: string;
}

export interface ReasonResponse {
  answer: string;
  duration_ms: number;
}

export interface ValidationIssue {
  level: "warning" | "error";
  message: string;
}
