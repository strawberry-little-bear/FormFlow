"""服务层：交付快照与导出（第 11 节）。

- 汇总 CSV 和材料 ZIP 必须引用同一个快照，避免表格与文件错位。
- 固定蓝图版本、主体与正式版本、文件集合、人工决定引用、字段和命名策略。
- 同一导出作业重试仍读取同一快照；生成期间的新提交只提示，不静默改变原包。
- 文件名含稳定 ID 防同名覆盖；保留原名映射；CSV 防公式注入。
- 重开后正式提交 v2：新包默认排除该主体直至 v2 重新验收，不回退引用历史 v1。
"""
from __future__ import annotations

import csv
import hashlib
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

try:  # 任务时区转换：3.9+ 自带 zoneinfo，缺失时退回 UTC 展示
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore[assignment]


class ExportIntegrityError(ValueError):
    """快照引用的材料不可完整读取或与固定元数据不符。"""


def _local_display(iso_value: Optional[str], tz_name: str) -> str:
    """把清单里的 UTC ISO 时间转成任务时区的可读时间，方便直接看表。"""
    if not iso_value:
        return ""
    try:
        dt = datetime.fromisoformat(str(iso_value))
    except (TypeError, ValueError):
        return str(iso_value)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    tz = None
    if ZoneInfo is not None:
        try:
            tz = ZoneInfo(tz_name or "Asia/Shanghai")
        except Exception:  # noqa: BLE001 - 非法时区名退回 UTC，不影响导出
            tz = None
    if tz is None:
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    return dt.astimezone(tz).strftime("%Y-%m-%d %H:%M")


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

    from .progress import exempt_subject_ids
    exempt_ids = exempt_subject_ids(db, task)
    entries = []
    for s in subjects:
        submission = db.scalar(select(Submission).where(
            Submission.task_id == task.id, Submission.subject_id == s.id))
        rev: Optional[Revision] = None
        if submission and submission.current_revision_id:
            rev = db.get(Revision, submission.current_revision_id)
        from .checks import current_summary
        summary = current_summary(db, task, s.id)
        qualification = summary["eligibility"]
        accepted = False
        decisions: list[int] = []
        if rev is not None:
            ds = db.scalars(select(ManualDecision).where(
                ManualDecision.task_id == task.id, ManualDecision.subject_id == s.id,
                ManualDecision.revision_id == rev.id,
                ManualDecision.decision == DECISION_ACCEPT_CURRENT,
                ManualDecision.revoked == False)).all()  # noqa: E712
            accepted = summary["acceptance"] == "accepted"
            decisions = [d.id for d in ds] if accepted else []
        excluded_reason = ""
        if rev is None:
            excluded_reason = "无正式提交版本"
        elif not accepted:
            excluded_reason = "当前版本未验收" if kind == "formal" else "当前版本未验收（整理预览仍列出）"
        if rev is not None and not accepted and qualification["required"] and qualification["status"] != "eligible":
            label = {"pending": "待核实", "not_assessed": "未评估", "ineligible": "不符合"}.get(qualification["status"], "待核实")
            excluded_reason = f"资格{label}：{qualification['status_reason']}"
        exempt = s.id in exempt_ids
        included = kind != "formal" or (accepted and not exempt)
        if exempt:
            excluded_reason = "有效免交（不等于材料验收）"
        files = []
        if rev is not None:
            for slot, fids in json.loads(rev.slot_file_ids_json).items():
                for fid in fids:
                    fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
                    if fo is None:
                        raise ExportIntegrityError(
                            f"无法固定快照：正式版本引用的材料记录已不存在（文件 ID {fid}）")
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
            "eligibility": qualification,
            "exempt": exempt, "included": included,
            "excluded_reason": "" if included else excluded_reason,
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


def _build_csv(manifest: dict, tz_name: str = "Asia/Shanghai") -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["主体ID", "名称", "正式版本", "回执", "收件时间", "是否纳入", "排除原因", "资格结论", "资格说明"])
    for e in manifest["entries"]:
        writer.writerow([_csv_safe(e["subject_id"]), _csv_safe(e["name"]),
                         _csv_safe(e["revision"]), _csv_safe(e["receipt"]),
                         _csv_safe(_local_display(e["formal_submitted_at"], tz_name)),
                         "是" if e["included"] else "否", _csv_safe(e["excluded_reason"]),
                         _csv_safe({"eligible": "符合", "ineligible": "不符合", "pending": "待核实",
                                    "not_assessed": "未评估"}.get(e.get("eligibility", {}).get("status"), "")),
                         _csv_safe(e.get("eligibility", {}).get("status_reason", ""))])
    return buf.getvalue().encode("utf-8-sig")


def _included_files(db: Session, manifest: dict) -> list[tuple[dict, dict, FileObject, Path]]:
    if not isinstance(manifest, dict) or not isinstance(manifest.get("entries"), list):
        raise ExportIntegrityError("快照清单无法读取，未生成交付文件")
    files = []
    for entry in manifest["entries"]:
        if not isinstance(entry, dict):
            raise ExportIntegrityError("快照清单格式无效，未生成交付文件")
        if not entry.get("included"):
            continue
        for item in entry.get("files", []):
            if not isinstance(item, dict) or not item.get("file_id"):
                raise ExportIntegrityError("快照中存在无法识别的材料引用，未生成交付文件")
            file_id = str(item["file_id"])
            fo = db.scalar(select(FileObject).where(FileObject.file_id == file_id))
            if fo is None:
                raise ExportIntegrityError(
                    f"快照引用的材料记录已不存在（文件 ID {file_id}），未生成交付文件")
            source = storage.file_dir(fo.file_id) / f"original_{fo.safe_name}"
            if not source.is_file():
                raise ExportIntegrityError(
                    f"快照引用的材料原件无法找到（{item.get('original_name') or file_id}，文件 ID {file_id}），未生成交付文件")
            files.append((entry, item, fo, source))
    return files


def _write_verified_file(zf: zipfile.ZipFile, source: Path, archive_name: str,
                         item: dict, file_id: str) -> None:
    digest = hashlib.sha256()
    size = 0
    try:
        with source.open("rb") as src, zf.open(archive_name, "w") as dst:
            while chunk := src.read(1024 * 1024):
                size += len(chunk)
                digest.update(chunk)
                dst.write(chunk)
    except OSError as exc:
        raise ExportIntegrityError(
            f"材料原件在导出时读取失败（文件 ID {file_id}），未生成交付文件") from exc
    expected_size = item.get("size")
    if expected_size is not None and size != expected_size:
        raise ExportIntegrityError(
            f"材料大小与固定快照不一致（文件 ID {file_id}），未生成交付文件")
    expected_hash = str(item.get("sha256") or "").lower()
    if expected_hash and digest.hexdigest().lower() != expected_hash:
        raise ExportIntegrityError(
            f"材料内容与固定快照不一致（文件 ID {file_id}），未生成交付文件")


def _remove_partial(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        except OSError:
            # A failed cleanup still leaves the job without public download paths.
            pass


def run_export(db: Session, snapshot: DeliverySnapshot) -> ExportJob:
    """生成 CSV + ZIP；任何快照材料缺失或内容变化都会 fail closed。"""
    job = ExportJob(snapshot_id=snapshot.id, status="running")
    db.add(job)
    db.flush()
    partial_paths: list[Path] = []
    try:
        manifest = json.loads(snapshot.manifest_json)
        files = _included_files(db, manifest)
        out_dir = storage.ensure_storage() / "exports" / f"snapshot_{snapshot.id}"
        out_dir.mkdir(parents=True, exist_ok=True)
        csv_path = out_dir / f"summary_{snapshot.id}_{job.id}.csv"
        zip_path = out_dir / f"materials_{snapshot.id}_{job.id}.zip"
        csv_tmp = out_dir / f".{csv_path.name}.part"
        zip_tmp = out_dir / f".{zip_path.name}.part"
        partial_paths = [csv_tmp, zip_tmp, csv_path, zip_path]
        task = db.get(Task, snapshot.task_id)
        csv_tmp.write_bytes(_build_csv(manifest, getattr(task, "timezone", "") or "Asia/Shanghai"))

        name_map = {}
        with zipfile.ZipFile(zip_tmp, "w", zipfile.ZIP_DEFLATED) as zf:
            for entry, item, fo, source in files:
                file_id = str(item["file_id"])
                original_name = str(item.get("original_name") or file_id)
                # 稳定 ID 前缀防同名覆盖；ZIP 使用快照中的原名。
                arc = f"{entry['subject_id']:06d}_{file_id[:8]}_{storage.safe_name(original_name)}"
                _write_verified_file(zf, source, arc, item, file_id)
                name_map[arc] = {"original_name": original_name,
                                 "subject_id": entry["subject_id"],
                                 "sha256": item.get("sha256", "")}
            zf.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            zf.writestr("original_names.json", json.dumps(name_map, ensure_ascii=False, indent=2))

        csv_tmp.replace(csv_path)
        zip_tmp.replace(zip_path)
        job.csv_path = str(csv_path)
        job.zip_path = str(zip_path)
        job.status = "success"
        job.error = ""
    except ExportIntegrityError as exc:
        _remove_partial(partial_paths)
        job.csv_path = ""
        job.zip_path = ""
        job.status = "failed"
        job.error = str(exc)[:1000]
    except (OSError, ValueError, TypeError, KeyError) as exc:
        _remove_partial(partial_paths)
        job.csv_path = ""
        job.zip_path = ""
        job.status = "failed"
        if isinstance(exc, OSError):
            job.error = "交付文件读写失败；未生成可下载文件，请检查存储后重试。"
        else:
            job.error = "快照清单无效；未生成可下载文件，请重新核对快照。"
    job.finished_at = utcnow()
    db.flush()
    return job
