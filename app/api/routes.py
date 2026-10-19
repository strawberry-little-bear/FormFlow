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
    ExportJob,
    ManualDecision,
    NotificationIntent,
    RUN_SUPERSEDED,
    Revision,
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


class AppealIn(BaseModel):
    """提交者解释/申诹复核：作用域规则（可空）+ 内容 + 幂等键。"""

    rule_id: str = ""
    content: str = ""
    idempotency_key: str = ""
from ..security import (
    hash_credential,
    hash_password,
    new_salt,
    utcnow,
    verify_credential,
    verify_password,
)
from ..services import appeals as appeal_service
from ..services import decisions as decision_service
from ..services import notifications as notif_service
from ..services import export as export_service
from ..services import submissions as sub_service
from ..services import tasks as task_service
from ..services.checks import (create_run, current_details, current_summary,
                               execute_run, retry_run, rule_details,
                               run_coverage)
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

@router.post("/tasks/{task_id}/draft/revise")
def revise_draft_view(task_id: int, blueprint_version_id: int = Form(...),
                      requirement: str = Form(""), answered: str = Form(""),
                      instruction: str = Form(""),
                      db: Session = Depends(get_db), acct: Account = Depends(current_account)):
    """澄清轮次闭环：回答澄清/提出修改意见，基于当前草案修订，返回新草案与修改影响。"""
    task = _owned_task(db, acct, task_id)
    try:
        answered_map = json.loads(answered) if answered.strip() else {}
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"answered 不是合法 JSON：{e}")
    if not isinstance(answered_map, dict):
        raise HTTPException(422, "answered 必须是 JSON 对象（问题 -> 回答）")
    try:
        result, bp, impact = task_service.revise_draft(
            db, task, blueprint_version_id, requirement=requirement,
            answered=answered_map, instruction=instruction)
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    except ValueError as e:
        raise HTTPException(404, str(e))
    db.commit()
    return {"blueprint_version_id": bp.id, "version": bp.version,
            "draft": result.model_dump(), "impact": impact}


@router.post("/tasks/{task_id}/blueprints/{bp_id}/publish")
def publish(task_id: int, bp_id: int, db: Session = Depends(get_db),
            acct: Account = Depends(current_account)):
    task = _owned_task(db, acct, task_id)
    try:
        bp = task_service.publish(db, task, bp_id)
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    except task_service.PublishBlocked as e:
        raise HTTPException(422, f"发布被阻止：{e}")
    db.commit()
    return {"published_version": bp.version, "task_status": task.status}


# ---------------------------------------------------------------- 任务生命周期（V24 / 表 6）
@router.post("/tasks/{task_id}/close")
def close_task(task_id: int, db: Session = Depends(get_db),
               acct: Account = Depends(current_account)):
    """关闭任务：停止占用提交入口，历史数据与审核结果保留（非删除）。"""
    task = _owned_task(db, acct, task_id)
    try:
        task_service.close_task(db, task, actor=f"account:{acct.id}")
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"task_id": task.id, "status": task.status}


@router.post("/tasks/{task_id}/reopen")
def reopen_task(task_id: int, db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    """恢复收集：仅已关闭任务可恢复；归档/取消为终态。"""
    task = _owned_task(db, acct, task_id)
    try:
        task_service.reopen_task(db, task, actor=f"account:{acct.id}")
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"task_id": task.id, "status": task.status}


@router.post("/tasks/{task_id}/archive")
def archive_task(task_id: int, db: Session = Depends(get_db),
                 acct: Account = Depends(current_account)):
    """归档：关闭后的长期留存状态；存在未完成检查时拒绝归档。"""
    task = _owned_task(db, acct, task_id)
    try:
        task_service.archive_task(db, task, actor=f"account:{acct.id}")
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"task_id": task.id, "status": task.status}


@router.post("/tasks/{task_id}/cancel")
def cancel_task(task_id: int, db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    """取消：中止收集并释放名册/授权；数据保留，归档后不可取消。"""
    task = _owned_task(db, acct, task_id)
    try:
        task_service.cancel_task(db, task, actor=f"account:{acct.id}")
    except ValueError as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"task_id": task.id, "status": task.status}

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
def issue_grant(task_id: int, subject_name: str = Form(...),
                members: str = Form(""),
                db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    """发放提交凭证。members 为可选 JSON 字符串数组：团队主体按名登记成员（V10）。

    同名主体按名复用提交空间（补发凭证场景），但只在响应中提示待核，不自动合并。
    """
    task = _owned_task(db, acct, task_id)
    subject = task_service.ensure_subject(db, task, subject_name)
    added: list[str] = []
    if members.strip():
        try:
            names = json.loads(members)
        except ValueError:
            raise HTTPException(422, "members 不是合法 JSON（应为字符串数组）")
        if not isinstance(names, list) or not all(isinstance(x, str) for x in names):
            raise HTTPException(422, "members 应为字符串数组")
        if subject.kind == "team":
            added = task_service.add_members(db, subject, names)
    had_valid = task_service.has_valid_grant(db, subject)
    token = task_service.issue_grant(db, task, subject)
    db.commit()
    resp = {"subject_id": subject.id, "credential": token}
    if added:
        resp["members_added"] = added
    if had_valid:
        resp["warning"] = ("该主体此前已有有效凭证（同名主体仅提示待核，不自动合并）；"
                           "如非重发请核对主体 ID")
    return resp

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
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
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
    try:
        fo = sub_service.attach_file(db, submission, slot=slot,
                                     original_name=file.filename or "unnamed",
                                     content=content, sha256="", mime=file.content_type or "")
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
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
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    except sub_service.IdempotencyConflict as e:
        raise HTTPException(409, str(e))
    except sub_service.SubmitError as e:
        raise HTTPException(422, str(e))
    # 正式版本与检查意图在同一可靠边界记录（W4/W5）
    try:
        run = create_run(db, task, rev)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
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

@router.post("/me/appeals")
def create_appeal(body: AppealIn,
                  grant_and_subject: tuple = Depends(current_subject),
                  db: Session = Depends(get_db)):
    """P04 申诹入口：提交者对具体规则提交解释/申诹复核。

    解释不改变机器结论，也不替代组织者决定；组织者在 P03 看到后再决定。
    """
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    try:
        note = appeal_service.create_note(db, task, subject,
                                          rule_id=body.rule_id, content=body.content,
                                          idempotency_key=body.idempotency_key)
    except appeal_service.IdempotencyConflict as e:
        raise HTTPException(409, str(e))
    except appeal_service.AppealError as e:
        raise HTTPException(422, str(e))
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    db.commit()
    return {"note_id": note.id, "rule_id": note.rule_id, "status": note.status,
            "revision_id": note.revision_id}


@router.get("/me/appeals")
def my_appeals(grant_and_subject: tuple = Depends(current_subject),
               db: Session = Depends(get_db)):
    """提交者视角：本人全部解释（含已撤回）与处理进展。"""
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    notes = appeal_service.list_notes(db, task, subject)
    return {"notes": [appeal_service.to_dict(db, n) for n in notes]}


@router.post("/me/appeals/{note_id}/withdraw")
def withdraw_appeal(note_id: int,
                    grant_and_subject: tuple = Depends(current_subject),
                    db: Session = Depends(get_db)):
    """撤回：只改状态，历史保留；只能撤回本人未撤回的解释。"""
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    try:
        note = appeal_service.withdraw_note(db, task, subject, note_id)
    except appeal_service.AppealError as e:
        raise HTTPException(422, str(e))
    db.commit()
    return {"note_id": note.id, "status": note.status}


@router.get("/me/results")
def my_results(grant_and_subject: tuple = Depends(current_subject), db: Session = Depends(get_db)):
    grant, subject = grant_and_subject
    task = db.get(Task, grant.task_id)
    out = current_summary(db, task, subject.id)
    # P04：提交者同样看到规则明细（哪里有问题/怎么改/引用证据），与 P03 同源
    out["details"] = current_details(db, task, subject.id)
    # P04 申诹入口：本人解释与处理进展（不改变机器结论）
    out["appeals"] = [appeal_service.to_dict(db, n)
                      for n in appeal_service.list_notes(db, task, subject)]
    return out

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
    try:
        run = create_run(db, task, rev)
    except ValueError as e:
        raise HTTPException(422, str(e))
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    execute_run(db, run)
    db.commit()
    return {"run_id": run.id, "status": run.status}

@router.post("/tasks/{task_id}/subjects/{subject_id}/checks/retry")
def retry_check(task_id: int, subject_id: int, db: Session = Depends(get_db),
                acct: Account = Depends(current_account)):
    """重试一次检查（V20 / 表 6）：模型或 OCR 故障后可重试，历史运行保留不篡改。"""
    task = _owned_task(db, acct, task_id)
    subject = db.get(Subject, subject_id)
    if subject is None or subject.task_id != task.id:
        raise HTTPException(404, "提交者不存在或不属于该任务")
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task_id, Submission.subject_id == subject_id))
    if submission is None or submission.current_revision_id is None:
        raise HTTPException(422, "该提交者尚未正式提交")
    rev = db.get(Revision, submission.current_revision_id)
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == rev.id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))
    if run is None:
        raise HTTPException(422, "尚未发起检查，无可重试运行")
    try:
        new_run = retry_run(db, run)
    except ValueError as e:
        raise HTTPException(409, str(e))
    except task_service.TaskNotWritable as e:
        raise HTTPException(409, str(e))
    execute_run(db, new_run)
    db.commit()
    return {"run_id": new_run.id, "status": new_run.status,
            "retried_from": run.id}

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
    same_name = task_service.same_name_subjects(db, task, subject)
    return {"decision_id": d.id, "decision": d.decision,
            "same_name_subjects": same_name,
            "same_name_hint": ("存在同名主体：只提示待核、不自动合并，请以主体 ID 为准人工核对"
                               if same_name else "")}

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
    same_name = task_service.same_name_subjects(db, task, subject)
    same_name_hint = ("存在同名主体：只提示待核、不自动合并，请以主体 ID 为准人工核对"
                      if same_name else "")
    submission = db.scalar(select(Submission).where(Submission.task_id == task.id,
                                             Submission.subject_id == subject.id))
    if submission is None or submission.current_revision_id is None:
        return {"subject": {"id": subject.id, "name": subject.display_name},
                "revision": None, "run": None, "rules": [], "decisions": [],
                "same_name_subjects": same_name, "same_name_hint": same_name_hint}
    rev = db.get(Revision, submission.current_revision_id)
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == rev.id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))
    rules = rule_details(db, run)
    decisions = [{"id": d.id, "decision": d.decision, "reason": d.reason,
                  "scope_rule_id": d.scope_rule_id, "revoked": d.revoked,
                  "created_at": _iso(d.created_at)}
                 for d in db.scalars(select(ManualDecision).where(
                     ManualDecision.task_id == task.id,
                     ManualDecision.subject_id == subject.id).order_by(ManualDecision.id)).all()]
    return {"subject": {"id": subject.id, "name": subject.display_name},
            "revision": {"id": rev.id, "version": rev.version, "receipt": rev.receipt},
            "run": ({"id": run.id, "status": run.status,
                     "pages_read": run.pages_read,
                     "llm_calls_used": run.llm_calls_used,
                     "budget_exhausted": run.budget_exhausted,
                     "coverage": run_coverage(run)} if run else None),
            "rules": rules, "decisions": decisions,
            "notes": [appeal_service.to_dict(db, n)
                      for n in appeal_service.pending_notes(db, task)
                      if n.subject_id == subject.id],
            "same_name_subjects": same_name, "same_name_hint": same_name_hint}

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
