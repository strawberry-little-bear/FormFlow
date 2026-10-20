# -*- coding: utf-8 -*-
"""任务生命周期测试（V24 / 方案表 6）：关闭/归档/取消与只读拦截。

- 关闭 = 停止占用提交入口，历史数据与审核结果保留（非删除）；
- 归档 = 关闭后的长期留存状态，仅关闭可归档，且必须没有未完成检查；
- 取消 = 中止收集并释放名册/授权，数据保留；归档后不可取消；
- 仅关闭可恢复收集，归档/取消为终态；
- 只读态下：保存草稿/上传文件/正式提交/发起检查/修订/发布蓝图全部拒绝；
- 生命周期变更全部落审计；API 层对只读拦截返回 409 而非 500。
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import (
    RUN_QUEUED,
    RUN_SUCCESS,
    TASK_CLOSED,
    TASK_COLLECTING,
    AuditEvent,
    CheckRun,
    Subject,
)
from app.schemas import Blueprint, DraftResult, SlotDef
from app.services import submissions as sub
from app.services import tasks as task_service
from app.services.checks import create_run
from tests.conftest import StubLLM, make_task, publish_blueprint, class_report_payload


@pytest.fixture()
def scenario(db_session):
    """收集中任务 + 已发布蓝图 + 一名提交者（窗口内可提交）。"""
    now = datetime.now(timezone.utc)
    task = make_task(db_session,
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=7),
                     correction_deadline=now + timedelta(days=14))
    publish_blueprint(db_session, task, Blueprint(
        slots=[SlotDef(id="report", label="报告", formats=["pdf"])],
        rules=[],
    ))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    return task, subject, submission


def _formal(db, task, submission, key="k1"):
    existing = sub.read_draft(db, submission)["slot_file_ids"].get("report", [])
    if not existing:
        existing = [sub.attach_file(db, submission, slot="report", original_name="report.pdf",
                    content=b"%PDF-1.4 test", sha256="", mime="application/pdf").file_id]
    return sub.formal_submit(db, task, submission, fields={"name": "张三"},
                             slot_file_ids={"report": existing}, idempotency_key=key)


# ---------------------------------------------------------------- 服务层
def test_close_blocks_every_write_path(db_session, scenario):
    """V24：关闭后一切写操作（草稿/上传/提交/检查/修订/发布）都被拒绝。"""
    task, subject, submission = scenario
    rev = _formal(db_session, task, submission, key="k-open")
    draft_bp = task_service.save_draft(
        db_session, task, DraftResult(blueprint=Blueprint()))

    task_service.close_task(db_session, task, actor="account:7")
    assert task.status == TASK_CLOSED

    with pytest.raises(task_service.TaskNotWritable):
        sub.save_draft(db_session, submission, {"name": "李四"})
    with pytest.raises(task_service.TaskNotWritable):
        sub.attach_file(db_session, submission, slot="report",
                        original_name="a.txt", content=b"x", sha256="", mime="text/plain")
    with pytest.raises(task_service.TaskNotWritable):
        _formal(db_session, task, submission, key="k-closed")
    with pytest.raises(task_service.TaskNotWritable):
        create_run(db_session, task, rev)
    stub = StubLLM()
    with pytest.raises(task_service.TaskNotWritable):
        task_service.revise_draft(db_session, task, draft_bp.id,
                                  requirement="补充说明", client=stub)
    assert stub.calls == 0  # 拦截发生在调用模型之前，不浪费配额
    with pytest.raises(task_service.TaskNotWritable):
        task_service.publish(db_session, task, draft_bp.id)


def test_reopen_restores_writes(db_session, scenario):
    """仅关闭可恢复；恢复后写操作重新放行。"""
    task, subject, submission = scenario
    task_service.close_task(db_session, task)
    task_service.reopen_task(db_session, task)
    assert task.status == TASK_COLLECTING

    v = sub.save_draft(db_session, submission, {"name": "张三"})
    assert v == submission.draft_version
    rev = _formal(db_session, task, submission, key="k1")
    run = create_run(db_session, task, rev)
    assert run.status == RUN_QUEUED


def test_archive_requires_closed(db_session, scenario):
    """归档只允许从关闭态进入，重复归档报错。"""
    task, subject, submission = scenario
    with pytest.raises(ValueError):
        task_service.archive_task(db_session, task)
    task_service.close_task(db_session, task)
    task_service.archive_task(db_session, task)
    assert task.status == "archived"
    with pytest.raises(ValueError):
        task_service.archive_task(db_session, task)


def test_archive_blocked_by_pending_check(db_session, scenario):
    """存在排队/执行中的检查时拒绝归档（表 6：先等检查完成）。"""
    task, subject, submission = scenario
    rev = _formal(db_session, task, submission, key="k1")
    run = create_run(db_session, task, rev)
    task_service.close_task(db_session, task)
    with pytest.raises(ValueError) as e:
        task_service.archive_task(db_session, task)
    assert "检查" in str(e.value)
    run.status = RUN_SUCCESS
    db_session.flush()
    task_service.archive_task(db_session, task)
    assert task.status == "archived"


def test_reopen_rejects_terminal_states(db_session, scenario):
    """归档/取消后不可恢复；收集中不可恢复。"""
    task, subject, submission = scenario
    with pytest.raises(ValueError):
        task_service.reopen_task(db_session, task)  # 收集中
    task_service.close_task(db_session, task)
    task_service.reopen_task(db_session, task)
    with pytest.raises(ValueError):
        task_service.reopen_task(db_session, task)  # 已恢复，当前是收集中
    task_service.close_task(db_session, task)
    task_service.archive_task(db_session, task)
    with pytest.raises(ValueError):
        task_service.reopen_task(db_session, task)  # 归档是终态


def test_cancel_rules(db_session, scenario):
    """取消：收集中可取消；重复取消/终态关闭被拒；归档后不可取消。"""
    task, subject, submission = scenario
    task_service.cancel_task(db_session, task)
    assert task.status == "cancelled"
    with pytest.raises(ValueError):
        task_service.cancel_task(db_session, task)
    with pytest.raises(ValueError):
        task_service.close_task(db_session, task)

    task2 = make_task(db_session, name="第二个任务")
    task_service.close_task(db_session, task2)
    task_service.archive_task(db_session, task2)
    with pytest.raises(ValueError):
        task_service.cancel_task(db_session, task2)


def test_lifecycle_audit_events(db_session, scenario):
    """关闭/恢复/归档/取消全部落审计，含操作者与来源状态。"""
    task, subject, submission = scenario
    task_service.close_task(db_session, task, actor="account:7")
    task_service.reopen_task(db_session, task, actor="account:7")
    task_service.close_task(db_session, task, actor="account:7")
    task_service.archive_task(db_session, task, actor="account:7")
    task3 = make_task(db_session, name="第三个任务")
    task_service.cancel_task(db_session, task3, actor="account:7")

    closes = db_session.scalars(select(AuditEvent).where(
        AuditEvent.task_id == task.id, AuditEvent.action == "task.close")).all()
    assert len(closes) == 2
    assert json.loads(closes[0].payload_json)["from"] == "collecting"
    assert closes[0].actor == "account:7"
    for action in ("task.reopen", "task.archive"):
        assert db_session.scalar(select(AuditEvent).where(
            AuditEvent.task_id == task.id, AuditEvent.action == action)) is not None
    assert db_session.scalar(select(AuditEvent).where(
        AuditEvent.task_id == task3.id, AuditEvent.action == "task.cancel")) is not None


# ---------------------------------------------------------------- API 层
@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _register(client, username, password="pw123456"):
    assert client.post("/api/accounts",
                       data={"username": username, "password": password}).status_code == 200
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mk_task(client, headers, name="团课报告收集"):
    r = client.post("/api/tasks", data={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def _grant_headers(client, headers, task_id, name="张三"):
    r = client.post(f"/api/tasks/{task_id}/grants",
                    data={"subject_name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['credential']}"}


def _submit(client, sub_headers, key="k1"):
    return client.post("/api/me/submit", headers=sub_headers,
                       json={**class_report_payload(client, sub_headers), "idempotency_key": key})


def _publish_template(client, headers, task_id, template="class_report"):
    r = client.post(f"/api/tasks/{task_id}/draft/template",
                    data={"template": template}, headers=headers)
    assert r.status_code == 200, r.text
    bp_id = r.json()["blueprint_version_id"]
    r = client.post(f"/api/tasks/{task_id}/blueprints/{bp_id}/publish", headers=headers)
    assert r.status_code == 200, r.text


def test_api_close_blocks_submit_and_reopen_restores(client, db_session):
    """关闭后提交 409；恢复后可提交（未发布蓝图时明确 422，不是 500）。"""
    headers = _register(client, "org-life")
    task_id = _mk_task(client, headers)
    sub_headers = _grant_headers(client, headers, task_id)

    r = client.post(f"/api/tasks/{task_id}/close", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "closed"

    assert _submit(client, sub_headers, key="k-closed").status_code == 409

    r = client.post(f"/api/tasks/{task_id}/reopen", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "collecting"

    r = _submit(client, sub_headers, key="k-reopened")
    assert r.status_code == 422  # 尚未发布蓝图：明确 422

    _publish_template(client, headers, task_id)
    r = _submit(client, sub_headers, key="k-final")
    assert r.status_code == 200, r.text
    assert r.json()["run_id"] > 0


def test_api_archive_flow(client, db_session):
    """收集中不可归档；有未完成检查不可归档；检查完成后可归档，归档后全只读。"""
    headers = _register(client, "org-arc")
    task_id = _mk_task(client, headers)
    sub_headers = _grant_headers(client, headers, task_id)
    _publish_template(client, headers, task_id)
    assert _submit(client, sub_headers, key="k1").status_code == 200

    assert client.post(f"/api/tasks/{task_id}/archive", headers=headers).status_code == 409
    assert client.post(f"/api/tasks/{task_id}/close", headers=headers).status_code == 200
    r = client.post(f"/api/tasks/{task_id}/archive", headers=headers)
    assert r.status_code == 409 and "检查" in r.json()["detail"]

    run = db_session.scalar(select(CheckRun))
    run.status = RUN_SUCCESS
    db_session.commit()

    r = client.post(f"/api/tasks/{task_id}/archive", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "archived"
    # 归档是终态：不可恢复、不可取消、不可提交
    assert client.post(f"/api/tasks/{task_id}/reopen", headers=headers).status_code == 409
    assert client.post(f"/api/tasks/{task_id}/cancel", headers=headers).status_code == 409
    assert _submit(client, sub_headers, key="k2").status_code == 409


def test_api_cancel_is_terminal(client, db_session):
    """取消后：不可关闭/恢复，提交 409。"""
    headers = _register(client, "org-can")
    task_id = _mk_task(client, headers)
    sub_headers = _grant_headers(client, headers, task_id)
    r = client.post(f"/api/tasks/{task_id}/cancel", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert client.post(f"/api/tasks/{task_id}/close", headers=headers).status_code == 409
    assert client.post(f"/api/tasks/{task_id}/reopen", headers=headers).status_code == 409
    assert _submit(client, sub_headers).status_code == 409


def test_api_lifecycle_cross_user_forbidden(client, db_session):
    """组织者只能操作自己的任务（越权统一 404，不泄露存在性）。"""
    h1 = _register(client, "org-x1")
    h2 = _register(client, "org-x2")
    t1 = _mk_task(client, h1, "甲的任务")
    assert client.post(f"/api/tasks/{t1}/close", headers=h2).status_code == 404
    assert client.post(f"/api/tasks/{t1}/cancel", headers=h2).status_code == 404
