"""A recorded issue is not a pass, and acceptance cannot outlive its evidence."""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import ManualDecision, RuleResult, Subject
from app.schemas import Blueprint, RuleDef
from app.security import utcnow
from app.services import decisions as dec, export
from app.services.checks import create_run, current_summary, current_details, execute_run
from app.services.submissions import get_or_create_draft, formal_submit
from tests.conftest import make_task, publish_blueprint


@pytest.fixture
def review(db_session):
    task = make_task(db_session)
    publish_blueprint(db_session, task, Blueprint(rules=[
        RuleDef(id="H", statement="人工核对原文", requirement_source="组织者要求", executor="human_only")]))
    subject = Subject(task_id=task.id, kind="individual", display_name="核对主体")
    db_session.add(subject)
    db_session.flush()
    rev = formal_submit(db_session, task, get_or_create_draft(db_session, task, subject.id),
                        fields={}, slot_file_ids={}, idempotency_key="v1")
    run = create_run(db_session, task, rev)
    execute_run(db_session, run)
    return db_session, task, subject, rev, run


def decide(review, action, **kwargs):
    db, task, subject, rev, _ = review
    return dec.record_decision(db, task, subject, decision=action, reason="已查看原文",
        scope_rule_id="" if action == "accept_current" else "H", expected_current_revision=rev.id, **kwargs)


def included(review):
    db, task, *_ = review
    return json.loads(export.create_snapshot(db, task).manifest_json)["entries"][0]["included"]


def test_confirm_issue_keeps_blocker_and_cannot_accept(review):
    db, task, subject, *_ = review
    decide(review, "confirm_issue")
    summary = current_summary(db, task, subject.id)
    assert summary["summary"] == "待补正"
    assert summary["buckets"]["blocking"] == ["H"]
    with pytest.raises(dec.DecisionError, match="确认存在问题"):
        decide(review, "accept_current")
    details = current_details(db, task, subject.id)
    assert details[0]["result"] == "manual_pending"
    assert details[0]["decision"]["resolves"] is False
    assert not included(review)


def test_positive_rule_decision_is_separate_from_acceptance(review):
    db, task, subject, *_ = review
    decide(review, "confirm_pass")
    assert dec._acceptance_blockers(db, task, subject) == []
    assert current_summary(db, task, subject.id)["acceptance"] != "accepted"
    assert not included(review)
    decide(review, "accept_current")
    assert included(review)
    assert not db.scalars(select(RuleResult)).all()  # No fabricated machine pass.


def test_latest_effective_rule_choice_wins_and_old_acceptance_does_not_revive(review):
    db, task, subject, *_ = review
    decide(review, "confirm_pass")
    decide(review, "accept_current")
    old_snapshot = export.create_snapshot(db, task).manifest_json
    issue = decide(review, "confirm_issue")
    assert current_summary(db, task, subject.id)["summary"] == "待补正"
    assert not included(review)
    dec.revoke_decision(db, task, issue.id, "重新核对原文")
    assert dec._acceptance_blockers(db, task, subject) == []
    assert current_summary(db, task, subject.id)["acceptance"] != "accepted"
    decide(review, "accept_current")
    assert included(review)
    assert json.loads(old_snapshot)["entries"][0]["included"]


@pytest.mark.parametrize("invalidate", ["revoke", "expire"])
def test_resolution_invalidation_removes_acceptance_and_future_export(review, invalidate):
    db, task, subject, *_ = review
    passing = decide(review, "confirm_pass")
    decide(review, "accept_current")
    snapshot = export.create_snapshot(db, task)
    before = snapshot.manifest_json
    if invalidate == "revoke":
        dec.revoke_decision(db, task, passing.id, "需重新核对")
    else:
        passing.expires_at = utcnow() - timedelta(seconds=1)
        db.flush()
    assert current_summary(db, task, subject.id)["acceptance"] != "accepted"
    assert not included(review)
    assert snapshot.manifest_json == before
    decide(review, "confirm_pass")
    assert current_summary(db, task, subject.id)["acceptance"] != "accepted"
    decide(review, "accept_current")
    assert included(review)


def test_revoking_latest_acceptance_does_not_revive_older_acceptance(review):
    db, task, subject, *_ = review
    decide(review, "confirm_pass")
    first = decide(review, "accept_current")
    latest = decide(review, "accept_current")
    dec.revoke_decision(db, task, latest.id, "撤回当前验收")
    assert first.revoked is False
    assert not included(review)


def test_rechecking_current_revision_requires_fresh_acceptance(review):
    db, task, subject, rev, _ = review
    decide(review, "confirm_pass")
    decide(review, "accept_current")
    execute_run(db, create_run(db, task, rev))
    assert not included(review)
    decide(review, "accept_current")
    assert included(review)


def test_invalid_rule_scope_never_resolves_current_rules(review):
    db, task, subject, rev, _ = review
    for scope in ["", "ghost"]:
        with pytest.raises(dec.DecisionError, match="规则"):
            dec.record_decision(db, task, subject, decision="confirm_pass", reason="核对", scope_rule_id=scope)
    assert not db.scalars(select(ManualDecision)).all()


def test_ineligible_is_not_an_acceptable_eligibility(review):
    db, task, subject, _, run = review
    from app.models import BlueprintVersion
    bp = db.get(BlueprintVersion, run.blueprint_version_id)
    blueprint = Blueprint.model_validate_json(bp.blueprint_json)
    blueprint.eligibility_required = True
    bp.blueprint_json = blueprint.model_dump_json()
    decide(review, "confirm_pass")
    dec.record_decision(db, task, subject, decision="eligibility", eligibility="ineligible", reason="人工核实不符合")
    with pytest.raises(dec.DecisionError, match="资格前提"):
        decide(review, "accept_current")
    dec.record_decision(db, task, subject, decision="eligibility", eligibility="eligible", reason="重新核实符合")
    decide(review, "accept_current")
    assert included(review)


def test_confirmed_issue_overrides_machine_pass_without_rewriting_it(review):
    db, task, subject, _, run = review
    raw = RuleResult(run_id=run.id, rule_id="H", result="satisfied", severity="blocking", explanation="原始结果")
    db.add(raw)
    db.flush()
    decide(review, "confirm_issue")
    assert current_summary(db, task, subject.id)["buckets"]["blocking"] == ["H"]
    assert raw.result == "satisfied" and raw.explanation == "原始结果"
    assert not included(review)


def test_appeal_handled_requires_an_effective_decision_for_its_revision(review):
    from app.models import SubmitterNote
    from app.services.appeals import note_handled
    db, task, subject, rev, _ = review
    note = SubmitterNote(task_id=task.id, subject_id=subject.id, revision_id=rev.id,
                         rule_id="H", content="请复核", created_at=utcnow() - timedelta(seconds=1))
    db.add(note)
    passing = decide(review, "confirm_pass")
    assert note_handled(db, note)
    passing.expires_at = utcnow() - timedelta(seconds=1)
    db.flush()
    assert not note_handled(db, note)
    passing.expires_at = None
    db.flush()
    dec.revoke_decision(db, task, passing.id, "撤销处理")
    assert not note_handled(db, note)
