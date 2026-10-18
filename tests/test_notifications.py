# -*- coding: utf-8 -*-
"""通知意图测试（V24）：名单重查、只标已复制、截止后转缺交。"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.models import SUBMISSION_WITHDRAWN, Subject
from app.services import decisions as dec
from app.services import notifications as notif
from app.services import tasks as task_service
from app.services.submissions import formal_submit, get_or_create_draft
from tests.conftest import make_task

NAMES = ["张三", "李四", "王五", "赵六", "孙七"]


def _setup(db, *, first_deadline=None):
    task = make_task(db, first_deadline=first_deadline)
    subjects = {}
    for n in NAMES:
        s = Subject(task_id=task.id, kind="individual", display_name=n)
        db.add(s)
        db.flush()
        subjects[n] = s
    db.flush()
    return task, subjects


def _names(rows):
    return sorted(r["name"] for r in rows)


def test_targets_exclude_exempt_and_formal(db_session):
    """免交与已正式提交（含补交后）自动移出催交名单。"""
    task, subs = _setup(db_session)
    # 张三正式提交；孙七免交
    rev = formal_submit(db_session, task, get_or_create_draft(db_session, task, subs["张三"].id),
                        fields={}, slot_file_ids={"report": []}, idempotency_key="k-zs")
    assert rev.version == 1
    dec.record_decision(db_session, task, subs["孙七"], decision="exempt", reason="因病免交")

    view = notif.reminder_view(db_session, task)
    assert _names(view["targets"]) == ["李四", "王五", "赵六"]
    assert _names(view["exempt"]) == ["孙七"]
    assert _names(view["submitted"]) == ["张三"]


def test_withdrawn_subject_returns_to_targets(db_session):
    """撤回正式提交后重新纳入催交（V24：撤回后催交名单重查）。"""
    task, subs = _setup(db_session)
    submission = get_or_create_draft(db_session, task, subs["李四"].id)
    formal_submit(db_session, task, submission, fields={},
                  slot_file_ids={"report": []}, idempotency_key="k-ls")
    assert _names(notif.reminder_view(db_session, task)["submitted"]) == ["李四"]

    submission.state = SUBMISSION_WITHDRAWN
    db_session.flush()
    view = notif.reminder_view(db_session, task)
    assert _names(view["targets"]) == sorted(NAMES)
    assert view["submitted"] == []


def test_overdue_moves_out_of_targets(db_session):
    """已过首次截止：转入缺交视图，不再催交。"""
    past = datetime.now(timezone.utc) - timedelta(days=1)
    task, subs = _setup(db_session, first_deadline=past.replace(tzinfo=None))
    view = notif.reminder_view(db_session, task)
    assert view["targets"] == []
    assert _names(view["overdue"]) == sorted(NAMES)


def test_explicit_ids_must_be_currently_reminderable(db_session):
    """显式指定主体时，免交/已提交/已截止主体一律拒绝。"""
    task, subs = _setup(db_session)
    formal_submit(db_session, task, get_or_create_draft(db_session, task, subs["张三"].id),
                  fields={}, slot_file_ids={"report": []}, idempotency_key="k-zs")
    with pytest.raises(notif.NotificationError) as e:
        notif.create_notification(db_session, task, content="请按时提交",
                                  subject_ids=[subs["张三"].id, subs["李四"].id])
    assert "不在可催交名单" in str(e.value)


def test_status_only_ready_then_copied(db_session):
    """状态机只有 ready → copied；不存在发送/送达状态。"""
    task, _ = _setup(db_session)
    intent = notif.create_notification(db_session, task, content="请周五前提交团课报告")
    assert intent.status == notif.NOTIF_READY
    assert _names(__import__("json").loads(intent.targets_json)) == sorted(NAMES)

    notif.mark_copied(db_session, task, intent.id)
    assert intent.status == notif.NOTIF_COPIED
    # 再标记一次不报错（幂等）
    notif.mark_copied(db_session, task, intent.id)
    assert intent.status == notif.NOTIF_COPIED


def test_targets_snapshot_not_retroactively_changed(db_session):
    """意图里的目标是创建时快照；之后名单变化只影响新视图。"""
    task, subs = _setup(db_session)
    intent = notif.create_notification(db_session, task, content="催交")
    assert len(__import__("json").loads(intent.targets_json)) == len(NAMES)

    formal_submit(db_session, task, get_or_create_draft(db_session, task, subs["王五"].id),
                  fields={}, slot_file_ids={"report": []}, idempotency_key="k-ww")
    assert len(__import__("json").loads(intent.targets_json)) == len(NAMES)  # 快照不变
    assert _names(notif.reminder_view(db_session, task)["targets"]) == sorted(
        ["张三", "李四", "赵六", "孙七"])


def test_mark_copied_rejects_foreign_intent(db_session):
    """越权/不存在的意图拒绝标记。"""
    task, _ = _setup(db_session)
    other = make_task(db_session, name="别的任务")
    foreign = notif.create_notification(db_session, other, content="x")
    with pytest.raises(notif.NotificationError):
        notif.mark_copied(db_session, task, foreign.id)
