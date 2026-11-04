# -*- coding: utf-8 -*-
# V11/V12 端到端：加密/损坏/伪装扩展名文件按技术原因处理（不执行、不公开、不算资格拒绝）；
# 模型服务不可用时收件回执仍有效、语义检查标记未完成（不虚报全通过），恢复后可重试。
from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.llm import LLMBudgetExceeded, LLMUnavailable
from app.models import (RESULT_FAILED, RESULT_ISSUE, RESULT_SATISFIED,
                        RESULT_UNKNOWN, RUN_SUPERSEDED, Evidence, FileObject,
                        RuleResult, Subject)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.services import submissions as sub
from app.services.checks import (create_run, current_summary, execute_run,
                                 retry_run)
from tests.conftest import legacy_revision, StubLLM, make_task, publish_blueprint

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"


@pytest.fixture(scope="module", autouse=True)
def _ensure_samples():
    if not (SAMPLES / "normal.pdf").exists():
        import scripts.make_samples as ms
        ms.main()


FILE_RULE = RuleDef(id="C-FILE", statement="报告槽位文件须为 PDF",
                    requirement_source="报告槽位文件须为 PDF",
                    executor="deterministic",
                    check={"kind": "slot_constraints", "slot": "report"})
SEMANTIC_RULE = RuleDef(id="S-NAME", statement="报告须写明姓名与期次",
                        requirement_source="报告须写明姓名与期次",
                        executor="semantic")


def _bp():
    return Blueprint(
        fields=[FieldDef(id="name", label="姓名", required=True)],
        slots=[SlotDef(id="report", label="报告", formats=["pdf", "txt"], max_count=1)],
        rules=[FILE_RULE, SEMANTIC_RULE],
    )


def _setup(db, *, first_deadline_days=3):
    now = datetime.now(timezone.utc)
    task = make_task(db, name="团课报告", mode="open",
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=first_deadline_days),
                     correction_deadline=now + timedelta(days=first_deadline_days + 4))
    publish_blueprint(db, task, _bp())
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db.add(subject)
    db.flush()
    submission = sub.get_or_create_draft(db, task, subject.id)
    return task, subject, submission


def _attach_sample(db, submission, filename, slot="report"):
    content = (SAMPLES / filename).read_bytes()
    return sub.attach_file(db, submission, slot=slot, original_name=filename,
                           content=content, sha256="", mime="application/octet-stream")


def _run_and_get(db, task, submission, fields, key, client, slot_file_ids):
    rev = sub.formal_submit(db, task, submission, fields=fields,
                            slot_file_ids=slot_file_ids, idempotency_key=key)
    run = create_run(db, task, rev)
    execute_run(db, run, client=client)
    results = {r.rule_id: r for r in db.scalars(select(RuleResult).where(
        RuleResult.run_id == run.id)).all()}
    return rev, run, results


def _result_of(results, rule_id):
    return results[rule_id]


def test_corrupt_pdf_technical_failure_not_eligibility(db_session):
    """损坏 PDF：解析失败记技术原因；规则报缺失但不算资格拒绝。"""
    task, subject, submission = _setup(db_session)
    f = _attach_sample(db_session, submission, "corrupt.pdf")
    rev, run, results = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-corrupt",
        StubLLM(), {"report": [f.file_id]})
    assert rev.version == 1  # 收件回执有效
    fo = db_session.get(FileObject, f.id)
    assert fo.status == "failed" and fo.parse_error
    r = _result_of(results, "C-FILE")
    assert r.result == RESULT_ISSUE
    assert "解析失败" in r.explanation
    assert "技术原因，非资格拒绝" in r.explanation
    evs = db_session.scalars(select(Evidence).where(
        Evidence.rule_result_id == r.id)).all()
    assert any(e.method == "parse" and e.quote for e in evs)
    # 不算资格拒绝：主体资格保持未评估
    assert subject.eligibility == "not_assessed"
    # 无可读文本：语义规则 unknown，不虚报通过
    assert _result_of(results, "S-NAME").result == RESULT_UNKNOWN
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "待补正"
    assert summary["buckets"]["blocking"] == ["C-FILE"]
    assert summary["acceptance"] == "not_accepted"


def test_encrypted_pdf_technical_failure(db_session):
    """加密 PDF：无密码读不出，按技术原因处理（V11）。"""
    task, subject, submission = _setup(db_session)
    f = _attach_sample(db_session, submission, "encrypted.pdf")
    _rev, _run, results = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-enc",
        StubLLM(), {"report": [f.file_id]})
    fo = db_session.get(FileObject, f.id)
    assert fo.status == "failed"
    assert "加密" in fo.parse_error
    r = _result_of(results, "C-FILE")
    assert r.result == RESULT_ISSUE
    assert "加密" in r.explanation
    assert subject.eligibility == "not_assessed"


def test_legacy_doc_rejected_as_technical(db_session):
    """旧版 OLE2 文档：提示另存 docx，技术原因非资格拒绝。"""
    task, subject, submission = _setup(db_session)
    f = _attach_sample(db_session, submission, "legacy.doc")
    with pytest.raises(sub.SubmissionValidationError, match="只接受"):
        sub.formal_submit(db_session, task, submission, fields={"name": "张三"},
                          slot_file_ids={"report": [f.file_id]}, idempotency_key="new-doc")
    # Already-recorded legacy files still get technical feedback, not disqualification.
    _rev = legacy_revision(db_session, submission, fields={"name": "张三"},
                           files={"report": [f.file_id]}, key="k-legacy")
    _run = create_run(db_session, task, _rev)
    execute_run(db_session, _run, client=StubLLM())
    results = {r.rule_id: r for r in db_session.scalars(
        select(RuleResult).where(RuleResult.run_id == _run.id)).all()}
    fo = db_session.get(FileObject, f.id)
    assert fo.status == "failed"
    r = _result_of(results, "C-FILE")
    assert r.result == RESULT_ISSUE
    assert "docx" in r.explanation
    assert subject.eligibility == "not_assessed"


def test_disguised_pdf_flagged_by_real_content(db_session):
    """伪装扩展名：.pdf 名字、DOCX 内容——按真实类型判不符（不轻信扩展名）。"""
    task, subject, submission = _setup(db_session)
    f = _attach_sample(db_session, submission, "disguised.pdf")
    _rev, _run, results = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-disguise",
        StubLLM(), {"report": [f.file_id]})
    fo = db_session.get(FileObject, f.id)
    assert fo.status == "ready"  # 内容本身可解析，只是类型不符
    r = _result_of(results, "C-FILE")
    assert r.result == RESULT_ISSUE
    assert "docx" in r.explanation
    assert "按真实内容判定" in r.explanation


def test_failed_file_cannot_reenter_snapshot(db_session):
    """解析失败的文件不能随补正悄悄再入快照：明确拒绝并指引重新上传。"""
    task, subject, submission = _setup(db_session)
    f = _attach_sample(db_session, submission, "corrupt.pdf")
    sub.formal_submit(db_session, task, submission, fields={"name": "张三"},
                      slot_file_ids={"report": [f.file_id]},
                      idempotency_key="k-first")
    run = create_run(db_session, task,
                     db_session.get(__import__("app.models", fromlist=["Revision"]).Revision,
                                    submission.current_revision_id))
    execute_run(db_session, run, client=StubLLM())
    assert db_session.get(FileObject, f.id).status == "failed"
    with pytest.raises(sub.SubmitError) as ei:
        sub.formal_submit(db_session, task, submission, fields={"name": "张三"},
                          slot_file_ids={"report": [f.file_id]},
                          idempotency_key="k-fix-same-broken")
    assert "处理失败" in str(ei.value)


def _readable_setup(db):
    task, subject, submission = _setup(db)
    content = "姓名：张三 期次：2026 秋季第 1 期 团课报告，完成了小组实验。".encode("utf-8")
    f = sub.attach_file(db, submission, slot="report", original_name="报告.txt",
                        content=content, sha256="", mime="text/plain")
    return task, subject, submission, f


def test_receipt_valid_when_llm_unavailable(db_session):
    """模型不可用：回执仍有效；语义检查标记未完成，不虚报全通过（V12）。"""
    task, subject, submission, f = _readable_setup(db_session)
    rev, run, results = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-llm-down",
        StubLLM(error=LLMUnavailable("网关 502")), {"report": [f.file_id]})
    # 收件回执有效：正式版本已记录
    assert rev.version == 1
    assert submission.current_revision_id == rev.id
    assert run.status == "success"  # 运行本身完成，故障在规则级可见
    r = _result_of(results, "S-NAME")
    assert r.result == RESULT_FAILED
    assert "语义检查未完成" in r.explanation
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "检查未完成"
    assert summary["buckets"]["incomplete"] == ["S-NAME"]
    assert summary["acceptance"] == "pending"


def test_budget_exhausted_marks_incomplete(db_session, monkeypatch):
    """预算耗尽：语义检查未完成且运行记录预算标记，不虚报通过。"""
    from app.config import settings
    monkeypatch.setattr(settings, "max_llm_calls_per_run", 0)
    task, subject, submission, f = _readable_setup(db_session)
    _rev, run, results = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-budget",
        StubLLM(), {"report": [f.file_id]})
    assert run.budget_exhausted is True
    r = _result_of(results, "S-NAME")
    assert r.result == RESULT_FAILED
    assert "预算耗尽" in r.explanation
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "检查未完成"


def test_retry_recovers_after_llm_back(db_session):
    """服务恢复后重试：新运行出结论，旧运行与失败结果留痕不篡改。"""
    task, subject, submission, f = _readable_setup(db_session)
    _rev, run1, results1 = _run_and_get(
        db_session, task, submission, {"name": "张三"}, "k-down",
        StubLLM(error=LLMUnavailable("网关 502")), {"report": [f.file_id]})
    assert _result_of(results1, "S-NAME").result == RESULT_FAILED
    run2 = retry_run(db_session, run1)
    ok = StubLLM(responses=[{
        "result": "satisfied", "explanation": "已写明姓名与期次",
        "evidence": [{"quote": "姓名：张三", "locator": "page 1"}],
    }])
    execute_run(db_session, run2, client=ok)
    assert run1.status == RUN_SUPERSEDED
    old = {r.rule_id: r for r in db_session.scalars(select(RuleResult).where(
        RuleResult.run_id == run1.id)).all()}
    assert old["S-NAME"].result == RESULT_FAILED  # 历史留痕，不篡改
    assert old["C-FILE"].result == RESULT_SATISFIED
    new = {r.rule_id: r for r in db_session.scalars(select(RuleResult).where(
        RuleResult.run_id == run2.id)).all()}
    assert new["S-NAME"].result == RESULT_SATISFIED
    new_evs = db_session.scalars(select(Evidence).where(
        Evidence.rule_result_id == new["S-NAME"].id)).all()
    assert new_evs and new_evs[0].method == "llm"
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "规则通过（待人工验收）"
