"""提交服务测试：幂等、双截止、草稿版本冲突（V13/V14/V19）。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import RESULT_ISSUE, Subject
from app.services import submissions as sub
from app.services import tasks as task_service
from tests.conftest import make_task, publish_blueprint
from app.schemas import Blueprint


@pytest.fixture()
def scenario(db_session):
    now = datetime.now(timezone.utc)
    task = make_task(db_session,
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=7),
                     correction_deadline=now + timedelta(days=14))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    return task, subject, submission


def _submit(db, task, submission, key="k1", fields=None, files=None, **kw):
    return sub.formal_submit(db, task, submission,
                             fields=fields or {"name": "张三"},
                             slot_file_ids=files or {"report": []},
                             idempotency_key=key, **kw)


def test_formal_submit_creates_receipt(db_session, scenario):
    task, subject, submission = scenario
    rev = _submit(db_session, task, submission)
    assert rev.receipt.startswith("R")
    assert rev.version == 1
    assert submission.state == "formal"
    assert rev.formal_submitted_at is not None  # 服务端时刻


def test_same_key_same_content_returns_same_receipt(db_session, scenario):
    task, subject, submission = scenario
    r1 = _submit(db_session, task, submission, key="k1")
    r2 = _submit(db_session, task, submission, key="k1")  # 超时重试
    assert r1.id == r2.id and r1.receipt == r2.receipt


def test_same_key_different_content_conflicts(db_session, scenario):
    task, subject, submission = scenario
    _submit(db_session, task, submission, key="k1")
    with pytest.raises(sub.IdempotencyConflict):
        _submit(db_session, task, submission, key="k1", fields={"name": "李四"})


def test_after_first_deadline_new_submission_rejected(db_session):
    past = datetime.now(timezone.utc) - timedelta(days=2)
    task = make_task(db_session, open_at=past - timedelta(days=10),
                     first_deadline=past, correction_deadline=past + timedelta(days=7))
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    with pytest.raises(sub.SubmitError) as e:
        _submit(db_session, task, submission)
    assert "首次截止" in str(e.value)


def test_correction_window_requires_prior_formal(db_session, scenario):
    task, subject, submission = scenario
    with pytest.raises(sub.SubmitError):
        _submit(db_session, task, submission, key="k-c", is_correction=True)


def test_correction_creates_v2(db_session, scenario):
    task, subject, submission = scenario
    _submit(db_session, task, submission, key="k1")
    r2 = _submit(db_session, task, submission, key="k2", is_correction=True)
    assert r2.version == 2


def test_draft_version_conflict(db_session, scenario):
    task, subject, submission = scenario
    with pytest.raises(sub.SubmitError) as e:
        sub.save_draft(db_session, submission, {"name": "x"}, expected_version=99)
    assert "冲突" in str(e.value)


def test_exactly_at_deadline_rejected(db_session):
    """恰等于截止时刻不接收首次提交（第 6 节）。"""
    deadline = datetime.now(timezone.utc) + timedelta(hours=1)
    task = make_task(db_session, open_at=deadline - timedelta(days=1),
                     first_deadline=deadline)
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    # 模拟服务端时间恰好等于截止
    import app.services.submissions as m
    orig = m._now_utc
    m._now_utc = lambda: deadline
    try:
        with pytest.raises(sub.SubmitError):
            _submit(db_session, task, submission)
    finally:
        m._now_utc = orig
