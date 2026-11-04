# -*- coding: utf-8 -*-
"""V09 条件槽位端到端回归：数字赛道不交照片 / 实物赛道未交照片。

- 数字队（track==数字）：photo 槽必交条件不满足 → 规则 not_applicable，
  不制造待办，主摘要为「规则通过（待人工验收）」；
- 实物队（track==实物）未交照片：规则 issue，explanation/next_step 指明槽位，
  主摘要「待补正」；
- 实物队已交照片：规则 satisfied。
全程只跑确定性规则，不调外部模型（StubLLM 仅兜底）。
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.agents.requirements_agent import template_blueprint
from app.models import (
    RESULT_ISSUE,
    RESULT_NOT_APPLICABLE,
    RESULT_SATISFIED,
    RuleResult,
    Subject,
)
from app.schemas import RuleDef
from app.services import submissions as sub
from app.services.checks import create_run, current_summary, execute_run
from tests.conftest import StubLLM, make_task, publish_blueprint, legacy_revision

RULE_ID = "C-PHOTO"


def _blueprint():
    bp = template_blueprint("contest_signup")
    bp.rules = [RuleDef(id=RULE_ID, statement="实物赛道须提交实物照片",
                        requirement_source="实物赛道须提交实物照片",
                        executor="deterministic",
                        check={"kind": "slot_presence", "slot": "photo"})]
    return bp


def _setup(db, track):
    now = datetime.now(timezone.utc)
    task = make_task(db, name="比赛报名", mode="open", subject_kind="team",
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=7),
                     correction_deadline=now + timedelta(days=14))
    publish_blueprint(db, task, _blueprint())
    subject = Subject(task_id=task.id, kind="team", display_name=f"{track}赛道队")
    db.add(subject)
    db.flush()
    submission = sub.get_or_create_draft(db, task, subject.id)
    sub.attach_file(db, submission, slot="proposal", original_name="项目简介.pdf",
                    content=b"%PDF-1.4 proposal", sha256="", mime="application/pdf")
    fields = {"team_name": f"{track}赛道队", "project_name": "智能分类桶",
              "contact": "王五", "email": "w@example.com", "track": track}
    return task, subject, submission, fields


def _run_and_results(db, task, submission, fields, key, slot_file_ids=None, *, legacy=False):
    files = {"proposal": sub.read_draft(db, submission)["slot_file_ids"]["proposal"],
             **(slot_file_ids or {})}
    if legacy:
        rev = legacy_revision(db, submission, fields=fields, files=files, key=key)
    else:
        rev = sub.formal_submit(db, task, submission, fields=fields,
                                slot_file_ids=files, idempotency_key=key)
    run = create_run(db, task, rev)
    execute_run(db, run, client=StubLLM())
    results = db.scalars(select(RuleResult).where(
        RuleResult.run_id == run.id)).all()
    return run, results


def test_digital_track_no_photo_not_applicable(db_session):
    """数字赛道不交照片：条件不满足 → not_applicable，不制造待办。"""
    task, subject, submission, fields = _setup(db_session, "数字")
    _run, results = _run_and_results(db_session, task, submission, fields,
                                     "k-digital")
    assert len(results) == 1
    r = results[0]
    assert r.rule_id == RULE_ID
    assert r.result == RESULT_NOT_APPLICABLE
    assert "track==实物" in r.explanation and "不适用" in r.explanation
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "规则通过（待人工验收）"
    assert summary["buckets"]["blocking"] == []
    assert summary["buckets"]["incomplete"] == []


def test_physical_track_missing_photo_is_issue(db_session):
    """新提交拦截缺照片；旧版不完整快照仍按槽位判为待补正。"""
    task, subject, submission, fields = _setup(db_session, "实物")
    with pytest.raises(sub.SubmissionValidationError, match="实物照片"):
        _run_and_results(db_session, task, submission, fields, "new-missing")
    _run, results = _run_and_results(db_session, task, submission, fields,
                                     "k-physical-missing", legacy=True)
    assert len(results) == 1
    r = results[0]
    assert r.result == RESULT_ISSUE
    assert "photo" in r.explanation
    assert "实物照片" in (r.next_step or "")
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "待补正"
    assert summary["buckets"]["blocking"] == [RULE_ID]


def test_physical_track_with_photo_satisfied(db_session):
    """实物赛道已交照片：规则满足。"""
    task, subject, submission, fields = _setup(db_session, "实物")
    f = sub.attach_file(db_session, submission, slot="photo",
                        original_name="作品.jpg", content=b"fake-jpeg-bytes",
                        sha256="", mime="image/jpeg")
    _run, results = _run_and_results(db_session, task, submission, fields,
                                     "k-physical-ok",
                                     slot_file_ids={"photo": [f.file_id]})
    assert len(results) == 1
    r = results[0]
    assert r.result == RESULT_SATISFIED
    assert "photo" in r.explanation
    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "规则通过（待人工验收）"


def test_photo_slot_not_counted_for_other_slots(db_session):
    """照片放在 proposal 槽不算数：实物队仍缺照片（按快照槽位判定）。"""
    task, subject, submission, fields = _setup(db_session, "实物")
    f = sub.attach_file(db_session, submission, slot="proposal",
                        original_name="简介.pdf", content=b"fake-pdf",
                        sha256="", mime="application/pdf")
    with pytest.raises(sub.SubmissionValidationError, match="实物照片"):
        _run_and_results(db_session, task, submission, fields, "new-wrong-slot",
                         slot_file_ids={"proposal": [f.file_id]})
    _run, results = _run_and_results(db_session, task, submission, fields,
                                     "k-wrong-slot",
                                     slot_file_ids={"proposal": [f.file_id]}, legacy=True)
    assert results[0].result == RESULT_ISSUE
    assert "photo" in results[0].explanation
