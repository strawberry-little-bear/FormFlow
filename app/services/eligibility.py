"""Evidence of a human eligibility decision, separate from material checks and acceptance."""
import hashlib
import json
from sqlalchemy import select
from ..models import BlueprintVersion, ManualDecision, Member
from ..schemas import Blueprint
from ..security import utcnow
from ..timeutils import as_utc, iso_utc


def members_hash(db, subject):
    rows = db.scalars(select(Member).where(Member.subject_id == subject.id).order_by(Member.id)).all()
    payload = {"kind": subject.kind, "members": [
        {"id": m.id, "name": m.name, "extra": m.extra_json or "{}"} for m in rows]}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def eligibility_view(db, task, subject, revision_id=None, blueprint_version_id=None):
    bp = db.get(BlueprintVersion, blueprint_version_id or task.current_blueprint_id) if (
        blueprint_version_id or task.current_blueprint_id) else None
    required = Blueprint.model_validate_json(bp.blueprint_json).eligibility_required if bp else False
    latest = db.scalar(select(ManualDecision).where(
        ManualDecision.task_id == task.id, ManualDecision.subject_id == subject.id,
        ManualDecision.decision == "eligibility").order_by(ManualDecision.id.desc()))
    signature = members_hash(db, subject)
    names = list(db.scalars(select(Member.name).where(Member.subject_id == subject.id).order_by(Member.id)))
    base = {"effective": False, "members_hash": signature, "members": names, "required": required, "status": "not_assessed", "decision_id": None,
            "reason": "", "status_reason": "尚未进行人工资格核实", "expires_at": None}
    if latest is None:
        if subject.eligibility != "not_assessed":
            base.update(status="pending", status_reason="旧资格标记缺少可追溯决定，请重新核实")
        return base
    base.update(decision_id=latest.id, reason=latest.reason, expires_at=iso_utc(latest.expires_at))
    reason = None
    if latest.revoked:
        reason = "最新资格决定已撤销，请重新核实"
    elif latest.expires_at and as_utc(latest.expires_at) <= utcnow():
        reason = "最新资格决定已到期，请重新核实"
    elif latest.eligibility not in {"eligible", "ineligible", "pending"} or not latest.eligibility_members_hash:
        reason = "旧资格决定未保存明确结论与成员范围，请重新核实"
    elif latest.revision_id != revision_id:
        reason = "正式版本已变化，请基于当前版本重新核实资格"
    elif latest.eligibility_members_hash != signature:
        reason = "登记成员已变化，请重新核实资格"
    if reason:
        base.update(status="pending", status_reason=reason)
    else:
        base.update(effective=True, status=latest.eligibility, status_reason="人工资格决定在当前范围内有效")
    return base
