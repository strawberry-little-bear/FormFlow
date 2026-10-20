"""Eligibility is a reversible, expiring human decision tied to verified scope."""
import json
from datetime import timedelta

import pytest
from sqlalchemy import select, text, create_engine
from fastapi.testclient import TestClient

from app.main import app
from app.models import Account, BlueprintVersion, ManualDecision, Member, Subject
from app.schemas import Blueprint
from app.security import utcnow
from app.services import decisions as dec, export, tasks
from app.services.checks import create_run, execute_run, current_summary
from app.services.eligibility import eligibility_view
from app.services.progress import workbench_data
from app.services.submissions import formal_submit, get_or_create_draft
from tests.conftest import make_task, publish_blueprint
from tests.test_authz import _register


@pytest.fixture
def review(db_session):
    task = make_task(db_session, mode="open", subject_kind="team")
    publish_blueprint(db_session, task, Blueprint(eligibility_required=True))
    subject = Subject(task_id=task.id, kind="team", display_name="虚构团队")
    db_session.add(subject)
    db_session.flush()
    tasks.add_members(db_session, subject, ["甲", "乙"])
    submission = get_or_create_draft(db_session, task, subject.id)
    rev = formal_submit(db_session, task, submission, fields={}, slot_file_ids={}, idempotency_key="v1")
    execute_run(db_session, create_run(db_session, task, rev))
    return db_session, task, subject, submission, rev


def decide(review, outcome="eligible", **kwargs):
    db, task, subject, _, rev = review
    return dec.record_decision(db, task, subject, decision="eligibility", eligibility=outcome,
                               reason="人工核对虚构登记资料", expected_current_revision=rev.id, **kwargs)


def accepted(review):
    db, task, subject, *_ = review
    return current_summary(db, task, subject.id)["acceptance"] == "accepted"


def test_missing_qualification_blocks_acceptance_and_visible_as_independent_state(review):
    db, task, subject, _, rev = review
    assert eligibility_view(db, task, subject, rev.id)["status"] == "not_assessed"
    assert workbench_data(db, task)["counts"]["eligibility_pending"] == 1
    with pytest.raises(dec.DecisionError, match="资格前提"):
        dec.record_decision(db, task, subject, decision="accept_current", reason="材料通过")
    decision = decide(review)
    assert decision.eligibility == "eligible" and decision.eligibility_members_hash
    assert decision.revision_id == rev.id
    assert workbench_data(db, task)["counts"]["eligibility_pending"] == 0
    assert not accepted(review)
    dec.record_decision(db, task, subject, decision="accept_current", reason="材料与资格分别核实")
    assert accepted(review)


@pytest.mark.parametrize("invalidate", ["revoke", "expire", "members"])
def test_invalidation_returns_pending_and_excludes_new_snapshot(review, invalidate):
    db, task, subject, _, rev = review
    decision = decide(review)
    dec.record_decision(db, task, subject, decision="accept_current", reason="核对完成")
    old = export.create_snapshot(db, task)
    original = old.manifest_json
    if invalidate == "revoke":
        reversal = dec.revoke_decision(db, task, decision.id, "需要重新核实")
        assert reversal.revokes_decision_id == decision.id
    elif invalidate == "expire":
        decision.expires_at = utcnow() - timedelta(seconds=1)
        db.flush()
    else:
        tasks.add_members(db, subject, ["丙"])
    state = eligibility_view(db, task, subject, rev.id)
    assert state["status"] == "pending"
    assert state["reason"] == "人工核对虚构登记资料"
    assert not accepted(review)
    new_manifest = json.loads(export.create_snapshot(db, task).manifest_json)
    assert not new_manifest["entries"][0]["included"]
    assert new_manifest["entries"][0]["eligibility"]["status"] == "pending"
    assert "资格" in new_manifest["entries"][0]["excluded_reason"]
    csv = export._build_csv(new_manifest).decode("utf-8-sig")
    assert "资格结论" in csv and "待核实" in csv
    assert old.manifest_json == original and json.loads(original)["entries"][0]["included"]
    decide(review)
    assert not accepted(review)  # A new eligibility decision never silently restores old acceptance.
    dec.record_decision(db, task, subject, decision="accept_current", reason="重新确认验收")
    assert accepted(review)


def test_latest_revoked_qualification_never_revives_earlier_positive(review):
    db, task, subject, _, rev = review
    first = decide(review)
    latest = decide(review, "ineligible")
    assert workbench_data(db, task)["counts"]["eligibility_pending"] == 0  # A rejection is already assessed.
    dec.revoke_decision(db, task, latest.id, "撤回不符合结论，重新调查")
    assert not first.revoked
    assert eligibility_view(db, task, subject, rev.id)["status"] == "pending"


def test_exact_expiry_boundary_after_sqlite_roundtrip(review, monkeypatch):
    db, task, subject, _, rev = review
    expiry = utcnow() + timedelta(hours=1)
    decide(review, expires_at=expiry)
    db.commit()
    db.expire_all()
    import app.services.eligibility as service
    monkeypatch.setattr(service, "utcnow", lambda: expiry - timedelta(microseconds=1))
    assert eligibility_view(db, task, subject, rev.id)["status"] == "eligible"
    monkeypatch.setattr(service, "utcnow", lambda: expiry)
    assert eligibility_view(db, task, subject, rev.id)["status"] == "pending"


def test_formal_v2_requires_fresh_qualification_but_draft_does_not(review):
    db, task, subject, submission, rev = review
    decide(review)
    from app.services.submissions import save_draft
    save_draft(db, submission, {"note":"草稿修改"}, slot_file_ids={})
    assert eligibility_view(db, task, subject, rev.id)["status"] == "eligible"
    v2 = formal_submit(db, task, submission, fields={"note":"正式补交"}, slot_file_ids={}, idempotency_key="v2")
    execute_run(db, create_run(db, task, v2))
    assert eligibility_view(db, task, subject, v2.id)["status"] == "pending"
    with pytest.raises(dec.DecisionConflict):
        decide(review)  # Stale page cannot apply a qualification to v2.


def test_legacy_positive_flag_or_incomplete_decision_is_never_assumed_valid(review):
    db, task, subject, _, rev = review
    subject.eligibility = "eligible"
    assert eligibility_view(db, task, subject, rev.id)["status"] == "pending"
    db.add(ManualDecision(task_id=task.id, subject_id=subject.id, revision_id=rev.id,
                          decision="eligibility", reason="旧记录未存结论"))
    db.flush()
    assert eligibility_view(db, task, subject, rev.id)["status"] == "pending"
    decide(review)
    assert eligibility_view(db, task, subject, rev.id)["status"] == "eligible"


def test_member_metadata_changes_invalidate_scope_but_duplicate_registration_does_not(review):
    db, task, subject, _, rev = review
    decide(review)
    tasks.add_members(db, subject, ["甲"])
    assert eligibility_view(db, task, subject, rev.id)["status"] == "eligible"
    member = db.scalar(select(Member).where(Member.subject_id == subject.id))
    member.extra_json = '{"group":"新登记信息"}'
    db.flush()
    assert eligibility_view(db, task, subject, rev.id)["status"] == "pending"


def test_pre_formal_qualification_is_not_inherited_by_first_formal_revision(db_session):
    task = make_task(db_session)
    publish_blueprint(db_session, task, Blueprint(eligibility_required=True))
    subject = Subject(task_id=task.id, kind="individual", display_name="虚构主体")
    db_session.add(subject)
    db_session.flush()
    dec.record_decision(db_session, task, subject, decision="eligibility", eligibility="eligible", reason="提交前预核", expected_current_revision=0)
    assert eligibility_view(db_session, task, subject)["status"] == "eligible"
    rev = formal_submit(db_session, task, get_or_create_draft(db_session, task, subject.id), fields={}, slot_file_ids={}, idempotency_key="first")
    assert eligibility_view(db_session, task, subject, rev.id)["status"] == "pending"


def test_existing_database_gets_nullable_columns_without_inventing_history(tmp_path, monkeypatch):
    import app.db as database
    legacy = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with legacy.begin() as conn:
        conn.execute(text("CREATE TABLE manual_decisions (id INTEGER PRIMARY KEY, reason TEXT)"))
        conn.execute(text("INSERT INTO manual_decisions (id, reason) VALUES (1, '旧理由')"))
    monkeypatch.setattr(database, "engine", legacy)
    database._add_missing_columns()
    database._add_missing_columns()
    with legacy.connect() as conn:
        row = conn.execute(text("SELECT reason, eligibility, eligibility_members_hash, revokes_decision_id FROM manual_decisions")).one()
        assert row == ("旧理由", None, None, None)
    legacy.dispose()


def test_qualification_api_validates_outcome_scope_and_shares_current_status(review):
    db, task, subject, _, rev = review
    db.commit()
    with TestClient(app) as client:
        owner = _register(client, "eligibility-owner")
        task.created_by = db.scalar(select(Account).where(Account.username == "eligibility-owner")).id
        db.commit()
        path = f"/api/tasks/{task.id}/subjects/{subject.id}"
        base = dict(decision="eligibility", reason="人工核实", expected_current_revision=rev.id,
                    expected_members_hash=eligibility_view(db, task, subject, rev.id)["members_hash"])
        for payload in [base, dict(base, eligibility="maybe"), dict(base, eligibility="eligible", scope_rule_id="R")]:
            assert client.post(path + "/decisions", headers=owner, data=payload).status_code == 422
        missing_scope = dict(base, eligibility="eligible")
        del missing_scope["expected_members_hash"]
        assert client.post(path + "/decisions", headers=owner, data=missing_scope).status_code == 422
        tasks.add_members(db, subject, ["新登记成员"])
        db.commit()
        assert client.post(path + "/decisions", headers=owner, data=dict(base, eligibility="eligible")).status_code == 409
        base["expected_members_hash"] = eligibility_view(db, task, subject, rev.id)["members_hash"]
        created = client.post(path + "/decisions", headers=owner, data=dict(base, eligibility="eligible"))
        assert created.status_code == 200, created.text
        page = client.get(path + "/findings", headers=owner).json()
        assert page["eligibility"]["status"] == "eligible"
        assert page["decisions"][-1]["eligibility"] == "eligible"
        assert page["acceptance"]["ready"] and not page["acceptance"]["accepted"]
        token = tasks.issue_grant(db, task, subject)
        db.commit()
        mine = client.get("/api/me/results", headers={"Authorization":"Bearer " + token}).json()
        assert mine["eligibility"] == page["eligibility"]
        response = client.post(path + f"/decisions/{created.json()['decision_id']}/revoke", headers=owner, data={"reason":"重新核实"})
        assert response.status_code == 200
        assert client.get(path + "/findings", headers=owner).json()["eligibility"]["status"] == "pending"


def test_stale_member_review_cannot_approve_unseen_member_change(review):
    db, task, subject, _, rev = review
    seen = eligibility_view(db, task, subject, rev.id)["members_hash"]
    tasks.add_members(db, subject, ["未核对新成员"])
    with pytest.raises(dec.DecisionConflict, match="登记成员"):
        decide(review, expected_members_hash=seen)
    assert eligibility_view(db, task, subject, rev.id)["status"] == "not_assessed"


def test_roster_pending_count_handles_unissued_rows_and_excludes_nonroster_subjects(review):
    from app.models import RosterEntry
    db, task, subject, *_ = review
    task.mode = "roster"
    db.add(RosterEntry(task_id=task.id, name="未发放者"))
    db.add(RosterEntry(task_id=task.id, name=subject.display_name, subject_id=subject.id))
    outside = Subject(task_id=task.id, kind="team", display_name="名册外团队")
    db.add(outside)
    db.flush()
    data = workbench_data(db, task)
    assert data["counts"]["eligibility_pending"] == 1
