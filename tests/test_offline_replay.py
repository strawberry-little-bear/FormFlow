"""演示任务的离线 Agent 回放：权限、队列和来源标识。"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import (AgentDraftRequest, BlueprintVersion, CheckRun, Subject, Task,
                        RUN_EXECUTION_OFFLINE_REPLAY)
from app.services.agent_requests import AgentRequestError, normalize_payload
from app.services.demo_seed import seed_demo
from app.worker import run_pending_once


def _demo_headers(client: TestClient) -> dict[str, str]:
    response = client.post("/api/auth/login", data={"username": "demo", "password": "demo1234"})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['token']}"}


def test_demo_offline_replay_uses_same_worker_pipeline(db_session):
    seeded = seed_demo(db_session)
    task = db_session.get(Task, seeded["task_id"])
    subject = db_session.scalar(select(Subject).where(
        Subject.task_id == task.id, Subject.display_name == "李四"))
    assert subject is not None

    with TestClient(app) as client:
        headers = _demo_headers(client)
        response = client.post(
            f"/api/tasks/{task.id}/subjects/{subject.id}/checks/offline-replay",
            headers=headers,
        )
        assert response.status_code == 200, response.text
        run_id = response.json()["run_id"]

    queued = db_session.get(CheckRun, run_id)
    assert queued.execution_mode == RUN_EXECUTION_OFFLINE_REPLAY
    assert run_pending_once(db_session) == 1
    db_session.refresh(queued)
    assert queued.status == "success"
    with TestClient(app) as client:
        findings = client.get(
            f"/api/tasks/{task.id}/subjects/{subject.id}/findings", headers=headers
        )
        assert findings.status_code == 200, findings.text
        payload = findings.json()
    assert payload["run"]["execution_mode"] == RUN_EXECUTION_OFFLINE_REPLAY
    assert payload["offline_replay"]["available"] is True
    assert any(item["simulation"] is True for item in payload["tool_trace"])


def test_offline_replay_is_closed_to_normal_tasks(db_session):
    with TestClient(app) as client:
        response = client.post("/api/accounts", data={"username": "normal", "password": "pw123456"})
        assert response.status_code == 200
        login = client.post("/api/auth/login", data={"username": "normal", "password": "pw123456"})
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
        task = client.post("/api/tasks", data={"name": "普通任务"}, headers=headers)
        assert task.status_code == 200
        response = client.post(
            f"/api/tasks/{task.json()['task_id']}/subjects/999/checks/offline-replay",
            headers=headers,
        )
        assert response.status_code == 404


def test_demo_requirements_replay_uses_durable_queue_and_stays_a_draft(db_session):
    seeded = seed_demo(db_session)
    task = db_session.get(Task, seeded["task_id"])
    published_before = db_session.scalars(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id,
        BlueprintVersion.status == "published")).all()

    request_id = "offline-requirements-0001"
    form = {
        "request_id": request_id,
        "kind": "agent",
        "base_blueprint_id": str(task.current_blueprint_id),
        "requirement": "收集姓名和团课报告",
        "execution_mode": "offline_replay",
    }
    with TestClient(app) as client:
        headers = _demo_headers(client)
        accepted = client.post(
            f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form
        )
        assert accepted.status_code == 202, accepted.text
        status = client.get(
            f"/api/tasks/{task.id}/draft/agent-requests/{request_id}", headers=headers
        )
        assert status.status_code == 200, status.text
        payload = status.json()

    assert payload["status"] == "completed", payload
    assert payload["execution_mode"] == "offline_replay"
    assert payload["simulation"] is True
    assert payload["runtime_label"] == "离线脚本回放 · 不调用外部模型"
    result = payload["result"]
    assert result["status"] == "draft"
    assert result["execution_mode"] == "offline_replay"
    assert result["simulation"] is True
    assert result["draft"]["blueprint"]["fields"]

    db_session.expire_all()
    versions = db_session.scalars(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id)).all()
    assert len([v for v in versions if v.status == "published"]) == len(published_before)
    assert any(v.status == "draft" for v in versions)
    job = db_session.scalar(select(AgentDraftRequest).where(
        AgentDraftRequest.task_id == task.id,
        AgentDraftRequest.request_id == request_id))
    assert job is not None and job.attempts == 1


def test_offline_replay_rejects_revise_payload_before_queueing():
    with pytest.raises(AgentRequestError, match="首次需求起草"):
        normalize_payload({
            "kind": "revise",
            "blueprint_version_id": 1,
            "requirement": "改一下截止时间",
            "execution_mode": "offline_replay",
        })
