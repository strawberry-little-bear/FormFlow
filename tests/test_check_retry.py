# -*- coding: utf-8 -*-
"""检查重试测试（V20 / 表 6：模型或 OCR 故障可重试）。

- execute_run 对未预期异常标记 failed 并记录原因（不再永久卡在 running）；
- 仅失败/含失败规则的运行可重试；进行中与已成功（无失败项）运行拒绝重试；
- 重试为同一正式版本创建新运行，旧运行标记被取代，历史结果与证据保留；
- 重试后当前摘要以新运行为准；
- 只读任务（已关闭）不允许重试；
- API：retry 端点 200/409 与越权 404。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agents.review_agent import run_checks as real_run_checks
from app.main import app
from app.models import (
    RESULT_FAILED,
    RESULT_SATISFIED,
    RUN_FAILED,
    RUN_QUEUED,
    RUN_SUPERSEDED,
    RUN_SUCCESS,
    RuleResult,
    Subject,
)
from app.schemas import Blueprint, RuleDef
from app.services import submissions as sub
from app.services import tasks as task_service
from app.services.checks import create_run, current_summary, execute_run, retry_run
from tests.conftest import make_task, publish_blueprint


@pytest.fixture()
def scenario(db_session):
    """收集中任务 + 已发布蓝图（一条确定性规则，不依赖外部模型）+ 已正式提交。"""
    now = datetime.now(timezone.utc)
    task = make_task(db_session,
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=7),
                     correction_deadline=now + timedelta(days=14))
    publish_blueprint(db_session, task, Blueprint(
        fields=[],
        slots=[],
        rules=[RuleDef(id="D-R01", statement="姓名必填",
                       requirement_source="包含姓名", executor="deterministic",
                       check={"kind": "field_required", "field": "name"})],
    ))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    rev = sub.formal_submit(db_session, task, submission, fields={"name": "张三"},
                            slot_file_ids={}, idempotency_key="k1")
    return task, subject, submission, rev


def _boom(ctx, client=None):
    raise RuntimeError("网关爆炸")


def _mark_failed(db, run):
    db.add(RuleResult(run_id=run.id, rule_id="D-R01", result=RESULT_FAILED,
                      explanation="模型不可用，语义检查未完成"))
    db.flush()


# ---------------------------------------------------------------- 服务层
def test_execute_run_marks_failed_on_unexpected_error(db_session, scenario, monkeypatch):
    """未预期异常：运行标记 failed 并记录原因，不再永久卡在 running（V20）。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    monkeypatch.setattr("app.services.checks.run_checks", _boom)
    out = execute_run(db_session, run)
    assert out.status == RUN_FAILED
    assert "网关爆炸" in out.error
    summary = current_summary(db_session, task, subject.id)
    assert summary["run_status"] == RUN_FAILED
    assert summary["summary"] == "检查未完成"


def test_retry_after_failure_creates_new_run(db_session, scenario, monkeypatch):
    """失败后可重试：新运行顶替旧运行，旧运行标记被取代，历史结果保留。"""
    task, subject, submission, rev = scenario
    run1 = create_run(db_session, task, rev)
    monkeypatch.setattr("app.services.checks.run_checks", _boom)
    execute_run(db_session, run1)
    assert run1.status == RUN_FAILED

    monkeypatch.undo()  # 恢复确定性规则的真实执行（不调外部模型）
    run2 = retry_run(db_session, run1)
    assert run2.id != run1.id and run2.revision_id == rev.id
    assert run2.status == RUN_QUEUED
    assert run1.status == RUN_SUPERSEDED  # 历史保留但不再参与当前摘要
    execute_run(db_session, run2)
    assert run2.status == RUN_SUCCESS

    results = db_session.scalars(select(RuleResult).where(
        RuleResult.run_id == run2.id)).all()
    assert [r.result for r in results] == [RESULT_SATISFIED]
    summary = current_summary(db_session, task, subject.id)
    assert summary["run_status"] == RUN_SUCCESS
    assert summary["buckets"]["incomplete"] == []


def test_retry_rejects_in_flight_run(db_session, scenario):
    """排队中的运行不可重试。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    with pytest.raises(ValueError) as e:
        retry_run(db_session, run)
    assert "正在进行" in str(e.value)


def test_retry_rejects_success_without_failures(db_session, scenario):
    """全部满足的成功运行无需重试。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    execute_run(db_session, run)
    assert run.status == RUN_SUCCESS
    with pytest.raises(ValueError) as e:
        retry_run(db_session, run)
    assert "无需重试" in str(e.value)


def test_retry_allowed_when_run_has_failed_rules(db_session, scenario):
    """模型故障：运行成功但规则 failed —— 显示未完成且可重试（表 6）。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    execute_run(db_session, run)
    _mark_failed(db_session, run)
    summary = current_summary(db_session, task, subject.id)
    assert summary["buckets"]["incomplete"] == ["D-R01"]
    assert summary["summary"] == "检查未完成"

    run2 = retry_run(db_session, run)
    assert run.status == RUN_SUPERSEDED
    execute_run(db_session, run2)
    summary2 = current_summary(db_session, task, subject.id)
    assert summary2["run_status"] == RUN_SUCCESS
    assert summary2["buckets"]["incomplete"] == []
    # 旧运行的失败结果仍在（历史不篡改）
    old = db_session.scalars(select(RuleResult).where(
        RuleResult.run_id == run.id, RuleResult.result == RESULT_FAILED)).all()
    assert len(old) == 1


def test_retry_rejects_superseded_run(db_session, scenario):
    """已被取代的旧运行不能再次重试。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    execute_run(db_session, run)
    _mark_failed(db_session, run)
    retry_run(db_session, run)
    with pytest.raises(ValueError) as e:
        retry_run(db_session, run)
    assert "取代" in str(e.value)


def test_retry_blocked_when_task_closed(db_session, scenario):
    """V24：只读任务（已关闭）不允许重试，且不产生半吊子状态。"""
    task, subject, submission, rev = scenario
    run = create_run(db_session, task, rev)
    execute_run(db_session, run)
    _mark_failed(db_session, run)
    task_service.close_task(db_session, task)
    with pytest.raises(task_service.TaskNotWritable):
        retry_run(db_session, run)
    assert run.status == RUN_SUCCESS  # 旧运行未被改写


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


def _publish_template(client, headers, task_id, template="class_report"):
    r = client.post(f"/api/tasks/{task_id}/draft/template",
                    data={"template": template}, headers=headers)
    assert r.status_code == 200, r.text
    bp_id = r.json()["blueprint_version_id"]
    r = client.post(f"/api/tasks/{task_id}/blueprints/{bp_id}/publish", headers=headers)
    assert r.status_code == 200, r.text


def _submit(client, sub_headers, key="k1"):
    return client.post("/api/me/submit", headers=sub_headers,
                       json={"fields": {"name": "张三"}, "slot_file_ids": {},
                             "idempotency_key": key})


def test_api_retry_after_failure(client, db_session, monkeypatch):
    """API：检查失败 → 重试生成新运行并成功；再次重试被拒（409）。"""
    state = {"n": 0}

    def flaky(ctx, client=None):
        state["n"] += 1
        if state["n"] == 1:
            raise RuntimeError("网关爆炸")
        return real_run_checks(ctx, client)

    monkeypatch.setattr("app.services.checks.run_checks", flaky)

    headers = _register(client, "org-retry")
    task_id = _mk_task(client, headers)
    sub_headers = _grant_headers(client, headers, task_id)
    _publish_template(client, headers, task_id)
    assert _submit(client, sub_headers, key="k1").status_code == 200

    r = client.post(f"/api/tasks/{task_id}/subjects/1/checks", headers=headers)
    assert r.status_code == 200 and r.json()["status"] == "failed"
    first_run = r.json()["run_id"]

    r = client.post(f"/api/tasks/{task_id}/subjects/1/checks/retry", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["retried_from"] == first_run
    assert body["run_id"] != first_run and body["status"] == "success"

    # 新运行已成功且无失败项：无需重试
    r = client.post(f"/api/tasks/{task_id}/subjects/1/checks/retry", headers=headers)
    assert r.status_code == 409
    assert "无需重试" in r.json()["detail"]


def test_api_retry_cross_user_forbidden(client, db_session, monkeypatch):
    """越权重试统一 404。"""
    monkeypatch.setattr("app.services.checks.run_checks", _boom)
    h1 = _register(client, "org-r1")
    h2 = _register(client, "org-r2")
    t1 = _mk_task(client, h1, "甲的任务")
    sub_headers = _grant_headers(client, h1, t1)
    _publish_template(client, h1, t1)
    assert _submit(client, sub_headers, key="k1").status_code == 200
    assert client.post(f"/api/tasks/{t1}/subjects/1/checks", headers=h1).status_code == 200
    r = client.post(f"/api/tasks/{t1}/subjects/1/checks/retry", headers=h2)
    assert r.status_code == 404
