# -*- coding: utf-8 -*-
"""通知意图（方案第 7 节通知与交付；业务测试 V24）。

红线（V24）：
- 只记录「已复制」，不宣称已发送/已送达——首版没有发送通道；
- 催交名单每次重算：免交、已正式提交（含补交后）自动移出，撤回后重新纳入；
- 已过首次截止的转入「缺交」可见视图，不再催交；
- 通知内容只含组织者撰写的文本与目标快照，不夹带材料内容。
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    EXEMPTION_ACTIVE,
    SUBMISSION_FORMAL,
    Exemption,
    NotificationIntent,
    Submission,
    Subject,
    Task,
)
from ..security import utcnow
from . import tasks as task_service

# 状态机只有两态：ready（待复制）→ copied（已复制）。
# 刻意不定义 sent / delivered——不宣称发送与送达。
NOTIF_READY = "ready"
NOTIF_COPIED = "copied"


class NotificationError(Exception):
    pass


def _aware(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def reminder_view(db: Session, task: Task, now: Optional[datetime] = None) -> dict:
    """重算催交视图（每次请求都重新计算，不信缓存名单）。

    返回 targets（可催交）/ exempt（免交）/ submitted（已正式提交）/ overdue（缺交）。
    """
    now = now or utcnow()
    exempt_ids = set(db.scalars(select(Exemption.subject_id).where(
        Exemption.task_id == task.id,
        Exemption.status == EXEMPTION_ACTIVE)).all())
    formal_ids = set(db.scalars(select(Submission.subject_id).where(
        Submission.task_id == task.id,
        Submission.state == SUBMISSION_FORMAL,
        Submission.current_revision_id.is_not(None))))

    first_deadline = _aware(task.first_deadline)
    targets, exempt, submitted, overdue = [], [], [], []
    for s in db.scalars(select(Subject).where(Subject.task_id == task.id)
                        .order_by(Subject.id)).all():
        row = {"subject_id": s.id, "name": s.display_name}
        if s.id in exempt_ids:
            exempt.append(row)
        elif s.id in formal_ids:
            submitted.append(row)
        elif first_deadline is not None and now >= first_deadline:
            overdue.append(row)   # 已过首次截止：缺交可见，但不再催交
        else:
            targets.append(row)
    return {"targets": targets, "exempt": exempt,
            "submitted": submitted, "overdue": overdue}


def create_notification(db: Session, task: Task, *, content: str,
                        subject_ids: Optional[list[int]] = None,
                        operator_id: Optional[int] = None) -> NotificationIntent:
    """生成一条通知意图。默认对当前全部可催交目标；显式给出的必须在名单内。"""
    if not content or not content.strip():
        raise NotificationError("通知内容不能为空")
    view = reminder_view(db, task)
    pool = {row["subject_id"]: row for row in view["targets"]}
    if subject_ids is None:
        chosen = view["targets"]
    else:
        missing = [sid for sid in subject_ids if sid not in pool]
        if missing:
            raise NotificationError(
                f"以下主体当前不在可催交名单（免交/已提交/已截止）：{missing}")
        chosen = [pool[sid] for sid in subject_ids]
    intent = NotificationIntent(
        task_id=task.id,
        targets_json=json.dumps(chosen, ensure_ascii=False),
        content=content.strip(),
        status=NOTIF_READY,
        created_by=operator_id,
    )
    db.add(intent)
    db.flush()
    task_service.audit(db, "notification.created", "task",
                       {"intent_id": intent.id, "targets": len(chosen)}, task.id)
    return intent


def mark_copied(db: Session, task: Task, intent_id: int,
                operator_id: Optional[int] = None) -> NotificationIntent:
    """标记「已复制」。这是唯一的状态转移；不存在发送/送达状态。"""
    intent = db.get(NotificationIntent, intent_id)
    if intent is None or intent.task_id != task.id:
        raise NotificationError("通知意图不存在")
    if intent.status != NOTIF_COPIED:
        intent.status = NOTIF_COPIED
        db.flush()
        task_service.audit(db, "notification.copied", "task",
                           {"intent_id": intent.id}, task.id)
    return intent


def list_notifications(db: Session, task: Task) -> list[dict]:
    out = []
    for n in db.scalars(select(NotificationIntent).where(
            NotificationIntent.task_id == task.id).order_by(NotificationIntent.id.desc())).all():
        out.append({
            "id": n.id, "status": n.status, "content": n.content,
            "targets": json.loads(n.targets_json),
            "created_at": n.created_at.isoformat() if n.created_at else "",
        })
    return out
