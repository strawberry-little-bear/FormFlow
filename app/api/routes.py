"""API 路由：组织者与提交者两端。

安全原则（第 16 节）：所有路径服务端鉴权；稳定 ID 不替代授权校验；
公共链接不能访问任何报名记录。
"""
from __future__ import annotations

import hashlib
import secrets
from typing import Optional

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import (
    Account,
    AccessGrant,
    Subject,
    Task,
)
from ..schemas import DraftResult
from ..security import hash_credential, verify_credential
from ..services import decisions as decision_service
from ..services import export as export_service
from ..services import submissions as sub_service
from ..services import tasks as task_service
from ..services.checks import create_run, current_summary, execute_run
from ..agents.requirements_agent import validate_blueprint
from ..schemas import Blueprint
from fastapi import APIRouter

router = APIRouter(prefix="/api")

# ---------------------------------------------------------------- 会话（开发阶段）
_sessions: dict[str, int] = {}


def _hash_password(pw: str) -> str:
    salt = "formflow-static-salt"  # 开发阶段；生产需改为随机 salt 存储
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100_000).hex()


def current_account(
    authorization: str = Header(default=""),
    db: Session = Depends(get_db),
) -> Account:
    if not authorization.startswith("Bearer "):
        raise HTTPException(401, "缺少组织者凭证")
    token = authorization[7:]
    acct_id = _sessions.get(token)
    if acct_id is None:
        raise HTTPException(401, "登录已过期")
    acct = db.get(Account, acct_id)
    if acct is None:
        raise HTTPException(401, "账号不存在")
    return acct


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
    acct = Account(username=username, password_hash=_hash_password(password))
    db.add(acct)
    db.flush()
    return {"id": acct.id, "username": acct.username}


@router.post("/auth/login")
def login(username: str = Form(...), password: str = Form(...), db: Session = Depends(get_db)):
    acct = db.scalar(select(Account).where(Account.username == username))
    if acct is None or acct.password_hash != _hash_password(password):
        raise HTTPException(401, "用户名或密码错误")
    token = secrets.token_urlsafe(24)
    _sessions[token] = acct.id
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
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    result, bp = task_service.draft_from_requirement(db, task, requirement, template)
    db.commit()
    return {"blueprint_version_id": bp.id, "draft": result.model_dump()}


@router.post("/tasks/{task_id}/draft/template")
def draft_by_template(task_id: int, template: str = Form(...),
                      db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    bp = task_service.draft_from_template(db, task, template)
    db.commit()
    return {"blueprint_version_id": bp.id}


@router.post("/tasks/{task_id}/blueprints/{bp_id}/publish")
def publish(task_id: int, bp_id: int, db: Session = Depends(get_db),
            acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    try:
        bp = task_service.publish(db, task, bp_id)
    except task_service.PublishBlocked as e:
        raise HTTPException(422, f"发布被阻止：{e}")
    db.commit()
    return {"published_version": bp.version, "task_status": task.status}


@router.get("/tasks/{task_id}/blueprint")
def get_blueprint(task_id: int, db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None or task.current_blueprint_id is None:
        raise HTTPException(404, "任务或蓝图不存在")
    from ..models import BlueprintVersion

    bp = db.get(BlueprintVersion, task.current_blueprint_id)
    return {"version": bp.version, "blueprint": Blueprint.model_validate_json(bp.blueprint_json).model_dump()}


@router.post("/tasks/{task_id}/roster")
def import_roster(task_id: int, entries: list[dict], db: Session = Depends(get_db),
                  acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    task_service.add_roster(db, task, entries)
    db.commit()
    return {"imported": len(entries)}


@router.post("/tasks/{task_id}/grants")
def issue_grant(task_id: int, subject_name: str = Form(...), db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    subject = task_service.ensure_subject(db, task, subject_name)
    token = task_service.issue_grant(db, task, subject)
    db.commit()
    return {"subject_id": subject.id, "credential": token}


@router.get("/tasks/{task_id}/workbench")
def workbench(task_id: int, db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    """任务工作台：谁没交、谁要改、谁等我决定。"""
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
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
    from ..models import BlueprintVersion

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
def save_draft(fields: dict, expected_version: Optional[int] = Form(None),
               grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    submission = sub_service.get_or_create_draft(db, task, subject.id)
    try:
        version = sub_service.save_draft(db, submission, fields, expected_version)
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
def formal_submit(fields: dict, slot_file_ids: dict, idempotency_key: str,
                  is_correction: Optional[bool] = Form(None),
                  grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    submission = sub_service.get_or_create_draft(db, task, subject.id)
    try:
        rev = sub_service.formal_submit(db, task, submission, fields=fields,
                                        slot_file_ids=slot_file_ids,
                                        idempotency_key=idempotency_key, is_correction=is_correction)
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
    from ..models import Revision, Submission as Sub

    submission = db.scalar(select(Sub).where(Sub.task_id == grant.task_id,
                                             Sub.subject_id == subject.id))
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
    from ..models import Revision, Submission as Sub

    task = db.get(Task, task_id)
    submission = db.scalar(select(Sub).where(Sub.task_id == task_id, Sub.subject_id == subject_id))
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
    task = db.get(Task, task_id)
    subject = db.get(Subject, subject_id)
    if task is None or subject is None:
        raise HTTPException(404, "任务或主体不存在")
    try:
        d = decision_service.record_decision(db, task, subject, decision=decision, reason=reason,
                                             operator_id=acct.id, scope_rule_id=scope_rule_id)
    except decision_service.DecisionError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"decision_id": d.id, "decision": d.decision}


@router.post("/tasks/{task_id}/subjects/{subject_id}/decisions/{decision_id}/revoke")
def revoke_decision(task_id: int, subject_id: int, decision_id: int, reason: str = Form(...),
                    db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    try:
        decision_service.revoke_decision(db, task, decision_id, reason, operator_id=acct.id)
    except decision_service.DecisionError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"revoked": decision_id}


# ---------------------------------------------------------------- 交付
@router.post("/tasks/{task_id}/snapshots")
def create_snapshot(task_id: int, kind: str = Form("formal"),
                    db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    task = db.get(Task, task_id)
    if task is None:
        raise HTTPException(404, "任务不存在")
    snap = export_service.create_snapshot(db, task, kind=kind)
    db.commit()
    return {"snapshot_id": snap.id, "manifest": snap.manifest_json}


@router.post("/snapshots/{snapshot_id}/export")
def run_export(snapshot_id: int, db: Session = Depends(get_db),
               acct: Account = Depends(current_account)):
    from ..models import DeliverySnapshot

    snap = db.get(DeliverySnapshot, snapshot_id)
    if snap is None:
        raise HTTPException(404, "快照不存在")
    job = export_service.run_export(db, snap)
    db.commit()
    return {"job_id": job.id, "csv": job.csv_path, "zip": job.zip_path}
