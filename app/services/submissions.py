"""服务层：提交与正式收件。

方案第 6/8 节：
- 以服务端成功记录正式提交的时刻为收件时间；上传成功不等于正式提交。
- 初次接收区间 [开放时刻, 首次截止)；恰等于截止不接收首次提交。
- 只有已形成正式提交的主体才能使用补正窗口。
- 幂等：同键同内容返回同一回执；同键异内容报冲突。
- 超时重试先查原键；已成功的请求跨过截止后仍可取回原回执。
"""
from __future__ import annotations

import hashlib
import json
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    RESULT_FAILED,
    SUBMISSION_FORMAL,
    TASK_COLLECTING,
    FileObject,
    Revision,
    Submission,
    Task,
)
from ..schemas import Blueprint
from . import tasks as task_service


class SubmitError(Exception):
    """提交被拒绝（权限/时间/版本/文件）。"""


class IdempotencyConflict(SubmitError):
    """同幂等键但内容不同。"""


def _payload_hash(fields: dict, slot_file_ids: dict) -> str:
    raw = json.dumps({"fields": fields, "files": slot_file_ids},
                     ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_or_create_draft(db: Session, task: Task, subject_id: int) -> Submission:
    sub = db.scalar(select(Submission).where(Submission.task_id == task.id,
                                             Submission.subject_id == subject_id))
    if sub is None:
        sub = Submission(task_id=task.id, subject_id=subject_id, state="draft")
        db.add(sub)
        db.flush()
    return sub


def save_draft(db: Session, submission: Submission, fields: dict, expected_version: Optional[int] = None) -> int:
    """保存草稿。expected_version 不匹配 → 冲突，保留本地内容（V14）。"""
    task_service.ensure_task_writable(db.get(Task, submission.task_id))  # V24 readonly
    if expected_version is not None and expected_version != submission.draft_version:
        raise SubmitError(f"草稿版本冲突：服务端当前 v{submission.draft_version}，"
                          f"你基于 v{expected_version} 编辑，请核对后重试")
    submission.draft_version += 1
    db.flush()
    return submission.draft_version


def attach_file(db: Session, submission: Submission, *, slot: str, original_name: str,
                content: bytes, sha256: str, mime: str) -> FileObject:
    from .. import storage

    task_service.ensure_task_writable(db.get(Task, submission.task_id))  # V24 readonly

    file_id = storage.new_file_id()
    path, digest = storage.save_original(file_id, original_name, content)
    fo = FileObject(
        file_id=file_id, submission_id=submission.id, slot=slot,
        original_name=original_name, safe_name=storage.safe_name(original_name),
        sha256=digest or sha256, size=len(content), mime=mime, status="received",
    )
    db.add(fo)
    db.flush()
    return fo


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _check_window(task: Task, *, has_formal: bool, now: datetime) -> None:
    """双截止校验（第 6 节）。

    - 首次提交必须落在 [开放时刻, 首次截止)；恰等于截止不接收。
    - 已有正式提交者可在补正截止前更新版本（截止前为更新，截止后为补正）。
    - 首次截止前仅有草稿者，不能截止后借补正完成首次报名。
    存储用 UTC；任务时区仅用于展示与录入换算。
    """
    tz = timezone.utc
    open_at = task.open_at.replace(tzinfo=tz) if task.open_at and task.open_at.tzinfo is None else task.open_at
    first = task.first_deadline.replace(tzinfo=tz) if task.first_deadline and task.first_deadline.tzinfo is None else task.first_deadline
    correction = task.correction_deadline.replace(tzinfo=tz) if task.correction_deadline and task.correction_deadline.tzinfo is None else task.correction_deadline
    if open_at and now < open_at:
        raise SubmitError("任务尚未开放")
    if correction and now >= correction:
        raise SubmitError("已过补正截止")
    if not has_formal and first and now >= first:
        raise SubmitError("已过首次截止，不能形成新的正式提交（恰等于截止时刻不接收）")


def formal_submit(db: Session, task: Task, submission: Submission, *, fields: dict,
                  slot_file_ids: dict, idempotency_key: str,
                  is_correction: Optional[bool] = None) -> Revision:
    """正式提交并检查：同一可靠边界记录正式版本与检查意图。"""
    if not idempotency_key:
        raise SubmitError("缺少幂等键")
    payload_hash = _payload_hash(fields, slot_file_ids)
    has_formal = submission.current_revision_id is not None
    is_first = (not has_formal) if is_correction is None else (not is_correction)
    if is_correction and not has_formal:
        raise SubmitError("没有正式提交记录，不能使用补正窗口")

    # 幂等：同键同内容 → 同一回执；同键异内容 → 冲突
    existing = db.scalar(select(Revision).where(Revision.idempotency_key == idempotency_key))
    if existing is not None:
        if existing.submission_id != submission.id:
            raise IdempotencyConflict("幂等键属于其他提交")
        if existing.payload_hash == payload_hash:
            return existing  # 超时重试：恢复同一回执，不重复报名
        raise IdempotencyConflict("同一幂等键提交了不同内容")

    task_service.ensure_task_writable(task)  # V24 readonly
    _check_window(task, has_formal=has_formal, now=_now_utc())

    # 文件就绪校验：未就绪/失败的文件不进入正式快照
    for slot, fids in slot_file_ids.items():
        for fid in fids:
            fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
            if fo is None or fo.submission_id != submission.id:
                raise SubmitError(f"文件 {fid} 不属于当前提交")
            if fo.status == "failed":
                raise SubmitError(f"文件 {fo.original_name} 处理失败，请重新上传")

    latest = db.scalar(select(Revision).where(Revision.submission_id == submission.id)
                       .order_by(Revision.version.desc()))
    version = (latest.version + 1) if latest else 1
    rev = Revision(
        submission_id=submission.id, version=version,
        fields_json=json.dumps(fields, ensure_ascii=False),
        slot_file_ids_json=json.dumps(slot_file_ids, ensure_ascii=False),
        idempotency_key=idempotency_key, payload_hash=payload_hash,
        receipt="R" + secrets.token_hex(8).upper(),
        formal_submitted_at=_now_utc(),
    )
    db.add(rev)
    db.flush()
    submission.current_revision_id = rev.id
    submission.state = SUBMISSION_FORMAL
    task_service.audit(db, "submission.formal", "revision",
                       {"revision": rev.id, "version": version, "receipt": rev.receipt}, task.id)
    return rev


def new_idempotency_key() -> str:
    return secrets.token_urlsafe(16)
