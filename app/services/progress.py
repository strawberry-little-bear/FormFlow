"""Roster denominators and subject state are separate from check/acceptance state."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..models import Exemption, ManualDecision, Revision, RosterEntry, Submission, Subject, Task
from ..security import utcnow
from ..timeutils import as_utc
from .checks import current_summary


def exempt_subject_ids(db: Session, task: Task) -> set[int]:
    now = utcnow()
    rows = db.execute(select(Exemption, ManualDecision).outerjoin(
        ManualDecision, ManualDecision.id == Exemption.decision_id).where(
        Exemption.task_id == task.id, Exemption.kind == "exempt", Exemption.status == "active"))
    return {e.subject_id for e, d in rows if e.decision_id is None or (
        d is not None and d.task_id == e.task_id and d.subject_id == e.subject_id
        and d.decision == "exempt" and not d.revoked
        and (d.expires_at is None or as_utc(d.expires_at) > now))}


def workbench_data(db: Session, task: Task) -> dict:
    exempt = exempt_subject_ids(db, task)
    formal_revisions = dict(db.execute(select(Submission.subject_id, Revision.version).join(
        Revision, Revision.id == Submission.current_revision_id).where(
        Submission.task_id == task.id, Submission.state == "formal")).all())
    formal = set(formal_revisions)
    entries = db.scalars(select(RosterEntry).where(RosterEntry.task_id == task.id)).all()
    linked = {e.subject_id for e in entries if e.subject_id is not None}
    subjects = db.scalars(select(Subject).where(Subject.task_id == task.id)).all()
    rows = []
    for subject in subjects:
        summary = current_summary(db, task, subject.id)
        rows.append({"subject_id": subject.id, "name": subject.display_name,
                     **summary, "revision": formal_revisions.get(subject.id),
                     "exempt": subject.id in exempt,
                     "formal": subject.id in formal,
                     "in_roster": subject.id in linked})
    if task.mode == "roster":
        for e in entries:
            if e.subject_id is None:
                rows.append({"subject_id": None, "roster_entry_id": e.id, "name": e.name,
                             "summary": "未发放凭证", "exempt": False, "formal": False,
                             "in_roster": True})
        required_entries = [e for e in entries if e.subject_id not in exempt]
        submitted = sum(e.subject_id in formal for e in required_entries)
        counts = {"roster": len(entries), "exempt": len(entries) - len(required_entries),
                  "required": len(required_entries), "submitted": submitted,
                  "unsubmitted": len(required_entries) - submitted}
    else:
        # Open enrollment has no required denominator or completion percentage.
        counts = {"registered": len(subjects), "submitted": len(formal)}
    counts["accepted"] = sum(r.get("acceptance") == "accepted" and not r["exempt"]
                             and (task.mode != "roster" or r["in_roster"]) for r in rows)
    return {"rows": rows, "counts": counts}
