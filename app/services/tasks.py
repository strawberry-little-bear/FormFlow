"""服务层：任务、蓝图与发布。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.requirements_agent import blueprint_diff, draft_blueprint, template_blueprint, validate_blueprint
from ..llm import LLMClient
from ..models import (
    RUN_QUEUED,
    RUN_RUNNING,
    TASK_ARCHIVED,
    TASK_CANCELLED,
    TASK_CLOSED,
    TASK_COLLECTING,
    AccessGrant,
    Account,
    AuditEvent,
    BlueprintVersion,
    CheckRun,
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


def _restore_dropped_check_specs(old: Blueprint, new: Blueprint) -> None:
    """模型修订时偶尔丢掉同 ID 规则的 check 程序规格；未提及的规格应原样保留。"""
    old_checks = {r.id: r.check for r in old.rules if r.check}
    for r in new.rules:
        if r.check is None and r.id in old_checks:
            r.check = old_checks[r.id]


def _warn_unrequested_removal(result: DraftResult, impact: dict) -> None:
    """修订若删除了字段/材料/规则，显著提醒组织者核对。

    真实网关冒烟曾出现降级模型把草案删空的情况；历史草案仍保留，
    组织者可回到旧版本继续修订，但必须看到显式警告而不是静默丢失。
    """
    parts = []
    for key, label in (("fields", "字段"), ("slots", "材料槽位"), ("rules", "规则")):
        if impact[key]["removed"]:
            parts.append(f"{label}{impact[key]['removed']}")
    if parts:
        result.warnings.append(
            "修订删除了" + "、".join(parts) +
            "；如非本意请勿发布（此前的草案版本仍保留，可回退继续修订）")


def revise_draft(db: Session, task: Task, blueprint_version_id: int, *,
                 requirement: str = "", answered: Optional[dict] = None,
                 instruction: str = "",
                 client: Optional[LLMClient] = None) -> tuple[DraftResult, BlueprintVersion, dict]:
    """澄清轮次闭环：组织者回答澄清/提出修改意见后，基于当前草案修订（第 3 节）。

    - 修订产生新的草案版本，历史草案不被篡改（对话与结构化编辑沿同一草案线推进）；
    - 模型不可用或无实质变化时不制造新版本，保留原草案并给警告；
    - 返回修改影响（blueprint_diff）供界面显示。
    """
    bp = db.get(BlueprintVersion, blueprint_version_id)
    if bp is None or bp.task_id != task.id:
        raise ValueError("蓝图版本不存在")
    ensure_task_writable(task)  # V24 readonly guard
    current = Blueprint.model_validate_json(bp.blueprint_json)
    result = draft_blueprint(requirement, answered=answered or {},
                             current_draft=current, instruction=instruction,
                             client=client)
    _restore_dropped_check_specs(current, result.blueprint)
    if result.blueprint.model_dump() == current.model_dump():
        # 无实质变化（含模型不可用降级保留原草案）：不制造新版本
        audit(db, "blueprint.revise_noop", "blueprint",
              {"version": bp.version, "answered": sorted((answered or {}).keys())},
              task.id)
        return result, bp, blueprint_diff(current, result.blueprint)
    new_bp = save_draft(db, task, result)
    impact = blueprint_diff(current, result.blueprint)
    _warn_unrequested_removal(result, impact)
    audit(db, "blueprint.revised", "blueprint",
          {"from_version": bp.version, "to_version": new_bp.version,
           "answered": sorted((answered or {}).keys()),
           "impact": impact["summary"]}, task.id)
    return result, new_bp, impact


def publish(db: Session, task: Task, blueprint_version_id: int) -> BlueprintVersion:
    """发布：程序校验 → 固定蓝图版本 → 任务进入收集中。

    关键歧义或非法配置阻止发布（第 3 节）。
    """
    bp = db.get(BlueprintVersion, blueprint_version_id)
    if bp is None or bp.task_id != task.id:
        raise ValueError("蓝图版本不存在")
    ensure_task_writable(task)  # V24 readonly guard
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


# ---------------------------------------------------------------- 任务生命周期（V24 / 表 6）
# 只读语义：关闭=停止收集但数据完整可查；归档=关闭后的长期保留态；
# 取消=中止任务。三者都不删数据；删除数据是另一条显式路径（本版不提供）。
_READONLY_STATUSES = (TASK_CLOSED, TASK_ARCHIVED, TASK_CANCELLED)
_STATUS_LABEL = {TASK_CLOSED: "关闭", TASK_ARCHIVED: "归档", TASK_CANCELLED: "取消"}


class TaskNotWritable(Exception):
    """任务处于只读状态（关闭/归档/取消），拒绝一切写入。"""


def ensure_task_writable(task: Task) -> None:
    """写操作前置校验：只读状态下拒绝提交/上传/检查/改蓝图（表 6：关闭后只读）。"""
    if task.status in _READONLY_STATUSES:
        raise TaskNotWritable(
            f"任务已{_STATUS_LABEL.get(task.status, task.status)}，处于只读状态")


def close_task(db: Session, task: Task, actor: str = "organizer") -> None:
    """关闭任务：停止收集，历史数据完整保留、可查可导出（V24）。"""
    if task.status in _READONLY_STATUSES:
        raise ValueError(f"任务已{_STATUS_LABEL.get(task.status, task.status)}，不能重复关闭")
    prev = task.status
    task.status = TASK_CLOSED
    db.flush()
    audit(db, "task.close", "task", {"from": prev}, task.id, actor=actor)


def reopen_task(db: Session, task: Task, actor: str = "organizer") -> None:
    """恢复收集：仅已关闭任务可恢复（归档/取消不可逆）。"""
    if task.status != TASK_CLOSED:
        raise ValueError("只有已关闭的任务可以恢复收集")
    task.status = TASK_COLLECTING
    db.flush()
    audit(db, "task.reopen", "task", {}, task.id, actor=actor)


def archive_task(db: Session, task: Task, actor: str = "organizer") -> None:
    """归档：关闭后的长期保留态。归档前做真实数据校验——存在未完成检查时拒绝。"""
    if task.status == TASK_ARCHIVED:
        raise ValueError("任务已归档")
    if task.status != TASK_CLOSED:
        raise ValueError("只有已关闭的任务可以归档")
    pending = db.scalars(select(CheckRun).where(
        CheckRun.task_id == task.id,
        CheckRun.status.in_((RUN_QUEUED, RUN_RUNNING)),
    )).first()
    if pending is not None:
        raise ValueError("存在排队中/运行中的检查，不能归档（先等待或重试完成）")
    task.status = TASK_ARCHIVED
    db.flush()
    audit(db, "task.archive", "task", {}, task.id, actor=actor)


def cancel_task(db: Session, task: Task, actor: str = "organizer") -> None:
    """取消任务：中止收集，数据保留备查。已归档任务不可取消。"""
    if task.status == TASK_ARCHIVED:
        raise ValueError("已归档任务不能取消")
    if task.status == TASK_CANCELLED:
        raise ValueError("任务已取消")
    task.status = TASK_CANCELLED
    db.flush()
    audit(db, "task.cancel", "task", {}, task.id, actor=actor)



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
