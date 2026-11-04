"""Opaque scope for local review notes and optimistic review submissions."""
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import CheckRun, Member, RUN_SUPERSEDED, Subject, Submission, Task


def review_context(db: Session, task: Task, subject: Subject, account_id: int) -> str:
    # Read columns, not cached ORM objects: a roster edit in another request must
    # invalidate a review even when the formal revision has not changed.
    subject_data = db.execute(select(Subject.kind, Subject.display_name).where(Subject.id == subject.id)).one()
    blueprint = db.scalar(select(Task.current_blueprint_id).where(Task.id == task.id))
    revision = db.scalar(select(Submission.current_revision_id).where(
        Submission.task_id == task.id, Submission.subject_id == subject.id))
    run = db.execute(select(CheckRun.id, CheckRun.status).where(
        CheckRun.revision_id == revision, CheckRun.status != RUN_SUPERSEDED
    ).order_by(CheckRun.id.desc()).limit(1)).first() if revision else None
    members = db.execute(select(Member.id, Member.name, Member.extra_json).where(
        Member.subject_id == subject.id).order_by(Member.id)).all()
    payload = [account_id, task.id, subject.id, list(subject_data), blueprint,
               revision, list(run) if run else None, [list(m) for m in members]]
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False,
                                    separators=(",", ":")).encode()).hexdigest()
