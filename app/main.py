"""FastAPI 应用入口。"""
from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .api.routes import router
from .db import init_db
from .config import settings
from .services.agent_runtime import AGENT_RUNTIME_CONTRACT_VERSION

STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="收齐啦 FormFlow", version="0.1.0", lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/health")
def demo_health() -> dict:
    """Identify the current app build contract for local demo readiness checks."""
    return {
        "status": "ok",
        "service": "formflow",
        "agent_runtime_contract_version": AGENT_RUNTIME_CONTRACT_VERSION,
        "llm": {
            "configured": settings.llm_configured,
            "provider": settings.llm_base_url,
            "model": settings.llm_model,
            "input_mode": settings.llm_input_mode,
            "direct_documents": settings.llm_input_mode in {"auto", "direct"},
            "api_key_exposed": False,
        },
    }


@app.get("/")
def index() -> FileResponse:
    """前端 SPA 入口（P01–P05）。"""
    return FileResponse(str(STATIC_DIR / "index.html"))
