from __future__ import annotations

from pathlib import Path
import asyncio
import io
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient
from starlette.datastructures import UploadFile

from app.config import settings
from app.api.routes import UploadTooLargeError, _read_upload_content
from app.main import app


def test_docker_build_context_excludes_secrets_and_local_data():
    patterns = set((Path(__file__).resolve().parents[1] / ".dockerignore")
                   .read_text(encoding="utf-8").splitlines())

    assert {".env", ".env.*", "!.env.example", "data", "**/data", ".git"} <= patterns


def test_caddy_example_keeps_api_on_loopback():
    root = Path(__file__).resolve().parents[1]
    caddy = (root / "deploy" / "Caddyfile.example").read_text(encoding="utf-8")
    deployment = (root / "docs" / "deployment.md").read_text(encoding="utf-8")

    assert "example.com" in caddy
    assert "reverse_proxy 127.0.0.1:8000" in caddy
    assert "Caddyfile.example" in deployment


def test_compose_uses_file_secret_instead_of_api_key_environment_value():
    compose = (Path(__file__).resolve().parents[1] / "deploy" / "docker-compose.yml").read_text(
        encoding="utf-8"
    )
    assert "env_file:" not in compose
    assert "FORMFLOW_LLM_API_KEY_FILE: /run/secrets/formflow_llm_api_key" in compose
    assert "FORMFLOW_LLM_API_KEY:" not in compose
    assert "file: ../.formflow_llm_api_key" in compose
    assert "FORMFLOW_WORKER_HEARTBEAT_FILE:" in compose
    assert "os.environ['FORMFLOW_WORKER_HEARTBEAT_FILE']" in compose


def test_public_model_defaults_are_neutral_and_require_explicit_provider():
    root = Path(__file__).resolve().parents[1]
    example = (root / ".env.example").read_text(encoding="utf-8")
    compose = (root / "deploy" / "docker-compose.yml").read_text(encoding="utf-8")

    for content in (example, compose):
        assert "aigw.saurlax.com" not in content
        assert "your-provider.example/v1" in content
    assert "FORMFLOW_LLM_API_KEY=sk-" not in example
    assert "FORMFLOW_LLM_MODEL=your-model" in example


def test_create_account_script_runs_outside_repository_cwd(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "create_account.py"
    result = subprocess.run(
        [sys.executable, str(script), "--help"],
        cwd=tmp_path,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0
    assert "usage" in result.stdout.lower()


def test_readiness_reports_database_and_storage():
    with TestClient(app) as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"database": True, "storage": True},
    }


def test_baseline_security_headers_are_present():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "SAMEORIGIN"
    assert response.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert response.headers["Cache-Control"] == "no-store"


def test_readiness_probe_is_not_cacheable():
    with TestClient(app) as client:
        response = client.get("/api/ready")

    assert response.headers["Cache-Control"] == "no-store"


def test_public_registration_can_be_disabled(monkeypatch):
    monkeypatch.setattr(settings, "allow_registration", False)
    with TestClient(app) as client:
        response = client.post(
            "/api/accounts",
            data={"username": "closed-registration", "password": "pw123456"},
        )

    assert response.status_code == 403
    assert "关闭公开注册" in response.json()["detail"]


def test_config_status_exposes_only_non_secret_deployment_flags():
    with TestClient(app) as client:
        response = client.get("/api/config/status")

    assert response.status_code == 200
    payload = response.json()
    assert payload["registration_open"] is settings.allow_registration
    assert payload["environment"] == settings.environment
    assert "api_key" not in payload


def test_config_can_read_api_key_from_local_secret_file(tmp_path, monkeypatch):
    secret = tmp_path / "llm-key"
    secret.write_text("file-secret\n", encoding="utf-8")
    monkeypatch.delenv("FORMFLOW_LLM_API_KEY", raising=False)
    monkeypatch.setenv("FORMFLOW_LLM_API_KEY_FILE", str(secret))

    from app.config import Settings

    configured = Settings()
    assert configured.llm_api_key == "file-secret"
    assert configured.llm_configured is True


def test_worker_heartbeat_path_can_be_configured(tmp_path, monkeypatch):
    marker = tmp_path / "runtime" / "worker-heartbeat"
    monkeypatch.setenv("FORMFLOW_WORKER_HEARTBEAT_FILE", str(marker))

    from app.config import Settings

    configured = Settings()
    assert configured.worker_heartbeat_file == marker


def test_upload_reader_enforces_global_limit_in_chunks(monkeypatch):
    monkeypatch.setattr(settings, "max_upload_bytes", 4)

    exact = UploadFile(file=io.BytesIO(b"1234"), filename="exact.txt")
    assert asyncio.run(_read_upload_content(exact)) == b"1234"

    oversized = UploadFile(file=io.BytesIO(b"12345"), filename="large.txt")
    with pytest.raises(UploadTooLargeError, match="上传上限"):
        asyncio.run(_read_upload_content(oversized))
