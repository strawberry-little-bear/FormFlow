"""Long design-Agent request queue: safe recovery, idempotency, ownership, and stale bases."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agents.requirements_agent import DraftResult
from app.main import app
from app.models import Account, AgentDraftRequest, BlueprintVersion, Task
from app.schemas import Blueprint, FieldDef
from app.security import utcnow
from app.services import agent_requests
from tests.test_authz import _register


@pytest.fixture()
def client():
    with TestClient(app) as test_client:
        yield test_client


def _result(label="姓名"):
    return DraftResult(blueprint=Blueprint(fields=[FieldDef(id="name", label=label)]),
                       publish_summary=["已整理原始要求"])


def _task(db, owner_id):
    task = Task(name="队列测试任务", mode="roster", subject_kind="individual",
                status="draft", created_by=owner_id)
    db.add(task)
    db.commit()
    return task


def test_design_agent_api_returns_durable_status_and_replays_completed_request(
        client, db_session, monkeypatch):
    headers = _register(client, "agent-request-owner")
    account = db_session.scalar(select(Account).where(Account.username == "agent-request-owner"))
    task = _task(db_session, account.id)
    calls = []

    def draft(requirement, template=None):
        calls.append((requirement, template))
        return _result()

    monkeypatch.setattr(agent_requests, "draft_blueprint", draft)
    form = {"request_id": "request-00000000000001", "kind": "agent",
            "base_blueprint_id": "0", "requirement": "收集学生姓名"}
    accepted = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form)
    assert accepted.status_code == 202, accepted.text
    assert accepted.json()["status"] == "queued"

    status = client.get(
        f"/api/tasks/{task.id}/draft/agent-requests/{form['request_id']}", headers=headers)
    assert status.status_code == 200, status.text
    assert status.headers["cache-control"] == "no-store"
    assert status.json()["status"] == "completed"
    assert status.json()["result"]["draft"]["blueprint"]["fields"][0]["label"] == "姓名"
    assert len(calls) == 1
    assert db_session.scalars(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id)).all()

    replay = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form)
    assert replay.status_code == 202
    assert replay.json()["status"] == "completed"
    assert len(calls) == 1
    job = db_session.scalar(select(AgentDraftRequest).where(
        AgentDraftRequest.task_id == task.id,
        AgentDraftRequest.request_id == form["request_id"]))
    assert job.attempts == 1


def test_queued_request_is_recovered_by_status_poll_without_worker(client, db_session, monkeypatch):
    headers = _register(client, "agent-request-resume")
    account = db_session.scalar(select(Account).where(Account.username == "agent-request-resume"))
    task = _task(db_session, account.id)
    calls = []
    monkeypatch.setattr(agent_requests, "draft_blueprint",
                        lambda text, **kwargs: calls.append(text) or _result())
    real_drain = agent_requests.drain_task_queue
    monkeypatch.setattr(agent_requests, "drain_task_queue", lambda *_args: 0)
    form = {"request_id": "request-00000000000005", "kind": "agent",
            "base_blueprint_id": "0", "requirement": "收集姓名"}
    queued = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form)
    assert queued.json()["status"] == "queued"
    job = db_session.scalar(select(AgentDraftRequest).where(
        AgentDraftRequest.task_id == task.id, AgentDraftRequest.request_id == form["request_id"]))
    assert job.status == "queued"

    monkeypatch.setattr(agent_requests, "drain_task_queue", real_drain)
    status = client.get(
        f"/api/tasks/{task.id}/draft/agent-requests/{form['request_id']}", headers=headers)
    assert status.json()["status"] == "queued"
    assert status.status_code == 200
    assert calls == ["收集姓名"]
    db_session.refresh(job)
    assert job.status == "completed"


def test_design_agent_timeout_keeps_original_payload_and_can_retry_same_id(
        client, db_session, monkeypatch):
    headers = _register(client, "agent-request-retry")
    account = db_session.scalar(select(Account).where(Account.username == "agent-request-retry"))
    task = _task(db_session, account.id)
    responses = [DraftResult(blueprint=Blueprint(), warnings=[
        "需求 Agent 暂不可用（连接超时）。已保留当前草案，请稍后重试。"]), _result("姓名")]
    calls = []

    def draft(requirement, template=None):
        calls.append(requirement)
        return responses.pop(0)

    monkeypatch.setattr(agent_requests, "draft_blueprint", draft)
    form = {"request_id": "request-00000000000002", "kind": "agent",
            "base_blueprint_id": "0", "requirement": "收集姓名和活动日期"}
    first = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form)
    assert first.status_code == 202
    first_status = client.get(
        f"/api/tasks/{task.id}/draft/agent-requests/{form['request_id']}", headers=headers).json()
    assert first_status["status"] == "failed"
    assert "原草案没有更改" in first_status["error"]
    assert db_session.scalars(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id)).all() == []

    retry = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers, data=form)
    assert retry.status_code == 202
    result = client.get(
        f"/api/tasks/{task.id}/draft/agent-requests/{form['request_id']}", headers=headers).json()
    assert result["status"] == "completed"
    assert len(calls) == 2 and calls == [form["requirement"], form["requirement"]]
    job = db_session.scalar(select(AgentDraftRequest).where(
        AgentDraftRequest.task_id == task.id,
        AgentDraftRequest.request_id == form["request_id"]))
    assert job.attempts == 2


def test_request_id_payload_conflict_and_cross_account_status_are_rejected(client, db_session,
                                                                            monkeypatch):
    headers1 = _register(client, "agent-request-a")
    headers2 = _register(client, "agent-request-b")
    account = db_session.scalar(select(Account).where(Account.username == "agent-request-a"))
    task = _task(db_session, account.id)
    monkeypatch.setattr(agent_requests, "draft_blueprint", lambda *_args, **_kwargs: _result())
    request_id = "request-00000000000003"
    base = {"request_id": request_id, "kind": "agent", "base_blueprint_id": "0",
            "requirement": "收集姓名"}
    assert client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers1,
                       data=base).status_code == 202
    conflict = client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers1,
                           data={**base, "requirement": "收集手机号"})
    assert conflict.status_code == 422
    assert client.get(f"/api/tasks/{task.id}/draft/agent-requests/{request_id}",
                      headers=headers2).status_code == 404
    assert client.get(f"/api/tasks/{task.id}/draft/agent-requests/{request_id}",
                      headers=headers1).json()["status"] == "completed"


def test_stale_draft_baseline_fails_without_overwriting_latest_version(
        client, db_session, monkeypatch):
    headers = _register(client, "agent-request-stale")
    account = db_session.scalar(select(Account).where(Account.username == "agent-request-stale"))
    task = _task(db_session, account.id)
    old = BlueprintVersion(task_id=task.id, version=1, status="draft",
                           blueprint_json=_result("姓名").blueprint.model_dump_json())
    db_session.add(old)
    db_session.commit()
    newer = BlueprintVersion(task_id=task.id, version=2, status="draft",
                             blueprint_json=_result("姓名和班级").blueprint.model_dump_json())
    db_session.add(newer)
    db_session.commit()
    calls = []
    monkeypatch.setattr(agent_requests, "draft_blueprint",
                        lambda *args, **kwargs: calls.append((args, kwargs)) or _result())
    form = {"request_id": "request-00000000000004", "kind": "revise",
            "base_blueprint_id": str(old.id), "blueprint_version_id": str(old.id),
            "requirement": "收集姓名"}
    assert client.post(f"/api/tasks/{task.id}/draft/agent-requests", headers=headers,
                       data=form).status_code == 202
    state = client.get(
        f"/api/tasks/{task.id}/draft/agent-requests/{form['request_id']}", headers=headers).json()
    assert state["status"] == "failed"
    assert "草案已在另一页面更新" in state["error"]
    assert calls == []
    assert db_session.scalar(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id).order_by(BlueprintVersion.version.desc())).id == newer.id


def test_stale_worker_lease_requeues_only_expired_claims(db_session):
    account = Account(username="lease-owner", password_hash="x", password_salt="x")
    db_session.add(account)
    db_session.flush()
    task = _task(db_session, account.id)
    old = AgentDraftRequest(task_id=task.id, account_id=account.id,
        request_id="request-00000000000006", request_hash="a" * 64,
        payload_json="{}", status="running", attempts=1,
        created_at=utcnow() - agent_requests.RUNNING_LEASE - timedelta(seconds=1),
        updated_at=utcnow() - agent_requests.RUNNING_LEASE - timedelta(seconds=1))
    active = AgentDraftRequest(task_id=task.id, account_id=account.id,
        request_id="request-00000000000007", request_hash="b" * 64,
        payload_json="{}", status="running", attempts=1,
        created_at=utcnow(), updated_at=utcnow())
    db_session.add_all([old, active])
    db_session.flush()
    assert agent_requests.requeue_stale_requests(db_session) == 1
    db_session.commit()
    assert db_session.get(AgentDraftRequest, old.id).status == "queued"
    assert db_session.get(AgentDraftRequest, active.id).status == "running"
