"""API 路由：组织者与提交者两端。

安全原则（第 16 节）：所有路径服务端鉴权；稳定 ID 不替代授权校验；
公共链接不能访问任何报名记录。
"""
from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    AccessGrant,
    Account,
    AuthSession,
    BlueprintVersion,
    CheckRun,
    DeliverySnapshot,
    Evidence,
    ExportJob,
    ManualDecision,
    NotificationIntent,
    RUN_SUPERSEDED,
    Revision,
    RuleResult,
    Submission,
    Subject,
    Task,
)
from ..schemas import DraftResult
from pydantic import BaseModel

class DraftIn(BaseModel):
    """保存草稿：字段 + 期望版本（乐观并发）。"""
    fields: dict
    expected_version: Optional[int] = None

class SubmitIn(BaseModel):
    """正式提交：字段 + 槽位文件 + 幂等键。"""
    fields: dict
    slot_file_ids: dict
    idempotency_key: str
    is_correction: bool = False
from ..security import (
    hash_credential,
    hash_password,
    new_salt,
    utcnow,
    verify_credential,
    verify_password,
)
from ..services import decisions as decision_service
from ..services import notifications as notif_service
from ..services import export as export_service
from ..services import submissions as sub_service
from ..services import tasks as task_service
from ..services.checks import create_run, current_summary, execute_run
from ..agents.requirements_agent import validate_blueprint
from ..schemas import Blueprint
from fastapi import APIRouter

router = APIRouter(prefix="/api")

def _iso(dt) -> str:
    return dt.isoformat() if dt is not None else ""

# ---------------------------------------------------------------- 会话（DB 持久化）
def current_account(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Account:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "缺少组织者凭证")
    sess = db.scalar(select(AuthSession).where(
        AuthSession.token_hash == hash_credential(authorization[7:])))
    if sess is None or sess.revoked:
        raise HTTPException(401, "登录已过期")
    if sess.expires_at is not None:
        exp = sess.expires_at if sess.expires_at.tzinfo else sess.expires_at.replace(
            tzinfo=timezone.utc)
        if exp < utcnow():
            raise HTTPException(401, "登录已过期")
    acct = db.get(Account, sess.account_id)
    if acct is None:
        raise HTTPException(401, "账号不存在")
    return acct

def _owned_task(db: Session, acct: Account, task_id: int) -> Task:
    """组织者只能操作自己的任务；稳定 ID 不替代授权校验（方案第 16 节）。

    不存在与无权限统一返回 404，不泄露任务存在性。
    """
    task = db.get(Task, task_id)
    if task is None or task.created_by != acct.id:
        raise HTTPException(404, "任务不存在或无权访问")
    return task

def current_subject(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> tuple[AccessGrant, Subject]:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "缺少提交者凭证")
    grant = db.scalar(select(AccessGrant).where(
        AccessGrant.token_hash == hash_credential(authorization[7:])))
    if grant is None or grant.revoked:
        raise HTTPException(401, "凭证无效或已撤销")
    if grant.expires_at is not None:
        from ..security import utcnow

        exp = grant.expires_at if grant.expires_at.tzinfo else grant.expires_at.replace(tzinfo=utcnow().tzinfo)
        if exp < utcnow():
            raise HTTPException(401, "凭证已过期")
    subject = db.get(Subject, grant.subject_id)
    if subject is None:
        raise HTTPException(401, "主体不存在")
    return grant, subject

# ---------------------------------------------------------------- 账号
@router.post("/accounts")
def create_account(username: str = Form(...), password: str = Form(...),
                   db: Session = Depends(get_db)):
    if db.scalar(select(Account).where(Account.username == username)):
        raise HTTPException(409, "用户名已存在")
    salt = new_salt()
    acct = Account(username=username, password_hash=hash_password(password, salt),
                   password_salt=salt)
    db.add(acct)
    db.commit()
    return {"id": acct.id, "username": acct.username}

@router.post("/auth/login")
def login(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    acct = db.scalar(select(Account).where(Account.username == username))
    if acct is None or not verify_password(password, acct.password_salt, acct.password_hash):
        raise HTTPException(401, "用户名或密码错误")
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=hash_credential(token), account_id=acct.id))
    db.commit()
    return {"token": token, "account_id": acct.id}

# ---------------------------------------------------------------- 任务与蓝图
@router.post("/tasks")
def create_task(name: str = Form(...), mode: str = Form("roster"),
                subject_kind: str = Form("individual"),
                timezone_: str = Form("Asia/Shanghai"),
                db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = task_service.create_task(db, name=name, mode=mode, subject_kind=subject_kind,
                                    timezone_=timezone_, created_by=acct.id)
    db.commit()
    return {"task_id": task.id, "status": task.status}

@router.post("/tasks/{task_id}/draft/agent")
def draft_by_agent(task_id: int, requirement: str = Form(...), template: str = Form(None),
                   db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    result, bp = task_service.draft_from_requirement(db, task, requirement, template)
    db.commit()
    return {"blueprint_version_id": bp.id, "draft": result.model_dump()}

@router.post("/tasks/{task_id}/draft/template")
def draft_by_template(task_id: int, template: str = Form(...),
                      db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    bp = task_service.draft_from_template(db, task, template)
    db.commit()
    return {"blueprint_version_id": bp.id}

@router.post("/tasks/{task_id}/blueprints/{bp_id}/publish")
def publish(task_id: int, bp_id: int, db: Session = Depends(get_db),
            acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    try:
        bp = task_service.publish(db, task, bp_id)
    except task_service.PublishBlocked as e:
        raise HTTPException(422, f"发布被阻止：{e}")
    db.commit()
    return {"published_version": bp.version, "task_status": task.status}

@router.get("/tasks")
def list_tasks(db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    tasks = db.scalars(select(Task).where(Task.created_by == acct.id)
                       .order_by(Task.id.desc())).all()
    return {"tasks": [{"id": t.id, "name": t.name, "status": t.status,
                       "mode": t.mode, "created_at": t.created_at} for t in tasks]}

@router.get("/tasks/{task_id}/blueprint")
def get_blueprint(task_id: int, db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    if task.current_blueprint_id is None:
        raise HTTPException(404, "任务尚未发布蓝图")

    bp = db.get(BlueprintVersion, task.current_blueprint_id)
    return {"version": bp.version, "blueprint": Blueprint.model_validate_json(bp.blueprint_json).model_dump()}

@router.post("/tasks/{task_id}/roster")
def import_roster(task_id: int, entries: list[dict], db: Session = Depends(get_db),
                  acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    task_service.add_roster(db, task, entries)
    db.commit()
    return {"imported": len(entries)}

@router.post("/tasks/{task_id}/grants")
def issue_grant(task_id: int, subject_name: str = Form(...), db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    subject = task_service.ensure_subject(db, task, subject_name)
    token = task_service.issue_grant(db, task, subject)
    db.commit()
    return {"subject_id": subject.id, "credential": token}

@router.get("/tasks/{task_id}/workbench")
def workbench(task_id: int, db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    """任务工作台：谁没交、谁要改、谁等我决定。"""
    task = _owned_task(db, acct, task_id)
    subjects = db.scalars(select(Subject).where(Subject.task_id == task.id)).all()
    rows = []
    for s in subjects:
        summary = current_summary(db, task, s.id)
        rows.append({"subject_id": s.id, "name": s.display_name, **summary})
    return {"task": {"id": task.id, "name": task.name, "status": task.status}, "rows": rows}

# ---------------------------------------------------------------- 提交者
@router.get("/me")
def my_space(grant: AccessGrant = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant
    task = db.get(Task, grant.task_id)

    bp = db.get(BlueprintVersion, task.current_blueprint_id) if task.current_blueprint_id else None
    blueprint = Blueprint.model_validate_json(bp.blueprint_json).model_dump() if bp else None
    return {
        "task": {"id": task.id, "name": task.name, "timezone": task.timezone,
                 "open_at": task.open_at, "first_deadline": task.first_deadline,
                 "correction_deadline": task.correction_deadline, "status": task.status},
        "subject": {"id": subject.id, "name": subject.display_name, "kind": subject.kind},
        "blueprint": blueprint,
    }

@router.post("/me/draft")
def save_draft(body: DraftIn,
               grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    submission = sub_service.get_or_create_draft(db, task, subject.id)
    try:
        version = sub_service.save_draft(db, submission, body.fields, body.expected_version)
    except sub_service.SubmitError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"draft_version": version}

@router.post("/me/files")
async def upload_file(slot: str = Form(...), file: UploadFile = File(...),
                      grant_and_subject: tuple = Depends(current_subject),
                      db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    submission = sub_service.get_or_create_draft(db, task, subject.id)
    content = await file.read()
    fo = sub_service.attach_file(db, submission, slot=slot,
                                 original_name=file.filename or "unnamed",
                                 content=content, sha256="", mime=file.content_type or "")
    db.commit()
    return {"file_id": fo.file_id, "status": fo.status, "size": fo.size}

@router.post("/me/submit")
def formal_submit(body: SubmitIn,
                  grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    submission = sub_service.get_or_create_draft(db, task, subject.id)
    try:
        rev = sub_service.formal_submit(db, task, submission, fields=body.fields,
                                        slot_file_ids=body.slot_file_ids,
                                        idempotency_key=body.idempotency_key,
                                        is_correction=body.is_correction)
    except sub_service.IdempotencyConflict as e:
        raise HTTPException(409, str(e))
    except sub_service.SubmitError as e:
        raise HTTPException(422, str(e))
    # 正式版本与检查意图在同一可靠边界记录（W4/W5）
    run = create_run(db, task, rev)
    db.commit()
    return {"receipt": rev.receipt, "revision": rev.version,
            "formal_submitted_at": rev.formal_submitted_at, "run_id": run.id}

@router.get("/me/receipt")
def my_receipt(grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject

    submission = db.scalar(select(Submission).where(Submission.task_id == grant.task_id,
                                             Submission.subject_id == subject.id))
    if submission is None or submission.current_revision_id is None:
        return {"formal": False}
    rev = db.get(Revision, submission.current_revision_id)
    return {"formal": True, "receipt": rev.receipt, "revision": rev.version,
            "formal_submitted_at": rev.formal_submitted_at}

@router.get("/me/results")
def my_results(grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    return current_summary(db, task, subject.id)

# ---------------------------------------------------------------- 组织者复核与决定
@router.post("/tasks/{task_id}/subjects/{subject_id}/checks")
def trigger_check(task_id: int, subject_id: int, db: Session = Depends(get_db),
                  acct: Account = Depends(current_account)):

    task = _owned_task(db, acct, task_id)
    subject = db.get(Subject, subject_id)
    if subject is None or subject.task_id != task.id:
        raise HTTPException(404, "主体不存在或不属于该任务")
    submission = db.scalar(select(Submission).where(Submission.task_id == task_id, Submission.subject_id == subject_id))
    if submission is None or submission.current_revision_id is None:
        raise HTTPException(422, "该主体没有正式提交")
    rev = db.get(Revision, submission.current_revision_id)
    run = create_run(db, task, rev)
    execute_run(db, run)
    db.commit()
    return {"run_id": run.id, "status": run.status}

@router.post("/tasks/{task_id}/subjects/{subject_id}/decisions")
def make_decision(task_id: int, subject_id: int, decision: str = Form(...),
                  reason: str = Form(...), scope_rule_id: str = Form(""),
                  expires_at: Optional[str] = Form(None),
                  db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    subject = db.get(Subject, subject_id)
    if subject is None or subject.task_id != task.id:
        raise HTTPException(404, "主体不存在或不属于该任务")
    exp_dt: Optional[datetime] = None
    if expires_at:
        try:
            exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(422, "expires_at 不是合法的 ISO 时间")
    try:
        d = decision_service.record_decision(db, task, subject, decision=decision, reason=reason,
                                             operator_id=acct.id, scope_rule_id=scope_rule_id,
                                             expires_at=exp_dt)
    except decision_service.DecisionError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"decision_id": d.id, "decision": d.decision}

@router.post("/tasks/{task_id}/subjects/{subject_id}/decisions/{decision_id}/revoke")
def revoke_decision(task_id: int, subject_id: int, decision_id: int, reason: str = Form(...),
                    db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    try:
        decision_service.revoke_decision(db, task, decision_id, reason, operator_id=acct.id)
    except decision_service.DecisionError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"revoked": decision_id}

# ---------------------------------------------------------------- 通知意图（V24）
@router.get("/tasks/{task_id}/notifications")
def list_notifications(task_id: int, db: Session = Depends(get_db),
                       acct: Account = Depends(current_account)):
    """催交视图（每次重算）+ 历史通知意图。"""
    task = _owned_task(db, acct, task_id)
    return {"view": notif_service.reminder_view(db, task),
            "notifications": notif_service.list_notifications(db, task)}


@router.post("/tasks/{task_id}/notifications")
def create_notification(task_id: int, content: str = Form(...),
                        subject_ids: str = Form(""),
                        db: Session = Depends(get_db),
                        acct: Account = Depends(current_account)):
    """生成催交通知意图。subject_ids 为空 = 当前全部可催交目标。"""
    task = _owned_task(db, acct, task_id)
    ids: Optional[list[int]] = None
    if subject_ids.strip():
        try:
            ids = [int(x) for x in subject_ids.split(",") if x.strip()]
        except ValueError:
            raise HTTPException(422, "subject_ids 必须是逗号分隔的整数")
    try:
        intent = notif_service.create_notification(
            db, task, content=content, subject_ids=ids, operator_id=acct.id)
    except notif_service.NotificationError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"intent_id": intent.id, "status": intent.status,
            "targets": json.loads(intent.targets_json)}


@router.post("/notifications/{intent_id}/copy")
def mark_notification_copied(intent_id: int, db: Session = Depends(get_db),
                             acct: Account = Depends(current_account)):
    """标记「已复制」。唯一状态转移；不存在发送/送达状态。"""
    intent = db.get(NotificationIntent, intent_id)
    if intent is None:
        raise HTTPException(404, "通知意图不存在")
    task = _owned_task(db, acct, intent.task_id)
    try:
        notif_service.mark_copied(db, task, intent_id, operator_id=acct.id)
    except notif_service.NotificationError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"intent_id": intent_id, "status": "copied"}

@router.get("/tasks/{task_id}/subjects/{subject_id}/findings")
def findings(task_id: int, subject_id: int, db: Session = Depends(get_db),
             acct: Account = Depends(current_account)):
    """P03 证据复核：规则待办 + 证据（quote 必须可在原文定位）+ 决定历史。"""

    task = _owned_task(db, acct, task_id)
    subject = db.get(Subject, subject_id)
    if subject is None or subject.task_id != task.id:
        raise HTTPException(404, "主体不存在或不属于该任务")
    submission = db.scalar(select(Submission).where(Submission.task_id == task.id,
                                             Submission.subject_id == subject.id))
    if submission is None or submission.current_revision_id is None:
        return {"subject": {"id": subject.id, "name": subject.display_name},
                "revision": None, "run": None, "rules": [], "decisions": []}
    rev = db.get(Revision, submission.current_revision_id)
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == rev.id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))
    rules_meta = {}
    if run is not None:
        bp = db.get(BlueprintVersion, run.blueprint_version_id)
        if bp is not None:
            blueprint = Blueprint.model_validate_json(bp.blueprint_json)
            rules_meta = {r.id: r.model_dump() for r in blueprint.rules}
    rules = []
    if run is not None:
        for r in db.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all():
            evs = [{"file_id": e.file_id, "locator": e.locator, "quote": e.quote,
                    "method": e.method, "method_version": e.method_version}
                   for e in db.scalars(select(Evidence).where(
                       Evidence.rule_result_id == r.id)).all()]
            rules.append({
                "rule_id": r.rule_id, "result": r.result, "severity": r.severity,
                "explanation": r.explanation, "next_step": r.next_step,
                "requirement": rules_meta.get(r.rule_id, {}),
                "evidence": evs,
            })
    decisions = [{"id": d.id, "decision": d.decision, "reason": d.reason,
                  "scope_rule_id": d.scope_rule_id, "revoked": d.revoked,
                  "created_at": _iso(d.created_at)}
                 for d in db.scalars(select(ManualDecision).where(
                     ManualDecision.task_id == task.id,
                     ManualDecision.subject_id == subject.id).order_by(ManualDecision.id)).all()]
    return {"subject": {"id": subject.id, "name": subject.display_name},
            "revision": {"id": rev.id, "version": rev.version, "receipt": rev.receipt},
            "run": {"id": run.id, "status": run.status} if run else None,
            "rules": rules, "decisions": decisions}

# ---------------------------------------------------------------- 交付
@router.post("/tasks/{task_id}/snapshots")
def create_snapshot(task_id: int, kind: str = Form("formal"),
                    db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    snap = export_service.create_snapshot(db, task, kind=kind)
    db.commit()
    return {"snapshot_id": snap.id, "manifest": snap.manifest_json}

@router.post("/snapshots/{snapshot_id}/export")
def run_export(snapshot_id: int, db: Session = Depends(get_db),
               acct: Account = Depends(current_account)):

    snap = db.get(DeliverySnapshot, snapshot_id)
    if snap is None:
        raise HTTPException(404, "快照不存在")
    _owned_task(db, acct, snap.task_id)  # 快照也必须归属当前组织者
    job = export_service.run_export(db, snap)
    db.commit()
    return {"job_id": job.id, "csv": job.csv_path, "zip": job.zip_path}

@router.get("/exports/{job_id}/csv")
def download_csv(job_id: int, db: Session = Depends(get_db),
                 acct: Account = Depends(current_account)):

    job = db.get(ExportJob, job_id)
    if job is None:
        raise HTTPException(404, "导出作业不存在")
    snap = db.get(DeliverySnapshot, job.snapshot_id)
    _owned_task(db, acct, snap.task_id)
    return FileResponse(job.csv_path, media_type="text/csv",
                        filename=Path(job.csv_path).name)

@router.get("/exports/{job_id}/zip")
def download_zip(job_id: int, db: Session = Depends(get_db),
                 acct: Account = Depends(current_account)):

    job = db.get(ExportJob, job_id)
    if job is None:
        raise HTTPException(404, "导出作业不存在")
    snap = db.get(DeliverySnapshot, job.snapshot_id)
    _owned_task(db, acct, snap.task_id)
    return FileResponse(job.zip_path, media_type="application/zip",
                        filename=Path(job.zip_path).name)
