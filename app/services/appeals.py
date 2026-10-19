# -*- coding: utf-8 -*-
"""服务层：提交者解释与申请复核（第 10 节"提交者的申诹路径"）。

方案要求：提交者可查看问题、引用位置和建议改法，选择补交或解释；
组织者核对原文、纠正误报或批准有范围的例外。

红线：
- 解释不改变机器结论，也不替代组织者决定；
- 理由为空不允许提交（与决定同源约束）；
- 幂等：同键同内容返回同一记录，同键异内容报冲突；
- 撤回只改状态，历史不删除、不可篡改；
- 只读任务（关闭/归档/取消）不接受新的解释。
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (NOTE_PENDING, NOTE_WITHDRAWN, BlueprintVersion, ManualDecision,
                      SubmitterNote, Subject, Submission, Task)
from ..schemas import Blueprint
from . import tasks as task_service

MAX_CONTENT = 2000


class AppealError(Exception):
    """提交者解释被拒绝（空内容/规则不存在/越权/状态不允许）。"""


class IdempotencyConflict(AppealError):
    """同幂等键但内容不同。"""


def _blueprint_rule_ids(db: Session, task: Task) -> set:
    if not task.current_blueprint_id:
        return set()
    bp = db.get(BlueprintVersion, task.current_blueprint_id)
    if bp is None:
        return set()
    return {r.id for r in Blueprint.model_validate_json(bp.blueprint_json).rules}


def create_note(db: Session, task: Task, subject: Subject, *, rule_id: str = "",
                content: str = "", idempotency_key: str = "") -> SubmitterNote:
    """提交解释/申请复核。幂等；内容为空拒绝；规则必须存在于当前蓝图。"""
    if not idempotency_key:
        raise AppealError("缺少幂等键")
    text = (content or "").strip()
    if not text:
        raise AppealError("解释/复核理由不能为空")
    if len(text) > MAX_CONTENT:
        raise AppealError(f"解释过长（最多 {MAX_CONTENT} 字）")
    rule_id = (rule_id or "").strip()
    if rule_id and rule_id not in _blueprint_rule_ids(db, task):
        raise AppealError(f"规则 {rule_id} 不属于该任务当前蓝图，不能针对不存在的规则申请复核")

    existing = db.scalar(select(SubmitterNote).where(
        SubmitterNote.idempotency_key == idempotency_key))
    if existing is not None:
        if existing.task_id != task.id or existing.subject_id != subject.id:
            raise IdempotencyConflict("幂等键属于其他提交")
        if existing.content == text and existing.rule_id == rule_id:
            return existing  # 超时重试：同一记录，不重复计数
        raise IdempotencyConflict("同一幂等键提交了不同内容")

    task_service.ensure_task_writable(task)  # 关闭/归档/取消后只读
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject.id))
    note = SubmitterNote(
        task_id=task.id, subject_id=subject.id,
        revision_id=submission.current_revision_id if submission else None,
        rule_id=rule_id, content=text, idempotency_key=idempotency_key,
        status=NOTE_PENDING,
    )
    db.add(note)
    db.flush()
    task_service.audit(db, "appeal.create", "subject",
                       {"subject_id": subject.id, "note_id": note.id,
                        "rule_id": rule_id, "revision_id": note.revision_id},
                       task.id)
    return note


def withdraw_note(db: Session, task: Task, subject: Subject, note_id: int) -> SubmitterNote:
    """撤回：只改状态，历史保留；只能撤回本人未撤回的解释。"""
    note = db.get(SubmitterNote, note_id)
    if note is None or note.task_id != task.id or note.subject_id != subject.id:
        raise AppealError("解释不存在或不属于当前提交者")
    if note.status == NOTE_WITHDRAWN:
        raise AppealError("该解释已撤回")
    note.status = NOTE_WITHDRAWN
    db.flush()
    task_service.audit(db, "appeal.withdraw", "subject",
                       {"subject_id": subject.id, "note_id": note.id,
                        "rule_id": note.rule_id}, task.id)
    return note


def list_notes(db: Session, task: Task, subject: Subject) -> list[SubmitterNote]:
    """提交者视角：本人全部解释（含已撤回），按提交顺序。"""
    return db.scalars(select(SubmitterNote).where(
        SubmitterNote.task_id == task.id,
        SubmitterNote.subject_id == subject.id).order_by(SubmitterNote.id)).all()


def pending_notes(db: Session, task: Task) -> list[SubmitterNote]:
    """组织者视角：本任务全部待处理解释，按提交顺序。"""
    return db.scalars(select(SubmitterNote).where(
        SubmitterNote.task_id == task.id,
        SubmitterNote.status == NOTE_PENDING).order_by(SubmitterNote.id)).all()


def note_handled(db: Session, note: SubmitterNote) -> bool:
    """是否已有"解释提交之后"覆盖该规则的有效决定。

    决定早于解释提交时不视为已处理：组织者还没看到这条解释。
    """
    if note.status == NOTE_WITHDRAWN or not note.rule_id:
        return False
    for d in db.scalars(select(ManualDecision).where(
            ManualDecision.task_id == note.task_id,
            ManualDecision.subject_id == note.subject_id,
            ManualDecision.scope_rule_id == note.rule_id,
            ManualDecision.revoked == False)).all():  # noqa: E712
        if d.created_at is not None and note.created_at is not None \
                and d.created_at >= note.created_at:
            return True
    return False


def latest_explanation(db: Session, task: Task, subject_id: int) -> str:
    """最近一条未撤回的解释：作为下一轮语义检查的【提交者解释】上下文。"""
    notes = db.scalars(select(SubmitterNote).where(
        SubmitterNote.task_id == task.id, SubmitterNote.subject_id == subject_id,
        SubmitterNote.status != NOTE_WITHDRAWN).order_by(SubmitterNote.id.desc())).all()
    return notes[0].content if notes else ""


def to_dict(db: Session, note: SubmitterNote) -> dict:
    return {
        "id": note.id, "rule_id": note.rule_id, "content": note.content,
        "revision_id": note.revision_id, "status": note.status,
        "handled": note_handled(db, note),
        "created_at": note.created_at.isoformat() if note.created_at else "",
    }
