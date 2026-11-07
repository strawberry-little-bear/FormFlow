from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def test_readiness_reports_database_and_storage():
    with TestClient(app) as client:
        response = client.get("/api/ready")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "checks": {"database": True, "storage": True},
    }


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
