# -*- coding: utf-8 -*-
"""V15 回归：v1 延迟完成、v2 已检查。

规格（附录 A 续一 · V15）：
    预期：v1 仅入历史，当前不回退、不误发提醒。
    证据：当前指针、run、事件。

覆盖四条回归线：
1. v1 已验收后 v2 正式提交并检查完成 → 验收回到待定（accept_current 绑定版本，不静默继承）；
2. v1 的检查迟到达成（延迟完成）→ 当前指针与摘要仍指向 v2，不回退；
3. 已正式提交的主体（含迟交后补正）不在催交名单，不误发提醒（V15 × V24 名单重算）；
4. v1 仅入历史：修订、运行、结果、验收决定与审计事件全部保留，不被删除或改写。
"""
from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.models import (
    ACCEPTANCE_ACCEPTED,
    ACCEPTANCE_PENDING,
    AuditEvent,
    ManualDecision,
    Revision,
    RuleResult,
    Subject,
)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.services import decisions as dec
from app.services import notifications as notif
from app.services.checks import create_run, current_summary, execute_run
from app.services.submissions import attach_file, formal_submit, get_or_create_draft
from tests.conftest import StubLLM, make_task, publish_blueprint


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


def _submit(db, task, subject, key, text="本人姓名：张三，期次第 1 期"):
    """正式提交一个版本：附带一份可读取的文本材料（语义规则才有材料可审）。"""
    sub = get_or_create_draft(db, task, subject.id)
    has_formal = sub.current_revision_id is not None
    fo = attach_file(db, sub, slot="report", original_name="报告.txt",
                     content=text.encode("utf-8"), sha256="", mime="text/plain")
    return formal_submit(db, task, sub, fields={"name": "张三"},
                         slot_file_ids={"report": [fo.file_id]}, idempotency_key=key,
                         is_correction=has_formal)


def _run_ok(db, task, rev):
    """为指定版本执行一次成功检查（语义规则 satisfied，不触网）。"""
    stub = StubLLM(responses=[{
        "result": "satisfied", "explanation": "期次一致",
        "evidence": [{"file_id": "", "locator": "p.1", "quote": "本人姓名：张三"}],
    }])
    run = create_run(db, task, rev)
    execute_run(db, run, client=stub)
    assert run.status == "success"
    return run


def test_accept_current_does_not_carry_to_v2(db_session):
    """v1 已验收 → v2 提交并检查完成后，验收回到待定，不静默继承旧验收。"""
    task, subject = _setup(db_session)
    v1 = _submit(db_session, task, subject, "k-v15a-1")
    _run_ok(db_session, task, v1)
    dec.record_decision(db_session, task, subject, decision="accept_current",
                        reason="v1 逐条核对无误")
    s1 = current_summary(db_session, task, subject.id)
    assert s1["summary"] == "已验收"
    assert s1["acceptance"] == ACCEPTANCE_ACCEPTED

    # v2 正式提交（补正）：当前指针前移，v1 的验收决定不覆盖 v2
    v2 = _submit(db_session, task, subject, "k-v15a-2",
                 text="本人姓名：张三，期次第 1 期（补正后）")
    assert v2.version == 2
    s_wait = current_summary(db_session, task, subject.id)
    assert s_wait["summary"] == "排队中"
    assert s_wait["acceptance"] == ACCEPTANCE_PENDING

    _run_ok(db_session, task, v2)
    s2 = current_summary(db_session, task, subject.id)
    assert s2["revision"] == 2
    assert s2["summary"] == "规则通过（待人工验收）"
    assert s2["acceptance"] == ACCEPTANCE_PENDING


def test_late_v1_completion_does_not_regress_current(db_session):
    """v1 的检查迟到达成：当前指针与摘要仍指向 v2，v1 仅入历史。"""
    task, subject = _setup(db_session)
    v1 = _submit(db_session, task, subject, "k-v15b-1")
    v2 = _submit(db_session, task, subject, "k-v15b-2",
                 text="本人姓名：张三，期次第 1 期（第二版）")
    # v2 先提交、先检查完成（"v2 已检查"）
    run2 = _run_ok(db_session, task, v2)

    # v1 延迟完成：迟到的检查运行现在才执行完
    run1 = _run_ok(db_session, task, v1)

    sub = get_or_create_draft(db_session, task, subject.id)
    assert sub.current_revision_id == v2.id          # 当前指针不回退
    s = current_summary(db_session, task, subject.id)
    assert s["revision"] == 2                        # 摘要仍对 v2
    assert s["run_status"] == "success"
    # 两个运行各自保留，互不覆盖
    assert run1.revision_id == v1.id and run2.revision_id == v2.id
    assert run1.status == "success" and run2.status == "success"
    assert db_session.scalar(select(RuleResult).where(RuleResult.run_id == run1.id)) is not None
    assert db_session.scalar(select(RuleResult).where(RuleResult.run_id == run2.id)) is not None


def test_formal_submitter_never_in_reminder_targets(db_session):
    """已正式提交（含迟交后补正）的主体不在催交名单，不误发提醒（V15 × V24）。"""
    task, subject = _setup(db_session)
    late = Subject(task_id=task.id, kind="individual", display_name="李四")
    db_session.add(late)
    db_session.flush()
    _submit(db_session, task, subject, "k-v15c-1")
    _submit(db_session, task, subject, "k-v15c-2", text="本人姓名：张三，期次第 1 期（修订）")

    view = notif.reminder_view(db_session, task)
    assert subject.id in {r["subject_id"] for r in view["submitted"]}
    assert subject.id not in {r["subject_id"] for r in view["targets"]}
    assert late.id in {r["subject_id"] for r in view["targets"]}
    # 默认催交只覆盖未提交者；显式催交已提交者被拒绝
    intent = notif.create_notification(db_session, task, content="请尽快补齐材料")
    assert [t["subject_id"] for t in json.loads(intent.targets_json)] == [late.id]
    with pytest.raises(notif.NotificationError):
        notif.create_notification(db_session, task, content="催交已提交者",
                                  subject_ids=[subject.id])


def test_v1_and_its_run_kept_as_history(db_session):
    """v1 仅入历史：修订、运行、结果、验收决定与审计事件全部保留。"""
    task, subject = _setup(db_session)
    v1 = _submit(db_session, task, subject, "k-v15d-1")
    run1 = _run_ok(db_session, task, v1)
    accept = dec.record_decision(db_session, task, subject, decision="accept_current",
                                 reason="v1 逐条核对无误")
    v2 = _submit(db_session, task, subject, "k-v15d-2",
                 text="本人姓名：张三，期次第 1 期（修订）")
    _run_ok(db_session, task, v2)

    sub = get_or_create_draft(db_session, task, subject.id)
    revs = db_session.scalars(
        select(Revision).where(Revision.submission_id == sub.id)
        .order_by(Revision.version)).all()
    assert [r.version for r in revs] == [1, 2]
    assert revs[0].receipt != revs[1].receipt           # 两版回执各自独立
    assert run1.status == "success"                      # v1 运行仍在，未被 superseded
    assert db_session.scalars(select(RuleResult).where(
        RuleResult.run_id == run1.id)).all()            # v1 结果仍在
    old = db_session.get(ManualDecision, accept.id)
    assert old is not None and old.revoked is False and old.revision_id == v1.id
    actions = [e.action for e in db_session.scalars(select(AuditEvent).where(
        AuditEvent.task_id == task.id)).all()]
    assert actions.count("submission.formal") == 2
    assert "decision.accept_current" in actions
