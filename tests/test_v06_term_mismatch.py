# -*- coding: utf-8 -*-
# V06：报告写明第 2 期、登记第 1 期——差异定位准确（证据可在原文定位），
# 补正路径可操作（补正后新版本重新检查转 satisfied），旧版本与运行留痕。
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import (RESULT_ISSUE, RESULT_SATISFIED, Evidence, Revision,
                        RuleResult, Subject)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.services import submissions as sub
from app.services.checks import create_run, current_summary, execute_run
from tests.conftest import StubLLM, make_task, publish_blueprint

RULE_ID = "C-R03"
FILE_TEXT = "姓名：张三 期次：2026 秋季第 2 期 团课报告，完成了小组实验与讨论。"
QUOTE = "期次：2026 秋季第 2 期"


def _bp():
    return Blueprint(
        task_scope={"name": "团课报告收集", "template": "class_report"},
        fields=[FieldDef(id="name", label="姓名", required=True),
                FieldDef(id="term", label="期次", required=True)],
        slots=[SlotDef(id="report", label="团课报告", formats=["pdf", "txt"], max_count=1)],
        rules=[RuleDef(id=RULE_ID, statement="报告内写明期次须与登记期次一致",
                       requirement_source="报告内写明期次须与登记期次一致",
                       executor="semantic")],
    )


def _setup(db):
    now = datetime.now(timezone.utc)
    task = make_task(db, name="团课报告", mode="roster",
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=3),
                     correction_deadline=now + timedelta(days=7))
    publish_blueprint(db, task, _bp())
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db.add(subject)
    db.flush()
    submission = sub.get_or_create_draft(db, task, subject.id)
    f = sub.attach_file(db, submission, slot="report", original_name="报告.txt",
                        content=FILE_TEXT.encode("utf-8"), sha256="", mime="text/plain")
    return task, subject, submission, f


def _submit_and_run(db, task, submission, f, fields, key, responses):
    rev = sub.formal_submit(db, task, submission, fields=fields,
                            slot_file_ids={"report": [f.file_id]},
                            idempotency_key=key)
    run = create_run(db, task, rev)
    execute_run(db, run, client=StubLLM(responses=responses))
    r = db.scalar(select(RuleResult).where(RuleResult.run_id == run.id,
                                           RuleResult.rule_id == RULE_ID))
    return rev, run, r


def test_term_mismatch_located_with_evidence(db_session):
    """报告第 2 期 vs 登记第 1 期：差异定位准确，证据可在原文定位，摘要待补正。"""
    task, subject, submission, f = _setup(db_session)
    _rev, _run, r = _submit_and_run(
        db_session, task, submission, f,
        {"name": "张三", "term": "2026 秋季第 1 期"}, "k-v6-mismatch",
        [{"result": "issue",
          "explanation": "报告写明 2026 秋季第 2 期，登记为 2026 秋季第 1 期，不一致",
          "next_step": "在补正截止前重新提交与登记期次（第 1 期）一致的报告，或联系组织者更正登记",
          "evidence": [{"quote": QUOTE, "locator": "page 1"}]}])
    assert r.result == RESULT_ISSUE
    assert "第 1 期" in r.explanation and "第 2 期" in r.explanation
    assert "补正" in (r.next_step or "")
    evs = db_session.scalars(select(Evidence).where(
        Evidence.rule_result_id == r.id)).all()
    assert len(evs) == 1 and evs[0].quote == QUOTE and evs[0].method == "llm"
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "待补正"
    assert summary["buckets"]["blocking"] == [RULE_ID]


def test_term_match_satisfied(db_session):
    """期次一致：规则满足，待人工验收。"""
    task, subject, submission, f = _setup(db_session)
    _rev, _run, r = _submit_and_run(
        db_session, task, submission, f,
        {"name": "张三", "term": "2026 秋季第 2 期"}, "k-v6-match",
        [{"result": "satisfied", "explanation": "报告期次与登记一致",
          "evidence": [{"quote": QUOTE, "locator": "page 1"}]}])
    assert r.result == RESULT_SATISFIED
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "规则通过（待人工验收）"


def test_correction_path_clears_issue(db_session):
    """补正路径可操作：登记期次更正后重新提交，新版本检查通过，旧版本留痕。"""
    task, subject, submission, f = _setup(db_session)
    rev1, run1, r1 = _submit_and_run(
        db_session, task, submission, f,
        {"name": "张三", "term": "2026 秋季第 1 期"}, "k-v6-fix-1",
        [{"result": "issue", "explanation": "期次不一致",
          "next_step": "补正", "evidence": [{"quote": QUOTE, "locator": "page 1"}]}])
    assert r1.result == RESULT_ISSUE
    rev2, run2, r2 = _submit_and_run(
        db_session, task, submission, f,
        {"name": "张三", "term": "2026 秋季第 2 期"}, "k-v6-fix-2",
        [{"result": "satisfied", "explanation": "报告期次与登记一致",
          "evidence": [{"quote": QUOTE, "locator": "page 1"}]}])
    assert rev2.version == 2 and rev2.id != rev1.id
    assert r2.result == RESULT_SATISFIED
    # 旧版本与旧运行留痕不篡改（跨版本不互相取代，当前指针只认新版本）
    assert run1.status == "success"
    assert run1.id != run2.id
    old = db_session.scalar(select(RuleResult).where(
        RuleResult.run_id == run1.id, RuleResult.rule_id == RULE_ID))
    assert old.result == RESULT_ISSUE
    assert db_session.get(Revision, rev1.id).version == 1
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "规则通过（待人工验收）"
    assert summary["revision"] == 2
