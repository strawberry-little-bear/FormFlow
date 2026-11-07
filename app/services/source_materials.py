"""组织者来源资料的私有存储、解析和需求 Agent 输入适配。"""
from __future__ import annotations

from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import storage
from ..models import (
    Account,
    RequirementSourceMaterial,
    SOURCE_FAILED,
    SOURCE_PROCESSING,
    SOURCE_READY,
    SOURCE_UNREAD,
    Task,
)
from ..parsing import ParseError, format_parse_text, parse_file

SOURCE_KINDS = {"notice", "roster", "template", "attachment", "other"}
MAX_SOURCE_COUNT = 8
MAX_SOURCE_BYTES = 20 * 1024 * 1024


class SourceMaterialError(ValueError):
    pass


def _source_path(row: RequirementSourceMaterial) -> Path:
    return Path(row.storage_path) if row.storage_path else (
        storage.file_dir(row.source_id) / f"original_{row.safe_name}")


def _metadata(row: RequirementSourceMaterial) -> dict:
    return {
        "id": row.source_id,
        "name": row.original_name,
        "kind": row.kind,
        "mime": row.mime,
        "size": row.size,
        "status": row.status,
        "parse_method": row.parse_method,
        "parse_error": row.parse_error[:240] if row.parse_error else "",
    }


def list_for_task(db: Session, task: Task) -> list[dict]:
    rows = db.scalars(select(RequirementSourceMaterial).where(
        RequirementSourceMaterial.task_id == task.id
    ).order_by(RequirementSourceMaterial.id)).all()
    return [_metadata(row) for row in rows]


def create(db: Session, task: Task, account: Account, *, kind: str,
           original_name: str, mime: str, content: bytes) -> RequirementSourceMaterial:
    kind = (kind or "other").strip().lower()
    if kind not in SOURCE_KINDS:
        raise SourceMaterialError("来源资料类型无效")
    if not content:
        raise SourceMaterialError("来源资料不能为空")
    if len(content) > MAX_SOURCE_BYTES:
        raise SourceMaterialError(f"来源资料不能超过 {MAX_SOURCE_BYTES // 1024 // 1024} MiB")
    existing_count = len(db.scalars(select(RequirementSourceMaterial.id).where(
        RequirementSourceMaterial.task_id == task.id)).all())
    if existing_count >= MAX_SOURCE_COUNT:
        raise SourceMaterialError(f"每个任务最多上传 {MAX_SOURCE_COUNT} 份来源资料")

    source_id = f"src_{storage.new_file_id()}"
    path, digest = storage.save_original(source_id, original_name or "unnamed", content)
    row = RequirementSourceMaterial(
        task_id=task.id,
        source_id=source_id,
        kind=kind,
        original_name=original_name or "unnamed",
        safe_name=storage.safe_name(original_name or "unnamed"),
        mime=mime or "application/octet-stream",
        size=len(content),
        sha256=digest,
        status=SOURCE_PROCESSING,
        storage_path=str(path),
        created_by=account.id,
    )
    db.add(row)
    db.flush()
    try:
        # 只建立文字缓存，不在上传阶段偷偷启动 OCR。无文字层的 PDF/图片
        # 保留 unread，需求 Agent 在直传失败时才按配置进入 OCR 降级。
        parsed = parse_file(path, allow_ocr=False)
        # Keep page boundaries in the fallback text.  The original file is
        # still the source of truth, while these markers let the requirements
        # Agent cite a stable page and expose unread coverage to the organizer.
        row.extracted_text = format_parse_text(parsed)
        row.parse_method = parsed.method
        row.parse_error = parsed.error or ""
        row.status = SOURCE_UNREAD if parsed.unread_pages or parsed.failed_pages else SOURCE_READY
    except ParseError as exc:
        row.status = SOURCE_FAILED
        row.parse_method = "none"
        row.parse_error = str(exc)[:500]
    db.flush()
    return row


def delete(db: Session, task: Task, source_id: str) -> RequirementSourceMaterial:
    row = db.scalar(select(RequirementSourceMaterial).where(
        RequirementSourceMaterial.task_id == task.id,
        RequirementSourceMaterial.source_id == source_id))
    if row is None:
        raise SourceMaterialError("来源资料不存在或不属于当前任务")
    db.delete(row)
    db.flush()
    return row


def load_inputs(db: Session, task: Task, source_ids: list[str]) -> tuple[list[dict], list]:
    """返回受控的文本摘要和原始文档引用；只允许当前任务的 source_id。"""
    from ..llm import DocumentInput

    if not isinstance(source_ids, list):
        raise SourceMaterialError("source_material_ids 必须是列表")
    if len(source_ids) > MAX_SOURCE_COUNT:
        raise SourceMaterialError(f"来源资料最多 {MAX_SOURCE_COUNT} 份")
    ids = [str(x).strip() for x in source_ids if str(x).strip()]
    if len(ids) != len(set(ids)):
        raise SourceMaterialError("来源资料 id 不能重复")
    rows = db.scalars(select(RequirementSourceMaterial).where(
        RequirementSourceMaterial.task_id == task.id,
        RequirementSourceMaterial.source_id.in_(ids))).all() if ids else []
    by_id = {row.source_id: row for row in rows}
    if len(by_id) != len(ids):
        raise SourceMaterialError("来源资料不存在或不属于当前任务")
    materials: list[dict] = []
    documents: list[DocumentInput] = []
    for source_id in ids:
        row = by_id[source_id]
        materials.append({
            "id": row.source_id,
            "name": row.original_name,
            "kind": row.kind,
            "content": row.extracted_text or "（原始文件尚未形成文字缓存，优先尝试模型直读）",
        })
        documents.append(DocumentInput(
            file_id=row.source_id,
            filename=row.original_name,
            path=_source_path(row),
            mime_type=row.mime or "application/octet-stream",
        ))
    return materials, documents


def remove_original(row: RequirementSourceMaterial) -> None:
    try:
        _source_path(row).unlink()
    except FileNotFoundError:
        pass
    except OSError:
        # 数据库删除已完成；清理失败不应让 API 误报事务回滚。
        pass
