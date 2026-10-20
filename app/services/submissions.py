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

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import (
    SUBMISSION_FORMAL,
    BlueprintVersion,
    FileObject,
    Revision,
    Submission,
    SubmissionDraft,
    Task,
)
from ..schemas import Blueprint
from ..agents.review_agent import _eval_condition
from . import tasks as task_service


class SubmitError(Exception):
    """提交被拒绝（权限/时间/版本/文件）。"""


class SubmissionValidationError(SubmitError):
    """Incomplete/invalid formal payload, with stable field and slot locations."""

    def __init__(self, issues: list[dict]):
        self.issues = issues
        super().__init__("提交前请修正以下内容：" + "；".join(i["message"] for i in issues))


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


def read_draft(db: Session, submission: Submission | None) -> dict:
    if submission is None:
        return {"fields": {}, "slot_file_ids": {}, "draft_version": 1}
    draft = db.scalar(select(SubmissionDraft).where(SubmissionDraft.submission_id == submission.id))
    if draft is not None:
        fields = json.loads(draft.fields_json)
        files = json.loads(draft.slot_file_ids_json)
    else:
        # Preserve drafts saved before the versioned attachment manifest existed.
        fields = json.loads(submission.draft_fields_json or "{}")
        if not fields and submission.current_revision_id:
            fields = json.loads(db.get(Revision, submission.current_revision_id).fields_json)
        files = {}
        for fo in db.scalars(select(FileObject).where(
                FileObject.submission_id == submission.id, FileObject.status != "failed")
                .order_by(FileObject.id)):
            files.setdefault(fo.slot, []).append(fo.file_id)
    return {"fields": fields, "slot_file_ids": files,
            "draft_version": submission.draft_version}


def _write_draft(db: Session, submission: Submission, fields: dict, files: dict) -> None:
    draft = db.scalar(select(SubmissionDraft).where(SubmissionDraft.submission_id == submission.id))
    if draft is None:
        draft = SubmissionDraft(submission_id=submission.id)
        db.add(draft)
    submission.draft_fields_json = json.dumps(fields, ensure_ascii=False)
    draft.fields_json = submission.draft_fields_json
    draft.slot_file_ids_json = json.dumps(files, ensure_ascii=False)

    db.flush()


def _validate_files(db: Session, submission: Submission, files: dict) -> None:
    for slot, ids in files.items():
        if not isinstance(ids, list):
            raise SubmitError("材料引用必须是文件 ID 列表")
        for fid in ids:
            fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
            if fo is None or fo.submission_id != submission.id or fo.slot != slot:
                raise SubmitError(f"文件 {fid} 不属于当前提交的槽位 {slot}")


def save_draft(db: Session, submission: Submission, fields: dict,
               expected_version: Optional[int] = None, *, slot_file_ids: Optional[dict] = None) -> int:
    """Compare-and-swap before writing content; conflicts never overwrite either draft."""
    task_service.ensure_task_writable(db.get(Task, submission.task_id))
    expected = submission.draft_version if expected_version is None else expected_version
    changed = db.execute(update(Submission).where(
        Submission.id == submission.id, Submission.draft_version == expected
    ).values(draft_version=Submission.draft_version + 1).execution_options(synchronize_session=False))
    if changed.rowcount != 1:
        raise SubmitError(f"草稿版本冲突：你基于 v{expected} 编辑，请保留本地内容并重新核对")
    db.refresh(submission)
    previous = read_draft(db, submission)
    files = previous["slot_file_ids"] if slot_file_ids is None else slot_file_ids
    _validate_files(db, submission, files)
    _write_draft(db, submission, fields, files)
    return submission.draft_version


def draft_view(db: Session, task: Task, submission: Submission) -> dict:
    """恢复草稿：字段 + 未入正式版本的上传文件 + 版本号。

    文件按槽位分组；已失败的文件不返回（前端看不到即不会被误提交）。
    正式提交后仍返回最近一次正式版本的字段，便于补正时对照修改。
    """
    content = read_draft(db, submission)
    slot_files = {}
    for slot, ids in content["slot_file_ids"].items():
        for fid in ids:
            fo = db.scalar(select(FileObject).where(FileObject.file_id == fid,
                                                    FileObject.submission_id == submission.id))
            if fo is not None and fo.status != "failed":
                slot_files.setdefault(slot, []).append({
                    "file_id": fo.file_id, "name": fo.original_name,
                    "size": fo.size, "mime": fo.mime, "status": fo.status})
    return {**content, "slot_file_ids": slot_files,
            "formal_revision": submission.state == SUBMISSION_FORMAL,
            "updated_at": submission.updated_at.isoformat() if submission.updated_at else ""}


def _referenced_file_ids(db: Session, submission: Submission) -> set[str]:
    """任一正式版本引用过的文件都不能从草稿里删除（历史不可篡改）。"""
    used: set[str] = set()
    for rev in db.scalars(select(Revision).where(
            Revision.submission_id == submission.id)).all():
        try:
            mapping = json.loads(rev.slot_file_ids_json or "{}")
        except (TypeError, ValueError):
            continue
        for ids in mapping.values():
            used.update(ids or [])
    return used


def delete_file(db: Session, submission: Submission, file_id: str) -> None:
    """删除尚未进入正式版本的上传文件。"""
    from .. import storage

    task_service.ensure_task_writable(db.get(Task, submission.task_id))  # V24 readonly
    fo = db.scalar(select(FileObject).where(FileObject.file_id == file_id))
    if fo is None or fo.submission_id != submission.id:
        raise SubmitError("文件不存在或不属于当前提交")
    if file_id in _referenced_file_ids(db, submission):
        raise SubmitError("该文件已进入正式版本，不能从草稿中删除（历史版本不可篡改）")
    path = storage.file_dir(file_id) / f"original_{fo.safe_name}"
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    draft = db.scalar(select(SubmissionDraft).where(SubmissionDraft.submission_id == submission.id))
    if draft is not None:
        files = json.loads(draft.slot_file_ids_json)
        files = {slot: [fid for fid in ids if fid != file_id] for slot, ids in files.items()}
        draft.slot_file_ids_json = json.dumps({slot: ids for slot, ids in files.items() if ids})
    db.delete(fo)
    db.flush()


def validate_upload(task: Task, blueprint: Optional[Blueprint], *, slot: str,
                    original_name: str, size: int) -> None:
    """按已发布蓝图校验上传：槽位存在、格式、数量上限、单文件大小。

    未发布蓝图时不做业务校验（上传仍受任务只读状态约束）。
    """
    if blueprint is None:
        return
    slot_def = next((s for s in blueprint.slots if s.id == slot), None)
    if slot_def is None:
        raise SubmitError(f"槽位 {slot} 不在当前收集要求中")
    if slot_def.formats:
        suffix = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
        allowed = {f.lower().lstrip(".") for f in slot_def.formats}
        if suffix not in allowed:
            raise SubmitError(
                f"「{slot_def.label}」只接受 {' / '.join(sorted(allowed))} 格式，"
                f"当前文件是 {suffix or '无扩展名'}")
    if slot_def.max_size_mib is not None and size > slot_def.max_size_mib * 1024 * 1024:
        raise SubmitError(
            f"「{slot_def.label}」单份不能超过 {slot_def.max_size_mib:g} MiB，"
            f"当前文件 {size / 1024 / 1024:.1f} MiB")


def validate_slot_count(db: Session, submission: Submission, blueprint: Optional[Blueprint],
                        *, slot: str) -> None:
    """上传前检查该槽位已有文件数是否已达上限。"""
    if blueprint is None:
        return
    slot_def = next((s for s in blueprint.slots if s.id == slot), None)
    if slot_def is None:
        return
    count = len(db.scalars(select(FileObject).where(
        FileObject.submission_id == submission.id,
        FileObject.slot == slot,
        FileObject.status != "failed")).all())
    if count >= slot_def.max_count:
        raise SubmitError(f"「{slot_def.label}」最多 {slot_def.max_count} 份，"
                          f"请先删除多余文件再上传")


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
    draft = db.scalar(select(SubmissionDraft).where(SubmissionDraft.submission_id == submission.id))
    if draft is not None:
        files = json.loads(draft.slot_file_ids_json)
        files.setdefault(slot, []).append(fo.file_id)
        draft.slot_file_ids_json = json.dumps(files)
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

    validate_formal_payload(db, task, submission, fields, slot_file_ids)

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
    # Formal submission also invalidates drafts open in other tabs.
    submission.draft_version += 1
    _write_draft(db, submission, fields, slot_file_ids)
    task_service.audit(db, "submission.formal", "revision",
                       {"revision": rev.id, "version": version, "receipt": rev.receipt}, task.id)
    return rev


def validate_formal_payload(db: Session, task: Task, submission: Submission,
                           fields: dict, files: dict) -> None:
    """Only structural completeness is a gate; content checks still run after receipt.

    Drafts remain partial. Use the currently published blueprint, not a client copy.
    File metadata is rechecked here because upload-time limits may have changed.
    """
    bp = db.get(BlueprintVersion, task.current_blueprint_id) if task.current_blueprint_id else None
    blueprint = Blueprint.model_validate_json(bp.blueprint_json) if bp else None
    issues: list[dict] = []

    def issue(target: str, ident: str, code: str, message: str) -> None:
        issues.append(dict(target=target, id=ident, code=code, message=message))

    # Conditions use the same evaluator as post-submission checks. Whitespace-only
    # input is empty, but numeric zero is a legitimate required value.
    if blueprint:
        for field in blueprint.fields:
            value = fields.get(field.id)
            if field.type.value == "enum" and value is not None and (
                    not isinstance(value, str) or value.strip()):
                if not isinstance(value, str) or value.strip() not in field.options:
                    issue("field", field.id, "invalid_option", f"请从「{field.label}」的选项中选择")
            if not field.required:
                continue
            required = _eval_condition(field.required_condition, fields)
            if required is None:
                issue("field", field.id, "unsupported_condition",
                      f"「{field.label}」的必填条件无法判断，请联系组织者核对要求")
            elif required:
                value = fields.get(field.id)
                if (value is None or (isinstance(value, str) and not value.strip())
                        or value == [] or value == {}):
                    issue("field", field.id, "required", f"请填写「{field.label}」")

        for slot in blueprint.slots:
            required = _eval_condition(slot.required_condition, fields)
            if required is None:
                issue("slot", slot.id, "unsupported_condition",
                      f"「{slot.label}」的必交条件无法判断，请联系组织者核对要求")
            elif required and not files.get(slot.id):
                issue("slot", slot.id, "required", f"请上传「{slot.label}」")

    slots = {s.id: s for s in blueprint.slots} if blueprint else {}
    for slot_id, ids in files.items():
        if not isinstance(ids, list) or any(not isinstance(fid, str) or not fid for fid in ids):
            issue("slot", slot_id, "invalid_files", "材料引用必须是文件 ID 列表")
            continue
        if blueprint and slot_id not in slots:
            issue("slot", slot_id, "unknown_slot", f"槽位 {slot_id} 不在当前收集要求中，请重新核对")
            continue
        slot = slots.get(slot_id)
        if len(ids) != len(set(ids)):
            issue("slot", slot_id, "duplicate_file", "同一材料不能重复计入份数，请移除重复引用")
        if slot and len(ids) > slot.max_count:
            issue("slot", slot_id, "max_count", f"「{slot.label}」最多 {slot.max_count} 份")
        for fid in dict.fromkeys(ids):
            fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
            if fo is None or fo.submission_id != submission.id or fo.slot != slot_id:
                issue("slot", slot_id, "invalid_file", "材料不存在或不属于当前提交的槽位，请重新上传")
                continue
            if fo.status == "failed":
                issue("slot", slot_id, "failed_file", f"文件「{fo.original_name}」处理失败，请重新上传")
                continue
            if blueprint:
                try:
                    validate_upload(task, blueprint, slot=slot_id,
                                    original_name=fo.original_name, size=fo.size)
                except SubmitError as exc:
                    issue("slot", slot_id, "file_constraints", str(exc))
    if issues:
        raise SubmissionValidationError(issues)


def new_idempotency_key() -> str:
    return secrets.token_urlsafe(16)
