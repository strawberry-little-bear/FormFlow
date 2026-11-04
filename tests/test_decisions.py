"""人工决定与验收测试（第 10 节）。"""
from __future__ import annotations

import pytest

from app.models import Subject
from app.services import decisions as dec
from app.services import tasks as task_service
from app.services.checks import create_run, execute_run
from app.services.submissions import formal_submit, get_or_create_draft
from tests.conftest import make_task, publish_blueprint
from app.schemas import Blueprint, FieldDef, RuleDef
from app.agents.review_agent import FileInfo
from app.parsing import ParseResult


def _setup(db):
    task = make_task(db)
    bp = publish_blueprint(db, task, Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        rules=[RuleDef(id="C-R03", statement="期次一致", requirement_source="s",
                       executor="semantic")],
    ))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db.add(subject)
    db.flush()
    return task, subject


def _formal(db, task, subject, key="k1"):
    submission = get_or_create_draft(db, task, subject.id)
    rev = formal_submit(db, task, submission, fields={"name": "张三"},
                        slot_file_ids={}, idempotency_key=key)
    run = create_run(db, task, rev)
    execute_run(db, run)
    return rev, run


def test_empty_reason_rejected(db_session):
    task, subject = _setup(db_session)
    with pytest.raises(dec.DecisionError) as e:
        dec.record_decision(db_session, task, subject, decision="confirm_issue", reason="  ")
    assert "理由" in str(e.value)


def test_accept_blocked_by_unknown(db_session, stub_llm):
    """模型不可用 → failed/unknown → 验收被阻止。"""
    from app.llm import LLMUnavailable

    stub_llm.error = LLMUnavailable("503")
    task, subject = _setup(db_session)
    rev, run = _formal(db_session, task, subject)
    # run 内 LLM 不可用 → C-R03 failed → 验收前检查必须阻止
    with pytest.raises(dec.DecisionError) as e:
        dec.record_decision(db_session, task, subject,
                            decision="accept_current", reason="材料没问题")
    assert "验收前检查未通过" in str(e.value)


def test_correct_false_positive_then_accept(db_session, stub_llm):
    """纠正误报（带理由）→ unknown 被处置 → 可验收。"""
    from app.llm import LLMUnavailable

    stub_llm.error = LLMUnavailable("503")
    task, subject = _setup(db_session)
    _formal(db_session, task, subject)
    dec.record_decision(db_session, task, subject, decision="correct_false_positive",
                        reason="人工核对原文：标题确为第 1 期，机器误报", scope_rule_id="C-R03")
    d = dec.record_decision(db_session, task, subject, decision="accept_current",
                            reason="逐条核对无误")
    assert d.decision == "accept_current"


def test_revoke_appends_record(db_session, stub_llm):
    from app.llm import LLMUnavailable

    stub_llm.error = LLMUnavailable("503")
    task, subject = _setup(db_session)
    _formal(db_session, task, subject)
    d1 = dec.record_decision(db_session, task, subject, decision="correct_false_positive",
                             reason="误报已纠正", scope_rule_id="C-R03")
    rev = dec.revoke_decision(db_session, task, d1.id, "发现原文确为第 2 期，撤销纠正")
    assert rev.decision == "revoke"
    # 历史保留：原决定仍在，仅标记撤销
    from app.models import ManualDecision

    old = db_session.get(ManualDecision, d1.id)
    assert old.revoked is True


def test_decision_scope_does_not_leak_to_new_revision(db_session, stub_llm):
    """决定默认不扩大到未来版本（V18）。"""
    from app.llm import LLMUnavailable

    stub_llm.error = LLMUnavailable("503")
    task, subject = _setup(db_session)
    rev1, _ = _formal(db_session, task, subject, key="k1")
    d = dec.record_decision(db_session, task, subject, decision="correct_false_positive",
                            reason="v1 误报", scope_rule_id="C-R03")
    assert d.revision_id == rev1.id
    # v2 正式提交后，旧决定不应覆盖新版本
    from app.services.submissions import formal_submit

    rev2 = formal_submit(db_session, task, get_or_create_draft(db_session, task, subject.id),
                         fields={"name": "张三"}, slot_file_ids={},
                         idempotency_key="k2", is_correction=True)
    from app.services.checks import _active_decisions

    active = _active_decisions(db_session, task.id, subject.id, rev2.id)
    assert all(d.scope_rule_id != "C-R03" for d in active)
