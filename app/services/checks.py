"""服务层：检查运行、规则结果与当前检查摘要（第 7 节）。

摘要优先级：
未解决阻塞 → 待补正；
否则有 unknown / 人工项 / 失败且无可执行作业 → 待人工 / 检查未完成；
否则有有效作业 → 待检、检查中或重试；
全部适用项满足、不适用或已被有效人工处置 → 规则通过。
"""
from __future__ import annotations

import inspect
import json
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..agents.review_agent import CheckContext, FileInfo, run_checks
from ..llm import get_client
from . import appeals
from ..models import (
    ACCEPTANCE_ACCEPTED,
    ACCEPTANCE_NOT_ACCEPTED,
    ACCEPTANCE_PENDING,
    RESULT_FAILED,
    RESULT_ISSUE,
    RESULT_NOT_APPLICABLE,
    RESULT_SATISFIED,
    RESULT_UNKNOWN,
    RUN_FAILED,
    RUN_QUEUED,
    RUN_RETRY_WAIT,
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
from . import tasks as task_service
from .decision_state import effective_rules, PASS_DECISIONS, RULE_DECISIONS, valid_acceptance
from .eligibility import eligibility_view


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
    task_service.ensure_task_writable(task)  # V24 readonly guard
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


def _history_issues(db: Session, run: CheckRun) -> list[str]:
    """历史阻塞问题（本次运行之前）：补正与重试时不从零开始。

    范围：同一主体更早的正式版本（否则新版本看不到上一轮的问题），
    以及本版本之前的运行（重试时保留上一次结论）。
    """
    rev = db.get(Revision, run.revision_id)
    if rev is None:
        return []
    older = db.scalars(select(Revision).where(
        Revision.submission_id == rev.submission_id,
        Revision.version < rev.version)).all()
    run_ids = [r.id for r in older]
    same_rev = db.scalars(select(CheckRun).where(
        CheckRun.revision_id == rev.id, CheckRun.id != run.id)).all()
    run_ids += [r.id for r in same_rev]
    if not run_ids:
        return []
    out: list[str] = []
    runs = db.scalars(select(CheckRun).where(
        CheckRun.id.in_(run_ids)).order_by(CheckRun.id)).all()
    for old in runs:
        for r in db.scalars(select(RuleResult).where(
                RuleResult.run_id == old.id,
                RuleResult.result == RESULT_ISSUE).order_by(RuleResult.id)).all():
            out.append(f"{r.rule_id}：{r.explanation}")
    return out[-10:]


def _execute_check_pipeline(db: Session, run: CheckRun, client=None) -> CheckRun:
    """执行检查：先程序校验，再 Agent 语义调查；结果与证据落库。

    client 可注入（测试/演示用脚本化桩）；默认走真实网关。
    """
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
    task = db.get(Task, run.task_id)
    # 第 10 节：补正时让模型看到历史问题与提交者解释，
    # 不从零重新推理，也不把解释当成结论。
    ctx = CheckContext(blueprint=blueprint, fields=fields, members=members, files=files,
                       history_issues=_history_issues(db, run),
                       submitter_explanation=appeals.latest_explanation(
                           db, task, subject.id) if subject else "")
    from ..agents.tooling import build_review_skill, invoke_review_rule

    skill, tool_context = build_review_skill(
        ctx, client=client or get_client(), db=db, task_id=run.task_id,
        subject_id=subject.id, run_id=run.id)
    tool_executor = lambda rule: invoke_review_rule(
        skill, tool_context, db, executor=rule.executor.value, rule_id=rule.id,
        idempotency_key=f"review:{run.id}:{rule.id}")
    # Keep the injectable run_checks seam compatible with test/diagnostic wrappers
    # that deliberately expose only the historical (ctx, client) signature.
    if "tool_executor" in inspect.signature(run_checks).parameters:
        outcome = run_checks(ctx, client, tool_executor=tool_executor)
    else:
        outcome = run_checks(ctx, client)

    run.llm_calls_used = outcome.llm_calls_used
    run.pages_read = outcome.pages_read
    run.budget_exhausted = outcome.budget_exhausted
    # V08：覆盖缺口落库（未读/失败页），复核页与提交者均可见
    run.coverage_json = json.dumps(outcome.coverage, ensure_ascii=False)
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


def execute_run(db: Session, run: CheckRun, client=None) -> CheckRun:
    """执行检查（V20）：未预期异常不向上抛，运行标记 failed 并记录原因，可重试。"""
    try:
        return _execute_check_pipeline(db, run, client)
    except Exception as e:  # 未预期故障：标记失败并可重试（表 6：模型/OCR 故障可重试）
        run.status = RUN_FAILED
        run.error = f"{type(e).__name__}: {e}"
        db.flush()
        task_service.audit(db, "check.failed", "check_run",
                           {"run_id": run.id, "error": run.error}, run.task_id)
        return run


def retry_run(db: Session, run: CheckRun) -> CheckRun:
    """重试一次检查（V20 / 表 6：模型或 OCR 故障可重试，转人工由组织者决定）。

    - 仅「失败」或「成功但含失败规则结果」的运行可重试；进行中的运行不可重试；
    - 旧运行标记为被取代：历史运行、结果与证据全部保留，不篡改；
    - 为同一正式版本创建新运行并返回（queued），由调用方执行或交由 Worker。
    """
    if run.status == RUN_SUPERSEDED:
        raise ValueError("该运行已被取代，请对当前版本发起检查")
    if run.status in (RUN_QUEUED, RUN_RUNNING, RUN_RETRY_WAIT):
        raise ValueError("检查正在进行中，暂不能重试")
    task = db.get(Task, run.task_id)
    task_service.ensure_task_writable(task)  # V24：只读任务不允许重试
    has_failed = db.scalar(select(RuleResult).where(
        RuleResult.run_id == run.id, RuleResult.result == RESULT_FAILED)) is not None
    if run.status == RUN_SUCCESS and not has_failed:
        raise ValueError("该运行已成功完成，无需重试")
    revision = db.get(Revision, run.revision_id)
    old_status = run.status
    run.status = RUN_SUPERSEDED
    db.flush()
    new_run = create_run(db, task, revision)
    task_service.audit(db, "check.retry", "check_run",
                       {"from_run": run.id, "from_status": old_status,
                        "new_run": new_run.id, "revision": revision.version},
                       task.id)
    return new_run


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
    ).order_by(ManualDecision.id)).all()
    from ..security import utcnow

    now = utcnow()
    out = []
    for d in rows:
        if d.decision == "revoke":
            continue
        if d.expires_at is not None:
            exp = d.expires_at if d.expires_at.tzinfo else d.expires_at.replace(tzinfo=now.tzinfo)
            if exp <= now:
                continue
        if d.decision in RULE_DECISIONS and d.revision_id != revision_id:
            continue
        # 默认不扩大到未来版本：决定必须绑定当前 revision 或为名单级（无 revision）
        if d.revision_id is not None and d.revision_id != revision_id:
            continue
        out.append(d)
    return out


def run_coverage(run: Optional[CheckRun]) -> dict:
    """V08 覆盖缺口视图：按文件给出总页/已读/未读/失败与提取方式。

    未读/失败页存在时 complete=False：语义结论只能 unknown，
    不得把“没读到”写成“确认缺失”。
    """
    empty = {"files": [], "unread_pages": 0, "failed_pages": 0, "complete": True}
    if run is None or not run.coverage_json:
        return empty
    try:
        raw = json.loads(run.coverage_json)
    except Exception:
        return empty
    if not isinstance(raw, dict):
        return empty
    files = [{"file_id": fid, **cov} for fid, cov in sorted(raw.items())]
    unread = sum(int(c.get("unread", 0) or 0) for c in files)
    failed = sum(int(c.get("failed", 0) or 0) for c in files)
    return {"files": files, "unread_pages": unread, "failed_pages": failed,
            "complete": unread == 0 and failed == 0}


def _latest_run(db: Session, submission: Optional[Submission]) -> Optional[CheckRun]:
    """主体当前版本对应的最新非被取代运行。"""
    if submission is None or submission.current_revision_id is None:
        return None
    return db.scalar(select(CheckRun).where(
        CheckRun.revision_id == submission.current_revision_id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))


def rule_details(db: Session, run: Optional[CheckRun]) -> list[dict]:
    """规则明细：哪里有问题、怎么改、引用证据。

    P03 证据复核与 P04 提交者自查共用同一份事实，避免两端说法不一致。
    """
    if run is None:
        return []
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    rules_meta: dict = {}
    if bp is not None:
        blueprint = Blueprint.model_validate_json(bp.blueprint_json)
        rules_meta = {r.id: r.model_dump() for r in blueprint.rules}
    out = []
    for r in db.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all():
        evs = [{"file_id": e.file_id, "locator": e.locator, "quote": e.quote,
                "method": e.method, "method_version": e.method_version}
               for e in db.scalars(select(Evidence).where(
                   Evidence.rule_result_id == r.id)).all()]
        out.append({
            "rule_id": r.rule_id, "result": r.result, "severity": r.severity,
            "explanation": r.explanation, "next_step": r.next_step,
            "requirement": rules_meta.get(r.rule_id, {}),
            "evidence": evs,
        })
    return out


def review_rule_details(db: Session, run: Optional[CheckRun], task: Task,
                        subject_id: int, revision_id: int) -> list[dict]:
    """Organizer review includes human-only tasks, without inventing machine results."""
    rows = rule_details(db, run)
    if run is None:
        return rows
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    present = {r["rule_id"] for r in rows}
    for rule in blueprint.rules:
        if rule.executor.value == "human_only" and rule.id not in present:
            rows.append({"rule_id": rule.id, "result": "manual_pending",
                         "severity": rule.severity, "requirement": rule.model_dump(),
                         "explanation": "此项须由组织者人工核对，系统不生成机器结论。",
                         "next_step": "核对材料后，记录本项决定与理由。", "evidence": []})
    effects = effective_rules(_active_decisions(db, task.id, subject_id, revision_id))
    for row in rows:
        d = effects.get(row["rule_id"])
        row["decision"] = ({"id": d.id, "decision": d.decision, "reason": d.reason,
                            "resolves": d.decision in PASS_DECISIONS} if d else None)
    return rows


def current_details(db: Session, task: Task, subject_id: int) -> list[dict]:
    """提交者视角的规则明细：哪里有问题、怎么改、引用证据、剩余待办。"""
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject_id))
    if submission is None or submission.current_revision_id is None:
        return []
    return review_rule_details(db, _latest_run(db, submission), task, subject_id,
                               submission.current_revision_id)


def current_summary(db: Session, task: Task, subject_id: int) -> dict:
    """主摘要与可重叠待办（第 7 节）。"""
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject_id))
    qualification = eligibility_view(db, task, db.get(Subject, subject_id),
                                     submission.current_revision_id if submission else None)
    if submission is None or submission.current_revision_id is None:
        return {"eligibility": qualification, "summary": "未正式提交", "acceptance": ACCEPTANCE_PENDING,
                "coverage": run_coverage(None),
                "buckets": {"blocking": [], "unknown": [],
                            "human": [], "incomplete": [], "pending_jobs": []}}
    revision = db.get(Revision, submission.current_revision_id)
    run = _latest_run(db, submission)
    if run is None:
        return {"eligibility": qualification, "summary": "排队中", "acceptance": ACCEPTANCE_PENDING,
                "coverage": run_coverage(None),
                "buckets": {"pending_jobs": ["排队中"]}}
    decisions = _active_decisions(db, task.id, subject_id, revision.id)
    effects = effective_rules(decisions)
    results = db.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all()

    blocking = [rid for rid, d in effects.items() if d.decision == "confirm_issue"]
    unknown, incomplete, human, jobs = [], [], [], []
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    human_rules = [r.id for r in blueprint.rules if r.executor.value == "human_only"]
    qualification = eligibility_view(db, task, db.get(Subject, subject_id), revision.id, run.blueprint_version_id)

    for r in results:
        if r.rule_id in effects:
            continue
        if r.result == RESULT_ISSUE:
            blocking.append(r.rule_id)
        elif r.result == RESULT_UNKNOWN:
            unknown.append(r.rule_id)
        elif r.result == RESULT_FAILED:
            incomplete.append(r.rule_id)
    if run.status in (RUN_QUEUED, RUN_RUNNING, "retry_wait"):
        jobs.append(run.status)
    human = [rid for rid in human_rules if rid not in effects]

    from .decisions import _acceptance_blockers
    blockers = _acceptance_blockers(db, task, db.get(Subject, subject_id))
    accepted = valid_acceptance(db, task, subject_id, revision.id, blockers, run)
    if accepted:
        # accept_current 只对记录时指向的版本有效；新提交派生新版本后回到待验收
        summary, acceptance = "已验收", ACCEPTANCE_ACCEPTED
    elif blocking:
        summary, acceptance = "待补正", ACCEPTANCE_NOT_ACCEPTED
    elif unknown or human:
        summary, acceptance = "待人工", ACCEPTANCE_PENDING
    elif incomplete and not jobs:
        summary, acceptance = "检查未完成", ACCEPTANCE_PENDING
    elif run.status == RUN_FAILED:
        # 运行自身失败且没有可信结果：按检查未完成处理（可重试或转人工）
        summary, acceptance = "检查未完成", ACCEPTANCE_PENDING
    elif jobs:
        summary, acceptance = "检查中", ACCEPTANCE_PENDING
    else:
        summary = "规则通过（待人工验收）" if blueprint.manual_acceptance else "规则通过"
        acceptance = ACCEPTANCE_PENDING
    return {
        "eligibility": qualification,
        "summary": summary,
        "acceptance": acceptance,
        "revision": revision.version,
        "run_status": run.status,
        "coverage": run_coverage(run),
        "buckets": {"blocking": blocking, "unknown": unknown, "human": human,
                    "incomplete": incomplete, "pending_jobs": jobs},
    }
