from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import AsyncIterator, List, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .catalog import ScriptCatalog, ScriptNotFound
from .config import Settings
from .database import EventNotFound, GameNotFound, GameRepository, TimelineConflict, VersionConflict
from .models import (
    BranchRequest,
    DraftRecovery,
    DuplicateRequest,
    GameArchive,
    GameDraft,
    GameRecord,
    GameSnapshot,
    GameSummary,
    GameWrite,
    HarnessStatus,
    ReasonPreview,
    ReasonPreviewRequest,
    ReasonRequest,
    ReasonResponse,
    SavedAnalysis,
    SavedReasonRequest,
    Script,
)
from .services.codex_harness import CodexHarness, HarnessFailed, HarnessUnavailable, PromptChanged


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    resolved_settings = settings or Settings.from_env()
    catalog = ScriptCatalog(resolved_settings.script_data_path, resolved_settings.root_dir)
    repository = GameRepository(resolved_settings.database_path)
    harness = CodexHarness(
        root_dir=resolved_settings.root_dir,
        binary=resolved_settings.codex_binary,
        enabled=resolved_settings.codex_enabled,
        timeout_seconds=resolved_settings.codex_timeout_seconds,
        model=resolved_settings.codex_model,
    )

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        repository.initialize()
        yield

    app = FastAPI(
        title="BOTC Bench API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved_settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type"],
    )

    def validate_script_roles(draft: GameSnapshot) -> None:
        try:
            script = catalog.get(draft.script_id)
        except ScriptNotFound as exc:
            raise HTTPException(status_code=422, detail="unknown script_id") from exc
        allowed = {role.id for role in [*script.roles, *script.travellers]}
        invalid_roles = sorted(
            {
                role_id for seat in draft.seats
                for role_id in (seat.role_id, seat.shown_role_id)
                if role_id and role_id not in allowed
            }
        )
        invalid_sources = sorted(
            {
                marker.source_role_id
                for seat in draft.seats
                for marker in seat.markers
                if marker.source_role_id and marker.source_role_id not in allowed
            }
        )
        if invalid_roles or invalid_sources:
            details = []
            if invalid_roles:
                details.append(f"roles: {', '.join(invalid_roles)}")
            if invalid_sources:
                details.append(f"marker sources: {', '.join(invalid_sources)}")
            raise HTTPException(
                status_code=422,
                detail="IDs not present in selected script (" + "; ".join(details) + ")",
            )

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/scripts", response_model=List[Script])
    def list_scripts() -> List[Script]:
        return catalog.list()

    @app.get("/api/scripts/{script_id}", response_model=Script)
    def get_script(script_id: str) -> Script:
        try:
            return catalog.get(script_id)
        except ScriptNotFound as exc:
            raise HTTPException(status_code=404, detail="script not found") from exc

    @app.get("/api/scripts/{script_id}/qa", response_class=PlainTextResponse)
    def get_script_qa(script_id: str) -> str:
        try:
            return catalog.read_qa(script_id)
        except ScriptNotFound as exc:
            raise HTTPException(status_code=404, detail="script not found") from exc

    @app.get("/api/games", response_model=List[GameSummary])
    def list_games() -> List[GameSummary]:
        return repository.list()

    @app.post("/api/drafts/validate", response_model=DraftRecovery)
    def validate_recovery(payload: DraftRecovery) -> DraftRecovery:
        for snapshot in [
            *(event.snapshot for event in payload.timeline),
            *payload.history.past,
            *payload.history.future,
        ]:
            validate_script_roles(snapshot)
        return payload

    @app.post("/api/games/import", response_model=GameRecord, status_code=201)
    def import_game(payload: GameArchive) -> GameRecord:
        for event in payload.game.timeline:
            validate_script_roles(event.snapshot)
        return repository.import_game(payload.game)

    @app.post("/api/games", response_model=GameRecord, status_code=status.HTTP_201_CREATED)
    def create_game(payload: GameWrite) -> GameRecord:
        draft = payload.as_draft()
        validate_script_roles(draft)
        for event in payload.timeline or []:
            validate_script_roles(event.snapshot)
        return repository.create(draft, payload.timeline)

    @app.get("/api/games/{game_id}", response_model=GameRecord)
    def get_game(game_id: str) -> GameRecord:
        try:
            return repository.get(game_id)
        except GameNotFound as exc:
            raise HTTPException(status_code=404, detail="game not found") from exc

    @app.get("/api/games/{game_id}/export", response_model=GameArchive)
    def export_game(game_id: str) -> GameArchive:
        return GameArchive(exported_at=datetime.now(timezone.utc), game=get_game(game_id))

    @app.post("/api/games/{game_id}/duplicate", response_model=GameRecord, status_code=201)
    def duplicate_game(game_id: str, payload: DuplicateRequest) -> GameRecord:
        try:
            return repository.duplicate(game_id, payload.expected_version)
        except GameNotFound as exc:
            raise HTTPException(status_code=404, detail="game not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @app.post("/api/games/{game_id}/analyses", response_model=SavedAnalysis, status_code=201)
    async def analyse_game(game_id: str, payload: SavedReasonRequest) -> SavedAnalysis:
        source = get_game(game_id)
        event = next((item for item in source.timeline if item.id == payload.event_id), None)
        if event is None:
            raise HTTPException(status_code=404, detail="timeline event not found")
        try:
            snapshot = GameDraft.model_validate(event.snapshot.model_dump())
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="请先完成该时刻的局面配置") from exc
        if payload.selected_seat_id is not None and not any(
            seat.id == payload.selected_seat_id for seat in snapshot.seats
        ):
            raise HTTPException(status_code=422, detail="selected seat not found in snapshot")
        validate_script_roles(snapshot)
        try:
            preview = harness.preview(
                snapshot, payload.question, payload.selected_seat_id, payload.perspective
            )
            if (payload.expected_prompt_sha256 and
                    payload.expected_prompt_sha256 != preview.prompt_sha256):
                raise PromptChanged("输入已变化，请刷新预览后重试")
            result = await harness.reason(
                snapshot, payload.question, payload.selected_seat_id,
                payload.perspective, preview.prompt_sha256,
            )
            analysis = SavedAnalysis(
                id=str(uuid4()),
                created_at=datetime.now(timezone.utc),
                source_game_id=source.id,
                source_game_version=source.version,
                event_id=event.id,
                snapshot=snapshot,
                question=payload.question,
                selected_seat_id=payload.selected_seat_id,
                answer=result.answer,
                duration_ms=result.duration_ms,
                model=resolved_settings.codex_model,
                perspective=payload.perspective,
                prompt_sha256=preview.prompt_sha256,
            )
            return repository.save_analysis(game_id, analysis)
        except PromptChanged as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except GameNotFound as exc:
            raise HTTPException(status_code=404, detail="game deleted during analysis") from exc
        except HarnessUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except HarnessFailed as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.put("/api/games/{game_id}", response_model=GameRecord)
    def update_game(game_id: str, payload: GameWrite) -> GameRecord:
        if payload.expected_version is None:
            raise HTTPException(status_code=422, detail="expected_version is required")
        draft = payload.as_draft()
        validate_script_roles(draft)
        for event in payload.timeline or []:
            validate_script_roles(event.snapshot)
        try:
            return repository.update(game_id, draft, payload.expected_version, payload.timeline)
        except GameNotFound as exc:
            raise HTTPException(status_code=404, detail="game not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except TimelineConflict as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

    @app.post("/api/games/{game_id}/branch", response_model=GameRecord, status_code=201)
    def branch_game(game_id: str, payload: BranchRequest) -> GameRecord:
        try:
            return repository.branch(game_id, payload.event_id, payload.expected_version)
        except (GameNotFound, EventNotFound) as exc:
            raise HTTPException(status_code=404, detail="game or timeline event not found") from exc
        except VersionConflict as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(
                status_code=422,
                detail="该时刻仍有未完成的配置，请选择配置完整的记录创建分支",
            ) from exc

    @app.delete("/api/games/{game_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_game(game_id: str) -> Response:
        try:
            repository.delete(game_id)
        except GameNotFound as exc:
            raise HTTPException(status_code=404, detail="game not found") from exc
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/api/harness/status", response_model=HarnessStatus)
    def harness_status() -> HarnessStatus:
        return harness.status()

    @app.post("/api/reason/preview", response_model=ReasonPreview)
    def preview_reason(payload: ReasonPreviewRequest) -> ReasonPreview:
        validate_script_roles(payload.game)
        try:
            return harness.preview(
                payload.game, payload.question, payload.selected_seat_id, payload.perspective
            )
        except HarnessFailed as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    @app.post("/api/reason", response_model=ReasonResponse)
    async def reason(payload: ReasonRequest) -> ReasonResponse:
        validate_script_roles(payload.game)
        try:
            return await harness.reason(
                payload.game, payload.question, payload.selected_seat_id,
                payload.perspective, payload.expected_prompt_sha256,
            )
        except PromptChanged as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except HarnessUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except HarnessFailed as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    frontend_dist = resolved_settings.root_dir / "frontend/dist"
    if frontend_dist.is_dir():
        app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")

    app.state.settings = resolved_settings
    app.state.catalog = catalog
    app.state.repository = repository
    app.state.harness = harness
    return app


app = create_app()
