"""服务层：交付快照与导出（第 11 节）。

- 汇总 CSV 和材料 ZIP 必须引用同一个快照，避免表格与文件错位。
- 固定蓝图版本、主体与正式版本、文件集合、人工决定引用、字段和命名策略。
- 同一导出作业重试仍读取同一快照；生成期间的新提交只提示，不静默改变原包。
- 文件名含稳定 ID 防同名覆盖；保留原名映射；CSV 防公式注入。
- 重开后正式提交 v2：新包默认排除该主体直至 v2 重新验收，不回退引用历史 v1。
"""
from __future__ import annotations

import csv
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..models import (
    DECISION_ACCEPT_CURRENT,
    DeliverySnapshot,
    ExportJob,
    FileObject,
    ManualDecision,
    Revision,
    Subject,
    Submission,
    Task,
)
from ..security import utcnow


def _utc(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


def create_snapshot(db: Session, task: Task, *, kind: str = "formal",
                    include_subject_ids: Optional[list[int]] = None) -> DeliverySnapshot:
    """固定纳入集合：只读当前事实，之后的新提交不影响本快照。"""
    if task.current_blueprint_id is None:
        raise ValueError("任务尚未发布蓝图")
    subjects = db.scalars(select(Subject).where(Subject.task_id == task.id)).all()
    if include_subject_ids is not None:
        subjects = [s for s in subjects if s.id in include_subject_ids]

    entries = []
    for s in subjects:
        submission = db.scalar(select(Submission).where(
            Submission.task_id == task.id, Submission.subject_id == s.id))
        rev: Optional[Revision] = None
        if submission and submission.current_revision_id:
            rev = db.get(Revision, submission.current_revision_id)
        accepted = False
        decisions: list[int] = []
        if rev is not None:
            ds = db.scalars(select(ManualDecision).where(
                ManualDecision.task_id == task.id, ManualDecision.subject_id == s.id,
                ManualDecision.revision_id == rev.id,
                ManualDecision.decision == DECISION_ACCEPT_CURRENT,
                ManualDecision.revoked == False)).all()  # noqa: E712
            accepted = bool(ds)
            decisions = [d.id for d in ds]
        excluded_reason = ""
        if rev is None:
            excluded_reason = "无正式提交版本"
        elif not accepted:
            excluded_reason = "当前版本未验收" if kind == "formal" else "当前版本未验收（整理预览仍列出）"
        files = []
        if rev is not None:
            for slot, fids in json.loads(rev.slot_file_ids_json).items():
                for fid in fids:
                    fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
                    if fo:
                        files.append({"slot": slot, "file_id": fo.file_id,
                                      "original_name": fo.original_name, "sha256": fo.sha256,
                                      "size": fo.size})
        entries.append({
            "subject_id": s.id, "name": s.display_name,
            "revision": rev.version if rev else None,
            "revision_id": rev.id if rev else None,
            "receipt": rev.receipt if rev else None,
            "formal_submitted_at": _utc(rev.formal_submitted_at) if rev else None,
            "accepted": accepted, "decision_ids": decisions,
            "included": (kind != "formal") or accepted,
            "excluded_reason": "" if ((kind != "formal") or accepted) else excluded_reason,
            "files": files,
        })

    manifest = {
        "task_id": task.id,
        "task_name": task.name,
        "kind": kind,
        "blueprint_version_id": task.current_blueprint_id,
        "created_at": utcnow().isoformat(),
        "entries": entries,
        "totals": {
            "subjects": len(entries),
            "included": sum(1 for e in entries if e["included"]),
            "excluded": sum(1 for e in entries if not e["included"]),
        },
    }
    snap = DeliverySnapshot(task_id=task.id, blueprint_version_id=task.current_blueprint_id,
                            manifest_json=json.dumps(manifest, ensure_ascii=False), kind=kind)
    db.add(snap)
    db.flush()
    return snap


def _csv_safe(value) -> str:
    """CSV 公式注入防护：= + - @ Tab CR 开头加前置单引号。"""
    s = "" if value is None else str(value)
    if s and s[0] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + s
    return s


def _build_csv(manifest: dict) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["主体ID", "名称", "正式版本", "回执", "收件时间", "是否纳入", "排除原因"])
    for e in manifest["entries"]:
        writer.writerow([_csv_safe(e["subject_id"]), _csv_safe(e["name"]),
                         _csv_safe(e["revision"]), _csv_safe(e["receipt"]),
                         _csv_safe(e["formal_submitted_at"]),
                         "是" if e["included"] else "否", _csv_safe(e["excluded_reason"])])
    return buf.getvalue().encode("utf-8-sig")


def run_export(db: Session, snapshot: DeliverySnapshot) -> ExportJob:
    """生成 CSV + ZIP；重试同一作业仍读取同一快照。"""
    job = ExportJob(snapshot_id=snapshot.id, status="running")
    db.add(job)
    db.flush()
    manifest = json.loads(snapshot.manifest_json)
    out_dir = storage.ensure_storage() / "exports" / f"snapshot_{snapshot.id}"
    out_dir.mkdir(parents=True, exist_ok=True)

    csv_path = out_dir / f"summary_{snapshot.id}.csv"
    csv_path.write_bytes(_build_csv(manifest))

    name_map = {}
    zip_path = out_dir / f"materials_{snapshot.id}.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for e in manifest["entries"]:
            if not e["included"]:
                continue
            for f in e["files"]:
                fo = db.scalar(select(FileObject).where(FileObject.file_id == f["file_id"]))
                if fo is None:
                    continue
                src = storage.file_dir(fo.file_id) / f"original_{fo.safe_name}"
                if not src.exists():
                    continue
                # 稳定 ID 前缀防同名覆盖；保留原名映射
                arc = f"{e['subject_id']:06d}_{fo.file_id[:8]}_{storage.safe_name(fo.original_name)}"
                zf.write(src, arc)
                name_map[arc] = {"original_name": f["original_name"],
                                 "subject_id": e["subject_id"], "sha256": f["sha256"]}
        zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
        zf.writestr("original_names.json", json.dumps(name_map, ensure_ascii=False, indent=2))

    job.csv_path = str(csv_path)
    job.zip_path = str(zip_path)
    job.status = "success"
    job.finished_at = utcnow()
    db.flush()
    return job
