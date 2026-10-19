# -*- coding: utf-8 -*-
"""V20 恢复用例：队列失败、服务重启（方案附录 A 续二 · V20）。

规格：同一导出快照不混包；提交意图可恢复；无数据丢失。
本文件覆盖 worker 侧恢复语义：
1. 排队中的运行在"重启"（新会话/新进程）后由轮询自动接管，提交意图不丢失；
2. 崩溃时停留在 running 的运行被恢复为排队，半成品结果被清除，重新执行不产生重复结论；
3. 已成功/已失败/被取代的运行是历史，恢复过程绝不触碰；
4. 批次中途崩溃（逐个提交语义）不丢掉已完成运行。
"""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.models import (
    RUN_FAILED,
    RUN_QUEUED,
    RUN_RUNNING,
    RUN_SUPERSEDED,
    AuditEvent,
    CheckRun,
    RuleResult,
    Subject,
)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.services.checks import create_run, execute_run
from app.services.submissions import attach_file, formal_submit, get_or_create_draft
from app.worker import recover_interrupted_runs, run_pending_once
from tests.conftest import StubLLM, make_task, publish_blueprint

SATISFIED = {"result": "satisfied", "explanation": "期次一致",
             "evidence": [{"file_id": "", "locator": "p.1", "quote": "本人姓名：张三"}]}


def _setup(db):
    task = make_task(db)
    publish_blueprint(db, task, Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告", formats=[".txt"])],
        rules=[RuleDef(id="C-R03", statement="期次一致", requirement_source="src",
                       executor="semantic")],
    ))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db.add(subject)
    db.flush()
    return task, subject


def _submit(db, task, subject, key, name="张三", text="本人姓名：张三，期次第 1 期"):
    sub = get_or_create_draft(db, task, subject.id)
    has_formal = sub.current_revision_id is not None
    fo = attach_file(db, sub, slot="report", original_name="报告.txt",
                     content=text.encode("utf-8"), sha256="", mime="text/plain")
    return formal_submit(db, task, sub, fields={"name": name},
                         slot_file_ids={"report": [fo.file_id]}, idempotency_key=key,
                         is_correction=has_formal)


def _stub_execute(monkeypatch):
    """让 worker 用桩客户端执行检查（不触网）。"""
    from app.services.checks import execute_run as real_execute

    def fake(db, run, client=None):
        return real_execute(db, run, client=StubLLM(responses=[dict(SATISFIED)]))
    monkeypatch.setattr("app.worker.execute_run", fake)


def test_queued_run_resumes_after_restart(db_session, monkeypatch):
    """重启后排队中的运行被自动接管：正式提交意图不丢失。"""
    _stub_execute(monkeypatch)
    task, subject = _setup(db_session)
    rev = _submit(db_session, task, subject, "k-w1")
    rev_id = rev.id
    create_run(db_session, task, rev)          # 排队中，尚未执行
    db_session.commit()
    db_session.close()                          # 模拟进程退出

    s2 = Session(engine)                        # 重启后的新进程
    try:
        assert recover_interrupted_runs(s2) == 0     # 没有卡在 running 的运行
        assert run_pending_once(s2) == 1             # 排队的运行被接管执行
        run = s2.scalar(select(CheckRun).where(CheckRun.revision_id == rev_id))
        assert run.status == "success"
        assert s2.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all()
    finally:
        s2.close()


def test_interrupted_run_recovered_without_duplicate_results(db_session, monkeypatch):
    """崩溃停留在 running 的运行：恢复为排队、清半成品、重执行不重复结论。"""
    _stub_execute(monkeypatch)
    task, subject = _setup(db_session)
    rev = _submit(db_session, task, subject, "k-w2")
    task_id = task.id
    run = create_run(db_session, task, rev)
    run_id = run.id
    # 模拟崩溃：状态停留 running，且残留了半成品结果
    run.status = RUN_RUNNING
    db_session.add(RuleResult(run_id=run.id, rule_id="C-R03", result="unknown",
                              explanation="中断残流"))
    db_session.commit()
    db_session.close()

    s2 = Session(engine)
    try:
        assert recover_interrupted_runs(s2) == 1
        r2 = s2.get(CheckRun, run_id)
        assert r2.status == RUN_QUEUED
        # 半成品结果已清除，重新执行后每条规则只有一条结论
        assert s2.scalars(select(RuleResult).where(RuleResult.run_id == run_id)).all() == []
        assert run_pending_once(s2) == 1
        r3 = s2.get(CheckRun, run_id)
        assert r3.status == "success"
        results = s2.scalars(select(RuleResult).where(RuleResult.run_id == run_id)).all()
        assert len(results) == 1 and results[0].result == "satisfied"
        actions = [e.action for e in s2.scalars(select(AuditEvent).where(
            AuditEvent.task_id == task_id)).all()]
        assert "check.recovered" in actions
    finally:
        s2.close()


def test_history_runtimes_untouched_by_recovery(db_session):
    """成功/失败/被取代的运行是历史，恢复过程绝不触碰。"""
    task, subject = _setup(db_session)
    rev = _submit(db_session, task, subject, "k-w3")
    ok_run = create_run(db_session, task, rev)
    ok_id = ok_run.id
    execute_run(db_session, ok_run, client=StubLLM(responses=[dict(SATISFIED)]))
    db_session.commit()
    failed_run = create_run(db_session, task, rev)   # 同版本再建 → ok_run 被 superseded
    failed_id = failed_run.id
    failed_run.status = RUN_FAILED
    failed_run.error = "模型服务不可用"
    db_session.commit()
    db_session.close()

    s2 = Session(engine)
    try:
        assert recover_interrupted_runs(s2) == 0
        assert s2.get(CheckRun, ok_id).status == RUN_SUPERSEDED
        assert s2.get(CheckRun, failed_id).status == RUN_FAILED
        assert s2.get(CheckRun, failed_id).error == "模型服务不可用"
    finally:
        s2.close()


def test_completed_run_survives_batch_crash(db_session, monkeypatch):
    """批次中途崩溃：已完成的运行已提交保留，未完成的留在队列可重跑（无数据丢失）。"""
    from app.services.checks import execute_run as real_execute

    task, subject = _setup(db_session)
    other = Subject(task_id=task.id, kind="individual", display_name="李四")
    db_session.add(other)
    db_session.flush()
    rev_a = _submit(db_session, task, subject, "k-w4a")
    rev_b = _submit(db_session, task, other, "k-w4b")
    run_a = create_run(db_session, task, rev_a)
    run_b = create_run(db_session, task, rev_b)
    a_id, b_id = run_a.id, run_b.id
    db_session.commit()

    def fake(db, run, client=None):
        if run.id == b_id:
            raise RuntimeError("worker 在批次中途崩溃")
        return real_execute(db, run, client=StubLLM(responses=[dict(SATISFIED)]))
    monkeypatch.setattr("app.worker.execute_run", fake)
    with pytest.raises(RuntimeError):
        run_pending_once(db_session)

    s2 = Session(engine)
    try:
        assert s2.get(CheckRun, a_id).status == "success"   # 已完成的不丢
        assert s2.get(CheckRun, b_id).status == RUN_QUEUED  # 未完成的留在队列
        # 崩溃恢复后重跑，第二个运行也能完成
        monkeypatch.setattr("app.worker.execute_run",
                            lambda db, run, client=None:
                            real_execute(db, run, client=StubLLM(responses=[dict(SATISFIED)])))
        assert run_pending_once(s2) == 1
        assert s2.get(CheckRun, b_id).status == "success"
    finally:
        s2.close()
