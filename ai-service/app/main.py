"""FastAPI entry point for the AI + optimization service."""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import get_settings
from .providers.embeddings import get_embedding_provider
from .providers.llm_providers import get_provider
from .routers import ai as ai_router
from .routers import schedule as schedule_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-5s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("ai.main")

settings = get_settings()

app = FastAPI(
    title="Interview Scheduler - AI & Optimization Service",
    description=(
        "Owns everything mathematical or linguistic: OR-Tools CP-SAT scheduling, "
        "explainable health scoring, and all LLM calls - availability parsing, "
        "feedback analysis, message drafting and skill matching - each with a "
        "deterministic fallback."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

PUBLIC_PATHS = {"/health", "/docs", "/openapi.json", "/redoc", "/"}


@app.middleware("http")
async def service_auth(request: Request, call_next):
    """Shared-secret gate.

    This service is an internal component: only the backend should reach it.
    The token lives in the environment and is compared in constant-ish time.
    """
    path = request.url.path
    if settings.require_token and path not in PUBLIC_PATHS and not path.startswith("/docs"):
        token = request.headers.get("x-service-token", "")
        if token != settings.service_token:
            return JSONResponse(
                status_code=401,
                content={"detail": {"code": "UNAUTHORIZED", "message": "Invalid or missing service token"}},
            )
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Process-Time-Ms"] = f"{(time.perf_counter() - started) * 1000:.1f}"
    return response


@app.exception_handler(Exception)
async def unhandled(_request: Request, exc: Exception):
    """Never leak a traceback; the backend treats 5xx as 'use the fallback'."""
    log.exception("Unhandled error in AI service")
    return JSONResponse(
        status_code=500,
        content={"detail": {"code": "INTERNAL_ERROR", "message": type(exc).__name__}},
    )


app.include_router(ai_router.router)
app.include_router(schedule_router.router)


@app.get("/health")
def health() -> dict:
    provider = get_provider()
    embedder = get_embedding_provider()
    try:
        from ortools.sat.python import cp_model  # noqa: PLC0415

        solver_ok = bool(cp_model.CpModel())
    except Exception:  # noqa: BLE001
        solver_ok = False

    return {
        "ok": True,
        "service": "ai-optimization",
        "version": "1.0.0",
        "ai_provider": provider.name,
        "ai_is_llm": provider.is_llm,
        "ai_available": provider.available(),
        "embedding_provider": embedder.name,
        "embedding_is_neural": embedder.is_neural,
        "solver": "ortools-cpsat" if solver_ok else "unavailable",
        "config": settings.describe(),
        "transparency": {
            "llm_role": (
                "judgement about language and meaning: availability text, feedback "
                "analysis, message drafting, and skill-coverage matching"
            ),
            "deterministic_role": (
                "all scheduling decisions: hard constraints, conflict prevention, "
                "timezones, buffers, workload limits, double-booking guard"
            ),
            "optimizer": "OR-Tools CP-SAT over a pre-validated feasible space",
            "fallback": "every LLM call degrades to a deterministic extractor, never an error",
        },
    }


@app.get("/")
def root() -> dict:
    return {"service": "ai-optimization", "docs": "/docs", "health": "/health"}
