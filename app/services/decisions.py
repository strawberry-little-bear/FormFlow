"""服务层：人工复核、申诉与验收（第 10 节）。

- 理由为空不允许产生决定。
- 决定带作用域（规则或资格），默认不扩大到未来版本。
- 撤销是追加反向记录，不删除历史。
- 验收必须单独确认依据，不能一次点击静默豁免全部未知项。
"""
from __future__ import annotations

import json
from datetime import datetime
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..models import (
    DECISION_ACCEPT_CURRENT,
    BlueprintVersion,
    CheckRun,
    DECISION_APPROVE_EXCEPTION,
    DECISION_CONFIRM_ISSUE,
    DECISION_CORRECT_FALSE_POSITIVE,
    DECISION_ELIGIBILITY,
    DECISION_EXEMPT,
    DECISION_REVOKE,
    ELIG_ELIGIBLE,
    ELIG_PENDING,
    RESULT_ISSUE,
    RESULT_UNKNOWN,
    RUN_SUPERSEDED,
    Exemption,
    ManualDecision,
    Revision,
    RuleResult,
    Subject,
    Submission,
    Task,
)
from ..schemas import Blueprint
from ..security import utcnow
from ..timeutils import as_utc
from . import tasks as task_service

VALID_DECISIONS = {
    DECISION_CONFIRM_ISSUE, DECISION_CORRECT_FALSE_POSITIVE, DECISION_APPROVE_EXCEPTION,
    DECISION_EXEMPT, DECISION_ELIGIBILITY, DECISION_REVOKE, DECISION_ACCEPT_CURRENT,
}


class DecisionError(Exception):
    pass


class DecisionConflict(DecisionError):
    """The operator is looking at a stale revision."""


def record_decision(db: Session, task: Task, subject: Subject, *, decision: str,
                    reason: str, operator_id: Optional[int] = None,
                    scope_rule_id: str = "", revision_id: Optional[int] = None,
                    expected_current_revision: Optional[int] = None,
                    expires_at: Optional[datetime] = None,
                    eligibility: Optional[str] = None) -> ManualDecision:
    if decision not in VALID_DECISIONS:
        raise DecisionError(f"未知决定类型 {decision}")
    if not reason or not reason.strip():
        raise DecisionError("理由不能为空")
    if decision == DECISION_ELIGIBILITY and eligibility not in {ELIG_ELIGIBLE, "ineligible", ELIG_PENDING}:
        raise DecisionError("资格决定必须给出明确结论")

    if subject.task_id != task.id:
        raise DecisionError("主体不属于该任务")
    expires_at = as_utc(expires_at, task.timezone)
    if expires_at is not None and expires_at <= utcnow():
        raise DecisionError("过期时间必须晚于当前时间")
    if decision == DECISION_EXEMPT and scope_rule_id:
        raise DecisionError("免交作用于整个主体，不能限定单条规则")

    # Acquire the SQLite writer lock before reading the pointer. A competing
    # formal submission cannot change it between this check and our commit.
    if expected_current_revision is not None:
        db.execute(update(Subject).where(Subject.id == subject.id).values(
            eligibility=Subject.eligibility))
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject.id
    ).execution_options(populate_existing=True))
    current_rev = submission.current_revision_id if submission else None
    if expected_current_revision is not None and expected_current_revision != (current_rev or 0):
        raise DecisionConflict(f"当前版本已变化（预期 {expected_current_revision}，实际 {current_rev or 0}），决定未保存，请刷新后重新核对")
    if revision_id is not None and revision_id != current_rev:
        raise DecisionConflict("决定只能作用于已核对的当前版本，请刷新后重新核对")

    if decision == DECISION_ACCEPT_CURRENT:
        problems = _acceptance_blockers(db, task, subject)
        if problems:
            raise DecisionError("验收前检查未通过：" + "；".join(problems))

    d = ManualDecision(
        task_id=task.id, subject_id=subject.id, revision_id=None if decision == DECISION_EXEMPT else (revision_id or current_rev),
        decision=decision, scope_rule_id=scope_rule_id, operator_id=operator_id,
        reason=reason.strip(), expires_at=expires_at,
    )
    db.add(d)
    db.flush()

    if decision == DECISION_EXEMPT:
        db.add(Exemption(task_id=task.id, subject_id=subject.id, kind="exempt",
                         status="active", reason=reason.strip(), decided_by=operator_id, decision_id=d.id))
    if decision == DECISION_ELIGIBILITY and eligibility:
        subject.eligibility = eligibility
    task_service.audit(db, f"decision.{decision}", "subject",
                       {"subject_id": subject.id, "scope": scope_rule_id, "reason": reason},
                       task.id)
    return d


def revoke_decision(db: Session, task: Task, decision_id: int, reason: str,
                    operator_id: Optional[int] = None) -> ManualDecision:
    """撤销：追加反向记录，重新推导摘要，不删除历史。"""
    d = db.get(ManualDecision, decision_id)
    if d is None or d.task_id != task.id:
        raise DecisionError("决定不存在")
    if d.revoked:
        raise DecisionError("该决定已撤销")
    if not reason.strip():
        raise DecisionError("撤销理由不能为空")
    if d.decision == DECISION_REVOKE:
        raise DecisionError("撤销记录不能再次撤销，请重新作出决定")
    d.revoked = True
    if d.decision == DECISION_EXEMPT:
        for exemption in db.scalars(select(Exemption).where(Exemption.decision_id == d.id)):
            exemption.status = "revoked"
    db.flush()
    rev = ManualDecision(
        task_id=task.id, subject_id=d.subject_id, revision_id=d.revision_id,
        decision=DECISION_REVOKE, scope_rule_id=d.scope_rule_id,
        operator_id=operator_id, reason=reason.strip())
    db.add(rev)
    db.flush()
    task_service.audit(db, "decision.revoke", "decision",
                       {"revoked_id": decision_id, "reason": reason}, task.id)
    return rev


def _acceptance_blockers(db: Session, task: Task, subject: Subject) -> list[str]:
    """验收前检查（第 10 节）。"""
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject.id))
    if submission is None or submission.current_revision_id is None:
        return ["没有正式提交版本"]
    rev = db.get(Revision, submission.current_revision_id)
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == rev.id,
        CheckRun.status.not_in([RUN_SUPERSEDED])).order_by(CheckRun.id.desc()))
    if run is None or run.status != "success":
        return ["当前版本没有已完成的检查运行"]
    from .checks import _active_decisions
    decided = {d.scope_rule_id for d in _active_decisions(db, task.id, subject.id, rev.id)
               if d.scope_rule_id}
    problems = []
    for r in db.scalars(select(RuleResult).where(RuleResult.run_id == run.id)).all():
        if r.rule_id in decided:
            continue
        if r.result == RESULT_ISSUE:
            problems.append(f"规则 {r.rule_id} 存在未解决阻塞")
        elif r.result == RESULT_UNKNOWN:
            problems.append(f"规则 {r.rule_id} 为 unknown，需人工处置后才能验收")
        elif r.result == "failed":
            problems.append(f"规则 {r.rule_id} 检查技术失败，需重试或转人工")
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    human_rules = [r.id for r in blueprint.rules if r.executor.value == "human_only"]
    for rid in human_rules:
        if rid not in decided:
            problems.append(f"人工项 {rid} 尚未处置")
    if blueprint.eligibility_required:
        if getattr(subject, "eligibility", "not_assessed") in ("not_assessed", "pending"):
            problems.append("资格前提未明确（资格不能被材料通过自动推导）")
    return problems
