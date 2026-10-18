"""服务层：检查运行、规则结果与当前检查摘要（第 7 节）。

摘要优先级：
未解决阻塞 → 待补正；
否则有 unknown / 人工项 / 失败且无可执行作业 → 待人工 / 检查未完成；
否则有有效作业 → 待检、检查中或重试；
全部适用项满足、不适用或已被有效人工处置 → 规则通过。
"""
from __future__ import annotations

import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.review_agent import CheckContext, FileInfo, run_checks
from ..models import (
    RESULT_FAILED,
    RESULT_ISSUE,
    RESULT_NOT_APPLICABLE,
    RESULT_SATISFIED,
    RESULT_UNKNOWN,
    RUN_QUEUED,
    RUN_RUNNING,
    RUN_SUCCESS,
    RUN_SUPERSEDED,
    BlueprintVersion,
    CheckRun,
    Evidence,
    FileObject,
    ManualDecision,
    Revision,
    RuleResult,
    Subject,
    Submission,
    Task,
)
from ..parsing import ParseError, parse_file
from ..schemas import Blueprint
from .. import storage


def _load_files(db: Session, revision: Revision) -> list[FileInfo]:
    slot_map: dict[str, list[str]] = json.loads(revision.slot_file_ids_json)
    infos: list[FileInfo] = []
    for slot, fids in slot_map.items():
        for fid in fids:
            fo = db.scalar(select(FileObject).where(FileObject.file_id == fid))
            if fo is None:
                continue
            info = FileInfo(file_id=fo.file_id, slot=slot, original_name=fo.original_name,
                            size=fo.size)
            path = storage.file_dir(fo.file_id) / f"original_{fo.safe_name}"
            try:
                info.parse = parse_file(path)
                fo.status = "ready"
            except ParseError as e:
                fo.status = "failed"
                fo.parse_error = str(e)
                info.parse_error = str(e)
            infos.append(info)
    db.flush()
    return infos


def create_run(db: Session, task: Task, revision: Revision) -> CheckRun:
    """为当前正式版本创建检查运行；同一版本旧运行标记为被取代。"""
    if task.current_blueprint_id is None:
        raise ValueError("任务尚未发布蓝图")
    old_runs = db.scalars(select(CheckRun).where(
        CheckRun.revision_id == revision.id,
        CheckRun.status.not_in([RUN_SUPERSEDED, "failed"]),
    )).all()
    for r in old_runs:
        r.status = RUN_SUPERSEDED
    run = CheckRun(task_id=task.id, revision_id=revision.id,
                   blueprint_version_id=task.current_blueprint_id, status=RUN_QUEUED)
    db.add(run)
    db.flush()
    return run


def execute_run(db: Session, run: CheckRun) -> CheckRun:
    """执行检查：先程序校验，再 Agent 语义调查；结果与证据落库。"""
    run.status = RUN_RUNNING
    db.flush()
    revision = db.get(Revision, run.revision_id)
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    fields = json.loads(revision.fields_json)
    submission = db.get(Submission, revision.submission_id)
    subject = db.get(Subject, submission.subject_id)
    members = [m.name for m in subject.members] if subject else []

    files = _load_files(db, revision)
    ctx = CheckContext(blueprint=blueprint, fields=fields, members=members, files=files)
    outcome = run_checks(ctx)

    run.llm_calls_used = outcome.llm_calls_used
    run.pages_read = outcome.pages_read
    run.budget_exhausted = outcome.budget_exhausted
    for r in outcome.results:
        rr = RuleResult(run_id=run.id, rule_id=r.rule_id, result=r.result,
                        severity=_severity_of(blueprint, r.rule_id),
                        explanation=r.explanation, next_step=r.next_step)
        db.add(rr)
        db.flush()
        for ev in r.evidence:
            db.add(Evidence(rule_result_id=rr.id, file_id=ev.file_id, locator=ev.locator,
                            quote=ev.quote, method=ev.method, method_version="v0.1"))
    run.status = RUN_SUCCESS
    db.flush()
    return run


def _severity_of(blueprint: Blueprint, rule_id: str) -> str:
    for r in blueprint.rules:
        if r.id == rule_id:
            return r.severity
    return "blocking"


def _active_decisions(db: Session, task_id: int, subject_id: int,
                      revision_id: int) -> list[ManualDecision]:
    """有效人工决定：未撤销、未过期、且作用域覆盖当前版本。"""
    rows = db.scalars(select(ManualDecision).where(
        ManualDecision.task_id == task_id,
        ManualDecision.subject_id == subject_id,
        ManualDecision.revoked == False,  # noqa: E712
    )).all()
    from ..security import utcnow

    now = utcnow()
    out = []
    for d in rows:
        if d.expires_at is not None:
            exp = d.expires_at if d.expires_at.tzinfo else d.expires_at.replace(tzinfo=now.tzinfo)
            if exp < now:
                continue
        # 默认不扩大到未来版本：决定必须绑定当前 revision 或为名单级（无 revision）
        if d.revision_id is not None and d.revision_id != revision_id:
            continue
        out.append(d)
    return out


def current_summary(db: Session, task: Task, subject_id: int) -> dict:
    """主摘要与可重叠待办（第 7 节）。"""
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject_id))
    if submission is None or submission.current_revision_id is None:
        return {"summary": "未正式提交", "buckets": {"blocking": [], "unknown": [],
                "human": [], "incomplete": [], "pending_jobs": []}}
    revision = db.get(Revision, submission.current_revision_id)
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == revision.id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))
    if run is None:
        return {"summary": "待检", "buckets": {"pending_jobs": ["排队中"]}}
    decisions = _active_decisions(db, task.id, subject_id, revision.id)
    decided_rules = {d.scope_rule_id for d in decisions if d.scope_rule_id}
    results = db.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all()

    blocking, unknown, incomplete, human, jobs = [], [], [], [], []
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    human_rules = [r.id for r in blueprint.rules if r.executor.value == "human_only"]

    for r in results:
        if r.rule_id in decided_rules:
            continue
        if r.result == RESULT_ISSUE:
            blocking.append(r.rule_id)
        elif r.result == RESULT_UNKNOWN:
            unknown.append(r.rule_id)
        elif r.result == RESULT_FAILED:
            incomplete.append(r.rule_id)
    if run.status in (RUN_QUEUED, RUN_RUNNING, "retry_wait"):
        jobs.append(run.status)
    human = [rid for rid in human_rules if rid not in decided_rules]

    if blocking:
        summary = "待补正"
    elif unknown or human:
        summary = "待人工"
    elif incomplete and not jobs:
        summary = "检查未完成"
    elif jobs:
        summary = "检查中"
    else:
        summary = "规则通过（待人工验收）" if blueprint.manual_acceptance else "规则通过"
    return {
        "summary": summary,
        "revision": revision.version,
        "run_status": run.status,
        "buckets": {"blocking": blocking, "unknown": unknown, "human": human,
                    "incomplete": incomplete, "pending_jobs": jobs},
    }
