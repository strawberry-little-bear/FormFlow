"""FastAPI 应用入口。"""
from __future__ import annotations

from contextlib import asynccontextmanager
import os
from pathlib import Path

from fastapi import FastAPI, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from .api.routes import router
from .db import SessionLocal, init_db
from .config import public_llm_base_url, settings
from . import storage
from .services.agent_runtime import AGENT_RUNTIME_CONTRACT_VERSION

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="收齐啦 FormFlow", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Set baseline browser protections without requiring a proxy-specific config."""
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "SAMEORIGIN")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    return response


@app.get("/health")
def health(response: Response) -> dict:
    response.headers["Cache-Control"] = "no-store"
    return {"status": "ok"}


@app.get("/api/health")
def demo_health(response: Response) -> dict:
    """Identify the current app build contract for local demo readiness checks."""
    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "ok",
        "service": "formflow",
        "agent_runtime_contract_version": AGENT_RUNTIME_CONTRACT_VERSION,
        "llm": {
            "configured": settings.llm_configured,
            "provider": public_llm_base_url(settings.llm_base_url),
            "model": settings.llm_model,
            "input_mode": settings.llm_input_mode,
            "direct_documents": settings.llm_input_mode in {"auto", "direct"},
            "api_key_exposed": False,
        },
    }


@app.get("/api/ready")
def readiness(response: Response) -> dict:
    """Return 200 only when the API can reach its database and storage root."""
    response.headers["Cache-Control"] = "no-store"
    checks = {"database": False, "storage": False}
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
        checks["database"] = True
    except Exception:
        # The endpoint is used by a proxy/container health check; do not expose
        # connection details or exception text to an unauthenticated caller.
        pass
    try:
        storage_root = storage.ensure_storage()
        checks["storage"] = storage_root.is_dir() and os.access(storage_root, os.W_OK)
    except OSError:
        pass
    ready = all(checks.values())
    if not ready:
        response.status_code = 503
    return {"status": "ready" if ready else "not_ready", "checks": checks}


@app.get("/")
def index() -> FileResponse:
    """前端 SPA 入口（P01–P05）。"""
    return FileResponse(str(STATIC_DIR / "index.html"))
