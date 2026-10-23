"""Roster denominators and subject state are separate from check/acceptance state."""
from sqlalchemy import select
from sqlalchemy.orm import Session
from ..models import (CheckRun, DeliverySnapshot, Exemption, ExportJob,
                      ManualDecision, BlueprintVersion, Revision, RosterEntry,
                      Submission, Subject, Task, RUN_SUPERSEDED)
from ..security import utcnow
from ..timeutils import as_utc
from .checks import current_summary, review_rule_details, run_coverage
from .tasks import has_valid_grant


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
    if any(r.get("eligibility", {}).get("required") for r in rows):
        counts["eligibility_pending"] = sum(bool(r.get("eligibility", {}).get("required"))
            and r["eligibility"]["status"] in {"not_assessed", "pending"} and not r["exempt"]
            and (task.mode != "roster" or r["in_roster"]) for r in rows)
    return {"rows": rows, "counts": counts}


def _review_signal(db: Session, task: Task, subject_id: int | None) -> dict | None:
    """Expose a small, honest summary for the first-entry showcase route.

    The route must explain the real run without copying the review page or
    inventing an Agent trace. Detailed evidence and audited tool events remain
    behind the findings endpoint.
    """
    if not subject_id:
        return None
    submission = db.scalar(select(Submission).where(
        Submission.task_id == task.id, Submission.subject_id == subject_id))
    if submission is None or submission.current_revision_id is None:
        return None
    run = db.scalar(select(CheckRun).where(
        CheckRun.revision_id == submission.current_revision_id,
        CheckRun.status != RUN_SUPERSEDED).order_by(CheckRun.id.desc()))
    if run is None:
        return {"status": "queued", "run_id": None, "pages_read": 0,
                "llm_calls_used": 0, "rules_total": 0, "deterministic_rules": 0,
                "semantic_rules": 0, "human_rules": 0,
                "pending_rules": 0, "coverage_complete": True,
                "coverage_gaps": 0}
    subject = db.get(Subject, subject_id)
    rules = review_rule_details(db, run, task, subject_id,
                                submission.current_revision_id)
    pending = sum(1 for rule in rules if rule.get("result") in {
        "issue", "unknown", "failed", "manual_pending"}
        and not (rule.get("decision") or {}).get("resolves"))
    human = sum(1 for rule in rules
                if rule.get("requirement", {}).get("executor") == "human_only")
    deterministic = sum(1 for rule in rules
                        if rule.get("requirement", {}).get("executor") == "deterministic")
    semantic = sum(1 for rule in rules
                   if rule.get("requirement", {}).get("executor") in {"semantic", "cross_material"})
    focus_rule = None
    focus_labels = {
        "issue": "有问题",
        "unknown": "待确认",
        "failed": "检查未完成",
        "manual_pending": "人工判断",
    }
    for rule in rules:
        result = rule.get("result")
        if result not in {"issue", "unknown", "failed", "manual_pending"}:
            continue
        if (rule.get("decision") or {}).get("resolves"):
            continue
        requirement = rule.get("requirement") or {}
        executor = requirement.get("executor") or ""
        focus_rule = {
            "rule_id": rule.get("rule_id"),
            "statement": requirement.get("statement") or rule.get("rule_id"),
            "status": focus_labels.get(result, result),
            "executor": executor,
        }
        break
    coverage = run_coverage(run)
    return {"subject_id": subject_id, "subject_name": subject.display_name if subject else "",
            "run_id": run.id, "status": run.status,
            "pages_read": run.pages_read or 0,
            "llm_calls_used": run.llm_calls_used or 0,
            "rules_total": len(rules), "deterministic_rules": deterministic,
            "semantic_rules": semantic, "human_rules": human,
            "pending_rules": pending, "coverage_complete": coverage["complete"],
            "coverage_gaps": coverage["unread_pages"] + coverage["failed_pages"],
            "focus_rule": focus_rule}


def demo_route_data(db: Session, task: Task) -> dict:
    """Return the smallest useful progress model for the first-entry tour.

    This is deliberately a read-only projection of existing lifecycle state. It
    does not introduce a second workflow or infer acceptance from a model result.
    """
    latest = db.scalar(select(BlueprintVersion).where(
        BlueprintVersion.task_id == task.id).order_by(BlueprintVersion.version.desc()))
    published = task.current_blueprint_id is not None
    has_draft = latest is not None

    entries = db.scalars(select(RosterEntry).where(
        RosterEntry.task_id == task.id).order_by(RosterEntry.id)).all()
    exempt = exempt_subject_ids(db, task)
    subjects = db.scalars(select(Subject).where(Subject.task_id == task.id)).all()
    if task.mode == "roster":
        unissued = []
        for entry in entries:
            if entry.subject_id in exempt:
                continue
            subject = db.get(Subject, entry.subject_id) if entry.subject_id else None
            if subject is None or not has_valid_grant(db, subject):
                unissued.append(entry)
        roster_total = len(entries)
        roster_done = roster_total > 0 and not unissued
        roster_detail = (f"{roster_total - len(unissued)}/{roster_total} 位已安排"
                         if roster_total else "还没有导入提交名单")
    else:
        roster_total = len(subjects)
        roster_done = roster_total > 0
        roster_detail = (f"已登记 {roster_total} 个提交主体"
                         if roster_total else "等待第一位提交主体进入")

    wb = workbench_data(db, task)
    counts = wb["counts"]
    required = counts.get("required", counts.get("registered", 0))
    submitted = counts.get("submitted", 0)
    accepted = counts.get("accepted", 0)
    review_done = required > 0 and accepted >= required
    review_detail = (f"已验收 {accepted}/{required} 个主体"
                     if required else "提交进入后会在这里逐条检查")

    # The first-entry route should land on a real evidence review when one is
    # available. Keep the workbench as the fallback so empty or pre-submission
    # tasks never point at a review page without a subject.
    review_target = next((row for row in wb["rows"]
                          if row.get("subject_id") and row.get("formal")
                          and not row.get("exempt")
                          and row.get("acceptance") != "accepted"), None)
    review_signal = _review_signal(db, task, review_target["subject_id"] if review_target else None)
    if review_target:
        review_href = f"#/review/{task.id}/{review_target['subject_id']}"
        review_detail = (f"已验收 {accepted}/{required} 个主体 · "
                         f"先看 {review_target['name']} 的证据")
    else:
        review_href = f"#/workbench/{task.id}"

    formal_snapshot = db.scalar(select(DeliverySnapshot).where(
        DeliverySnapshot.task_id == task.id,
        DeliverySnapshot.kind == "formal").order_by(DeliverySnapshot.id.desc()))
    export_ready = bool(formal_snapshot and db.scalar(select(ExportJob).where(
        ExportJob.snapshot_id == formal_snapshot.id,
        ExportJob.status == "success").order_by(ExportJob.id.desc())))

    if not published:
        design_state, design_detail = ("current" if has_draft else "current",
                                       "先确认要求并发布一份正式蓝图")
    else:
        design_state, design_detail = "done", "正式蓝图已发布，收集边界已固定"
    if not published:
        roster_state = review_state = delivery_state = "blocked"
    else:
        roster_state = "done" if roster_done else "current"
        review_state = ("done" if review_done else
                        "current" if roster_done or submitted else "upcoming")
        delivery_state = ("done" if export_ready else
                          "current" if review_done else "upcoming")

    steps = [
        {"key": "design", "title": "整理要求", "detail": design_detail,
         "status": design_state, "href": f"#/design/{task.id}"},
        {"key": "roster", "title": "发放凭证", "detail": roster_detail,
         "status": roster_state, "href": f"#/roster/{task.id}"},
        {"key": "review", "title": "检查并接手", "detail": review_detail,
         "status": review_state, "href": review_href},
        {"key": "delivery", "title": "固定交付",
         "detail": ("CSV + ZIP 已从正式快照生成" if export_ready
                    else "验收完成后固定快照并生成 CSV + ZIP"),
         "status": delivery_state, "href": f"#/delivery/{task.id}"},
    ]
    next_step = next((s for s in steps if s["status"] != "done"), steps[-1])
    current_step = next((s for s in steps if s["status"] == "current"), next_step)
    completed = sum(s["status"] == "done" for s in steps)
    return {"task_id": task.id, "completed": completed, "total": len(steps),
            "current": {"title": current_step["title"], "href": current_step["href"],
                        "detail": current_step["detail"], "status": current_step["status"]},
            "next": {"title": next_step["title"], "href": next_step["href"],
                     "detail": next_step["detail"]},
            "steps": steps, "review_signal": review_signal}
