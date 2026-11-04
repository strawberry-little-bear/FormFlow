"""Shared interpretation of manual decisions; original machine facts stay immutable."""
from sqlalchemy import select
from ..models import ManualDecision
from ..security import utcnow
from ..timeutils import as_utc

RULE_DECISIONS = {"confirm_issue", "confirm_pass", "correct_false_positive", "approve_exception"}
PASS_DECISIONS = RULE_DECISIONS - {"confirm_issue"}


def effective_rules(decisions):
    """Last currently effective choice per rule wins; unrelated decisions never resolve it."""
    return {d.scope_rule_id: d for d in decisions
            if d.scope_rule_id and d.decision in RULE_DECISIONS}


def valid_acceptance(db, task, subject_id, revision_id, blockers, run=None):
    if blockers:
        return False
    rows = db.scalars(select(ManualDecision).where(
        ManualDecision.task_id == task.id, ManualDecision.subject_id == subject_id,
        ManualDecision.revision_id == revision_id).order_by(ManualDecision.id)).all()
    acceptances = [d for d in rows if d.decision == "accept_current"]
    if not acceptances:
        return False
    accepted = acceptances[-1]  # Revoking the latest acceptance never revives an older one.
    if accepted.revoked or (accepted.expires_at and as_utc(accepted.expires_at) <= utcnow()):
        return False
    if run is not None and as_utc(run.created_at) > as_utc(accepted.created_at):
        return False
    qualification_ids = {d.id for d in rows if d.decision == "eligibility"}
    return not any(d.id > accepted.id and (
        d.decision in RULE_DECISIONS or d.decision == "eligibility"
        or (d.decision == "revoke" and (d.scope_rule_id or (
            d.revokes_decision_id in qualification_ids))))
        for d in rows)
