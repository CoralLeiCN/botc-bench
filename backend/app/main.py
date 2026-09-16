from __future__ import annotations

from contextlib import asynccontextmanager
from typing import AsyncIterator, List, Optional

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from fastapi.staticfiles import StaticFiles

from .catalog import ScriptCatalog, ScriptNotFound
from .config import Settings
from .database import EventNotFound, GameNotFound, GameRepository, TimelineConflict, VersionConflict
from .models import (
    BranchRequest,
    GameRecord,
    GameSnapshot,
    GameSummary,
    GameWrite,
    HarnessStatus,
    ReasonRequest,
    ReasonResponse,
    Script,
)
from .services.codex_harness import CodexHarness, HarnessFailed, HarnessUnavailable


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
            {seat.role_id for seat in draft.seats if seat.role_id and seat.role_id not in allowed}
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

    @app.post("/api/reason", response_model=ReasonResponse)
    async def reason(payload: ReasonRequest) -> ReasonResponse:
        validate_script_roles(payload.game)
        for event in payload.timeline or []:
            validate_script_roles(event.snapshot)
        try:
            return await harness.reason(
                payload.game, payload.question, payload.selected_seat_id, payload.timeline
            )
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
