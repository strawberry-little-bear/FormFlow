"""服务层：任务、蓝图与发布。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.requirements_agent import draft_blueprint, template_blueprint, validate_blueprint
from ..models import (
    TASK_COLLECTING,
    AccessGrant,
    Account,
    AuditEvent,
    BlueprintVersion,
    RosterEntry,
    Subject,
    Task,
)
from ..schemas import Blueprint, DraftResult
from ..security import generate_credential, hash_credential, utcnow


def audit(db: Session, action: str, entity: str = "", payload: dict | None = None,
          task_id: Optional[int] = None, actor: str = "system") -> None:
    db.add(AuditEvent(task_id=task_id, actor=actor, action=action,
                      entity=entity, payload_json=json.dumps(payload or {}, ensure_ascii=False)))


def create_task(db: Session, *, name: str, mode: str, subject_kind: str,
                timezone_: str = "Asia/Shanghai", created_by: Optional[int] = None) -> Task:
    task = Task(name=name, mode=mode, subject_kind=subject_kind,
                timezone=timezone_, created_by=created_by, status="draft")
    db.add(task)
    db.flush()
    audit(db, "task.create", "task", {"name": name, "mode": mode}, task.id)
    return task


def save_draft(db: Session, task: Task, draft: DraftResult, by_agent: bool = True) -> BlueprintVersion:
    """保存蓝图草案（不发布）。"""
    latest = db.scalar(
        select(BlueprintVersion).where(BlueprintVersion.task_id == task.id)
        .order_by(BlueprintVersion.version.desc())
    )
    version = (latest.version + 1) if latest else 1
    bp = BlueprintVersion(
        task_id=task.id, version=version,
        blueprint_json=draft.blueprint.model_dump_json(),
        status="draft", created_by_agent=by_agent,
    )
    db.add(bp)
    db.flush()
    audit(db, "blueprint.draft_saved", "blueprint", {"version": version}, task.id)
    return bp


def draft_from_requirement(db: Session, task: Task, requirement_text: str,
                           template: Optional[str] = None) -> tuple[DraftResult, BlueprintVersion]:
    """需求 Agent 起草并保存草案。模型不可用时保留原草案并给警告。"""
    result = draft_blueprint(requirement_text, template=template)
    bp = save_draft(db, task, result)
    return result, bp


def draft_from_template(db: Session, task: Task, template: str) -> BlueprintVersion:
    return save_draft(db, task, DraftResult(blueprint=template_blueprint(template)), by_agent=False)


def publish(db: Session, task: Task, blueprint_version_id: int) -> BlueprintVersion:
    """发布：程序校验 → 固定蓝图版本 → 任务进入收集中。

    关键歧义或非法配置阻止发布（第 3 节）。
    """
    bp = db.get(BlueprintVersion, blueprint_version_id)
    if bp is None or bp.task_id != task.id:
        raise ValueError("蓝图版本不存在")
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    errors = validate_blueprint(blueprint)
    if errors:
        raise PublishBlocked("；".join(errors))
    bp.status = "published"
    bp.published_at = utcnow()
    task.current_blueprint_id = bp.id
    if task.status == "draft":
        task.status = TASK_COLLECTING
    audit(db, "blueprint.publish", "blueprint", {"version": bp.version}, task.id)
    return bp


class PublishBlocked(Exception):
    """发布被阻止：配置错误或关键歧义。"""


def add_roster(db: Session, task: Task, entries: list[dict]) -> list[RosterEntry]:
    """名册导入。entries: [{"name":..., "ref":...}]"""
    out = []
    for e in entries:
        row = RosterEntry(task_id=task.id, name=e.get("name", ""), ref=e.get("ref", ""))
        db.add(row)
        out.append(row)
    db.flush()
    audit(db, "roster.import", "roster", {"count": len(entries)}, task.id)
    return out


def ensure_subject(db: Session, task: Task, display_name: str) -> Subject:
    """开放制：创建私有提交空间前确保主体存在。"""
    subj = db.scalar(select(Subject).where(Subject.task_id == task.id,
                                          Subject.display_name == display_name))
    if subj is None:
        subj = Subject(task_id=task.id, kind=task.subject_kind, display_name=display_name)
        db.add(subj)
        db.flush()
    return subj


def issue_grant(db: Session, task: Task, subject: Subject,
                expires_at: Optional[datetime] = None) -> str:
    """发放可撤销凭证；明文只返回一次。"""
    token = generate_credential()
    db.add(AccessGrant(task_id=task.id, subject_id=subject.id,
                       token_hash=hash_credential(token), expires_at=expires_at))
    db.flush()
    audit(db, "grant.issue", "subject", {"subject_id": subject.id}, task.id)
    return token
