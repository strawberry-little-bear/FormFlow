"""Durable queue and idempotent result recovery for long design-Agent requests."""
from __future__ import annotations

import hashlib
import json
import re
from datetime import timedelta

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import SessionLocal
from ..config import settings
from ..models import Account, AgentDraftRequest, BlueprintVersion, Task
from ..agents.requirements_agent import draft_blueprint
from ..security import utcnow
from . import tasks as task_service

REQUEST_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{16,80}$")
# Cover the configured primary/retry/fallback budget with margin before recovering
# a worker that appears stuck. The attempt counter fences off any late stale result.
LLM_WORST_CASE_SECONDS = (settings.llm_timeout_seconds * (settings.llm_max_retries + 1)
                          + (90 if settings.llm_fallback_model else 0) + 600)
RUNNING_LEASE = timedelta(seconds=max(1800, LLM_WORST_CASE_SECONDS))
MAX_PAYLOAD_BYTES = 32_768


class AgentRequestError(ValueError):
    pass


def normalize_payload(raw: dict) -> dict:
    if not isinstance(raw, dict):
        raise AgentRequestError("请求内容格式不正确")
    kind = raw.get("kind")
    if kind == "agent":
        requirement = str(raw.get("requirement") or "").strip()
        if not requirement:
            raise AgentRequestError("请先说说这次要收什么")
        try:
            base_id = int(raw.get("base_blueprint_id") or 0)
        except (TypeError, ValueError) as exc:
            raise AgentRequestError("草案版本无效，请刷新后再试") from exc
        if base_id < 0:
            raise AgentRequestError("草案版本无效，请刷新后再试")
        payload = {"kind": "agent", "requirement": requirement,
                   "template": str(raw.get("template") or ""),
                   "base_blueprint_id": base_id}
    elif kind == "revise":
        try:
            bp_id = int(raw.get("blueprint_version_id"))
        except (TypeError, ValueError) as exc:
            raise AgentRequestError("没有找到要修改的草案版本，请刷新后再试") from exc
        if bp_id <= 0:
            raise AgentRequestError("草案版本无效，请刷新后再试")
        requirement = str(raw.get("requirement") or "")
        instruction = str(raw.get("instruction") or "")
        answered = raw.get("answered") or {}
        if not isinstance(answered, dict):
            raise AgentRequestError("澄清回答格式不正确，请刷新后重试")
        payload = {"kind": "revise", "blueprint_version_id": bp_id,
                   "base_blueprint_id": bp_id, "requirement": requirement,
                   "answered": answered, "instruction": instruction}
    else:
        raise AgentRequestError("不支持的需求处理方式")
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_PAYLOAD_BYTES:
        raise AgentRequestError("这段修改内容比较长，请分成两次说明")
    return payload


def validate_request_id(request_id: str) -> str:
    request_id = (request_id or "").strip()
    if not REQUEST_ID_PATTERN.fullmatch(request_id):
        raise AgentRequestError("本次请求编号无效，请重新发送")
    return request_id


def _request_hash(payload: dict) -> str:
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def enqueue(db: Session, task: Task, account: Account, request_id: str,
            raw_payload: dict) -> tuple[AgentDraftRequest, bool]:
    payload = normalize_payload(raw_payload)
    request_id = validate_request_id(request_id)
    digest = _request_hash(payload)
    existing = db.scalar(select(AgentDraftRequest).where(
        AgentDraftRequest.task_id == task.id,
        AgentDraftRequest.account_id == account.id,
        AgentDraftRequest.request_id == request_id))
    if existing is not None:
        if existing.request_hash != digest:
            raise AgentRequestError("这次请求编号已用于另一段内容；原草案没有被重复修改")
        if existing.status == "failed":
            existing.status = "queued"
            existing.error = ""
            existing.updated_at = utcnow()
            db.flush()
            return existing, True
        return existing, existing.status == "queued"

    job = AgentDraftRequest(
        task_id=task.id, account_id=account.id, request_id=request_id,
        request_hash=digest, payload_json=json.dumps(payload, ensure_ascii=False),
        status="queued", attempts=0, result_json="", error="",
        created_at=utcnow(), updated_at=utcnow())
    try:
        db.add(job)
        db.flush()
        return job, True
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(AgentDraftRequest).where(
            AgentDraftRequest.task_id == task.id,
            AgentDraftRequest.account_id == account.id,
            AgentDraftRequest.request_id == request_id))
        if existing is None or existing.request_hash != digest:
            raise AgentRequestError("请求正在被另一个标签页处理，请刷新查看进度")
        return existing, existing.status == "queued"


def public_status(job: AgentDraftRequest) -> dict:
    out = {"request_id": job.request_id, "status": job.status,
           "attempts": job.attempts}
    if job.status == "completed" and job.result_json:
        out["result"] = json.loads(job.result_json)
    elif job.status == "failed":
        out["error"] = job.error or "这次请求没有完成；原草案仍保留，可以重试。"
    return out


def _latest_blueprint_id(db: Session, task_id: int) -> int:
    latest = db.scalar(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task_id).order_by(BlueprintVersion.version.desc()))
    return latest.id if latest else 0


def _model_failed(result) -> bool:
    markers = ("需求 Agent 暂不可用", "需求 Agent 返回无法解析")
    return any(str(w).startswith(markers) for w in result.warnings)


def _execute_request(db: Session, job: AgentDraftRequest, task: Task, payload: dict) -> dict:
    base_id = int(payload.get("base_blueprint_id") or 0)
    latest_id = _latest_blueprint_id(db, task.id)
    if base_id != latest_id:
        raise AgentRequestError("草案已在另一页面更新；请回到最新版本核对后，再提交保留的修改内容")
    task_service.ensure_task_writable(task)
    if payload["kind"] == "agent":
        result = draft_blueprint(payload["requirement"], template=payload.get("template") or None)
        if _model_failed(result):
            # 区分"没配密钥"和"这次没回好"：前者重试也不会成功，必须如实说
            unavailable = next((str(w) for w in result.warnings
                                if str(w).startswith("需求 Agent 暂不可用")), "")
            if "未配置" in unavailable or "API_KEY" in unavailable:
                raise AgentRequestError(
                    "当前没有接入 AI 模型（未配置模型密钥），小齐暂时无法自动起草。"
                    "可以先用模板开始，或手动编辑右侧草案；配好密钥后同一段话再发一次即可。")
            raise AgentRequestError("小齐这次没有收到完整回复，原草案没有更改。你的原文仍保留，可以重试或先选模板继续。")
        blueprint = task_service.save_draft(
            db, task, result, source_text=payload["requirement"])
        blocking, advisories = task_service.split_publish_checks(result.blueprint, blueprint, result)
        return {"blueprint_version_id": blueprint.id, "version": blueprint.version,
                "status": blueprint.status, "draft": result.model_dump(),
                "blocking": blocking, "advisories": advisories}

    result, blueprint, impact = task_service.revise_draft(
        db, task, payload["blueprint_version_id"],
        requirement=payload.get("requirement", ""),
        answered=payload.get("answered") or {},
        instruction=payload.get("instruction", ""))
    if _model_failed(result):
        unavailable = next((str(w) for w in result.warnings
                            if str(w).startswith("需求 Agent 暂不可用")), "")
        if "未配置" in unavailable or "API_KEY" in unavailable:
            raise AgentRequestError(
                "当前没有接入 AI 模型（未配置模型密钥），小齐暂时无法处理这次修改。"
                "草案没有改动；可以先手动调整右侧内容，配好密钥后再说一次即可。")
        raise AgentRequestError("小齐这次没有收到完整回复，草案没有更改。你的回答仍保留，可以重试。")
    blocking, advisories = task_service.split_publish_checks(result.blueprint, blueprint, result)
    return {"blueprint_version_id": blueprint.id, "version": blueprint.version,
            "status": blueprint.status, "draft": result.model_dump(),
            "impact": impact, "blocking": blocking, "advisories": advisories}


def process_request(request_pk: int) -> bool:
    """Atomically claim, execute, and persist one request. Serialize per task."""
    with SessionLocal() as db:
        candidate = db.get(AgentDraftRequest, request_pk)
        if candidate is None or candidate.status != "queued":
            return False
        task_id = candidate.task_id
        # Acquire a write lock on the task before checking other requests. The no-op
        # update serializes claims on SQLite; databases with row locks serialize too.
        db.execute(update(Task).where(Task.id == task_id).values(status=Task.status))
        active = db.scalar(select(AgentDraftRequest.id).where(
            AgentDraftRequest.task_id == task_id,
            AgentDraftRequest.status == "running").limit(1))
        earlier = db.scalar(select(AgentDraftRequest.id).where(
            AgentDraftRequest.task_id == task_id,
            AgentDraftRequest.status == "queued",
            AgentDraftRequest.id < request_pk).limit(1))
        if active is not None or earlier is not None:
            db.rollback()
            return False
        claimed = db.execute(update(AgentDraftRequest).where(
            AgentDraftRequest.id == request_pk,
            AgentDraftRequest.status == "queued").values(
                status="running", updated_at=utcnow(),
                attempts=AgentDraftRequest.attempts + 1))
        if claimed.rowcount != 1:
            db.rollback()
            return False
        db.commit()

        job = db.get(AgentDraftRequest, request_pk)
        task = db.get(Task, job.task_id) if job else None
        account = db.get(Account, job.account_id) if job else None
        attempt = job.attempts if job is not None else 0
        try:
            if job is None or task is None or account is None or task.created_by != account.id:
                raise AgentRequestError("找不到这次需求处理记录；请刷新后重试")
            payload = json.loads(job.payload_json)
            response = _execute_request(db, job, task, payload)
            completed = db.execute(update(AgentDraftRequest).where(
                AgentDraftRequest.id == request_pk,
                AgentDraftRequest.status == "running",
                AgentDraftRequest.attempts == attempt).values(
                    result_json=json.dumps(response, ensure_ascii=False),
                    status="completed", error="", updated_at=utcnow()))
            if completed.rowcount != 1:
                # A recovered/retried attempt owns this request now. Drop this stale
                # transaction, including any blueprint row it created.
                db.rollback()
                return True
            db.commit()
        except Exception as exc:  # noqa: BLE001 - durable failure, do not invent a draft
            db.rollback()
            failed = db.execute(update(AgentDraftRequest).where(
                AgentDraftRequest.id == request_pk,
                AgentDraftRequest.status == "running",
                AgentDraftRequest.attempts == attempt).values(
                    status="failed", error=_safe_error(exc), updated_at=utcnow()))
            if failed.rowcount:
                db.commit()
            else:
                db.rollback()
        return True


def drain_task_queue(task_id: int, limit: int = 64) -> int:
    """Process queued requests in order; concurrent submitters share one task lane."""
    processed = 0
    for _ in range(limit):
        with SessionLocal() as db:
            request_pk = db.scalar(select(AgentDraftRequest.id).where(
                AgentDraftRequest.task_id == task_id,
                AgentDraftRequest.status == "queued").order_by(AgentDraftRequest.id).limit(1))
        if request_pk is None or not process_request(request_pk):
            break
        processed += 1
    return processed


def _safe_error(exc: Exception) -> str:
    if isinstance(exc, task_service.TaskNotWritable):
        return str(exc)[:300]
    if isinstance(exc, AgentRequestError):
        return str(exc)[:300]
    return f"{type(exc).__name__}：这次请求没有完成，原草案仍保留。请重试或稍后再试。"


def requeue_stale_requests(db: Session) -> int:
    """Return requests left running by a crashed worker to the queue after a generous lease."""
    cutoff = utcnow() - RUNNING_LEASE
    stuck = db.scalars(select(AgentDraftRequest).where(
        AgentDraftRequest.status == "running",
        AgentDraftRequest.updated_at < cutoff)).all()
    for job in stuck:
        job.status = "queued"
        job.error = ""
        job.updated_at = utcnow()
    db.flush()
    return len(stuck)


def run_task_queues_once(db: Session, limit_tasks: int = 1) -> int:
    task_ids = list(db.scalars(select(AgentDraftRequest.task_id).where(
        AgentDraftRequest.status == "queued").group_by(AgentDraftRequest.task_id)
        .order_by(AgentDraftRequest.task_id).limit(limit_tasks)).all())
    db.rollback()  # release the read transaction before per-task workers acquire write locks
    return sum(drain_task_queue(task_id) for task_id in task_ids)
