"""Regressions for the P01-P04 time, denominator, draft and review contracts."""
import json
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import engine
from app.main import app
from app.models import (BlueprintVersion, Exemption, FileObject, ManualDecision, RosterEntry,
                        Subject, Submission, Task)
from app.schemas import Blueprint, FieldDef, SlotDef, TimePolicy, RuleDef
from app.services import submissions as sub
from app.services import tasks
from app.services.decisions import DecisionConflict, record_decision
from app.services.progress import workbench_data
from app.services.notifications import reminder_view
from tests.conftest import make_task, publish_blueprint
from tests.test_authz import _register


@pytest.fixture()
def scenario(db_session):
    task = make_task(db_session)
    publish_blueprint(db_session, task, Blueprint())
    subject = Subject(task_id=task.id, kind="individual", display_name="张三")
    db_session.add(subject)
    db_session.flush()
    credential = tasks.issue_grant(db_session, task, subject)
    db_session.commit()
    return task, subject, {"Authorization": "Bearer " + credential}


def formal(db, task, subject, key):
    return sub.formal_submit(db, task, sub.get_or_create_draft(db, task, subject.id),
                             fields={"name": key}, slot_file_ids={}, idempotency_key=key)


def test_draft_content_and_files_survive_new_session(db_session, scenario):
    task, subject, h = scenario
    db_session.get(BlueprintVersion, task.current_blueprint_id).blueprint_json = Blueprint(
        slots=[SlotDef(id="report", label="报告", formats=["txt"])]).model_dump_json()
    db_session.commit()
    with TestClient(app) as client:
        initial = client.get("/api/me/draft", headers=h).json()
        assert initial["fields"] == {} and initial["slot_file_ids"] == {}
        assert initial["draft_version"] == 1
        upload = client.post("/api/me/files", headers=h, data={"slot": "report"},
                             files={"file": ("report.txt", b"draft", "text/plain")}).json()
        files = {"report": [upload["file_id"]]}
        r = client.post("/api/me/draft", headers=h, json={
            "fields": {"name": "未提交的填写"}, "slot_file_ids": files, "expected_version": 1})
        assert r.status_code == 200, r.text
        saved = client.get("/api/me/draft", headers=h).json()
        assert saved["fields"] == {"name": "未提交的填写"}
        assert [f["file_id"] for f in saved["slot_file_ids"]["report"]] == files["report"]
        assert saved["draft_version"] == 2
        assert client.get("/api/me/receipt", headers=h).json() == {"formal": False}
        conflict = client.post("/api/me/draft", headers=h, json={
            "fields": {"name": "另一个标签页"}, "expected_version": 1})
        assert conflict.status_code == 409
        assert client.get("/api/me/draft", headers=h).json() == saved


def test_draft_cas_rechecks_even_when_session_cached_old_version(db_session, scenario):
    task, subject, _ = scenario
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    db_session.commit()
    with Session(engine) as other:
        stale = other.get(Submission, submission.id)
        sub.save_draft(db_session, submission, {"name": "new"}, expected_version=1)
        db_session.commit()
        assert stale.draft_version == 1
        with pytest.raises(sub.SubmitError, match="冲突"):
            sub.save_draft(other, stale, {"name": "old"}, expected_version=1)
        other.rollback()
    assert sub.read_draft(db_session, submission)["fields"] == {"name": "new"}


def test_draft_isolation_and_formal_receipt_unchanged(db_session, scenario):
    task, subject, h = scenario
    v1 = formal(db_session, task, subject, "v1")
    db_session.commit()
    receipt = v1.receipt
    with TestClient(app) as client:
        draft = client.get("/api/me/draft", headers=h).json()
        assert draft["fields"] == {"name": "v1"}
        assert client.post("/api/me/draft", headers=h, json={
            "fields": {"name": "v2-draft"}, "expected_version": draft["draft_version"]}).status_code == 200
        assert client.get("/api/me/receipt", headers=h).json()["receipt"] == receipt
        other = Subject(task_id=task.id, kind="individual", display_name="李四")
        db_session.add(other)
        db_session.flush()
        token = tasks.issue_grant(db_session, task, other)
        db_session.commit()
        assert client.get("/api/me/draft", headers={"Authorization": "Bearer " + token}).json()["fields"] == {}


def test_formal_receipt_keeps_a_readable_file_manifest_after_editing_correction_draft(db_session, scenario):
    task, subject, headers = scenario
    version = db_session.get(BlueprintVersion, task.current_blueprint_id)
    version.blueprint_json = Blueprint(slots=[SlotDef(
        id="report", label="活动报名单", formats=["txt"])]).model_dump_json()
    db_session.commit()
    with TestClient(app) as client:
        uploaded = client.post("/api/me/files", headers=headers, data={"slot": "report"},
                               files={"file": ("虚构报名单.txt", b"fictional signup", "text/plain")})
        assert uploaded.status_code == 200, uploaded.text
        file_id = uploaded.json()["file_id"]
        revision = sub.formal_submit(db_session, task,
            sub.get_or_create_draft(db_session, task, subject.id), fields={},
            slot_file_ids={"report": [file_id]}, idempotency_key="receipt-file-v1")
        db_session.commit()
        draft = client.get("/api/me/draft", headers=headers).json()
        assert draft["slot_file_ids"]["report"][0]["file_id"] == file_id
        # A later correction draft may intentionally remove its working attachment,
        # but the already-issued immutable receipt must continue to identify v1 files.
        saved = client.post("/api/me/draft", headers=headers, json={
            "fields": {"correction_note": "准备补正"}, "slot_file_ids": {},
            "expected_version": draft["draft_version"]})
        assert saved.status_code == 200, saved.text
        assert client.get("/api/me/draft", headers=headers).json()["slot_file_ids"] == {}
        receipt = client.get("/api/me/receipt", headers=headers).json()
        assert receipt["formal"] is True
        assert receipt["receipt"] == revision.receipt
        assert receipt["files"] == [{"name": "虚构报名单.txt", "size": len(b"fictional signup"),
                                     "slot": "活动报名单"}]


def test_stale_review_returns_conflict_without_recording_decision(db_session, scenario):
    task, subject, _ = scenario
    v1 = formal(db_session, task, subject, "v1")
    task_id, sid = task.id, subject.id
    db_session.commit()
    with TestClient(app) as client:
        owner = _register(client, "reviewer")
        from app.models import Account
        account = db_session.scalar(select(Account).where(Account.username == "reviewer"))
        task.created_by = account.id
        db_session.commit()
        page = client.get(f"/api/tasks/{task_id}/subjects/{sid}/findings", headers=owner).json()
        assert page["revision"]["id"] == v1.id
        v2 = formal(db_session, task, subject, "v2")
        db_session.commit()
        path = f"/api/tasks/{task_id}/subjects/{sid}/decisions"
        bp = db_session.get(BlueprintVersion, task.current_blueprint_id)
        bp.blueprint_json = Blueprint(rules=[RuleDef(id="R", statement="核对", requirement_source="要求", executor="human_only")]).model_dump_json()
        from app.services.checks import create_run
        create_run(db_session, task, v2)
        db_session.commit()
        form = {"decision": "confirm_issue", "scope_rule_id": "R", "reason": "我看到的 v1 有问题",
                "expected_current_revision": page["revision"]["id"], "expected_review_context": page["review_context"]}
        response = client.post(path, headers=owner, data=form)
        assert response.status_code == 409, response.text
        assert not db_session.scalars(select(ManualDecision)).all()
        form["expected_review_context"] = client.get(f"/api/tasks/{task_id}/subjects/{sid}/findings", headers=owner).json()["review_context"]
        form["expected_current_revision"] = v2.id
        assert client.post(path, headers=owner, data=form).status_code == 200
        decisions = db_session.scalars(select(ManualDecision)).all()
        assert len(decisions) == 1 and decisions[0].revision_id == v2.id
        del form["expected_current_revision"]
        assert client.post(path, headers=owner, data=form).status_code == 422


def test_review_service_refreshes_cached_pointer(db_session, scenario):
    task, subject, _ = scenario
    v1 = formal(db_session, task, subject, "v1")
    db_session.commit()
    with Session(engine) as reviewer:
        old = reviewer.scalar(select(Submission))
        task2, subject2 = reviewer.get(Task, task.id), reviewer.get(Subject, subject.id)
        formal(db_session, task, subject, "v2")
        db_session.commit()
        assert old.current_revision_id == v1.id
        with pytest.raises(DecisionConflict):
            record_decision(reviewer, task2, subject2, decision="confirm_issue", reason="old page",
                            expected_current_revision=v1.id)
        reviewer.rollback()


def test_roster_denominator_excludes_exempt_and_includes_unissued(db_session, scenario):
    task, subject, _ = scenario
    exempt = Subject(task_id=task.id, kind="individual", display_name="免交者")
    db_session.add(exempt)
    db_session.flush()
    db_session.add_all([RosterEntry(task_id=task.id, subject_id=subject.id, name="已交者"),
                       RosterEntry(task_id=task.id, subject_id=exempt.id, name="免交者"),
                       RosterEntry(task_id=task.id, name="尚未发凭证")])
    db_session.add(Exemption(task_id=task.id, subject_id=exempt.id, kind="exempt", status="active"))
    formal(db_session, task, subject, "v1")
    db_session.flush()
    data = workbench_data(db_session, task)
    assert data["counts"] == {"roster": 3, "required": 2, "exempt": 1,
                               "submitted": 1, "unsubmitted": 1, "accepted": 0}
    # An exempt subject who happens to submit is still outside the required pool.
    formal(db_session, task, exempt, "exempt-v1")
    assert workbench_data(db_session, task)["counts"] == data["counts"]
    task.mode = "open"
    counts = workbench_data(db_session, task)["counts"]
    assert counts["registered"] == 2 and counts["submitted"] == 2
    assert "required" not in counts and "unsubmitted" not in counts


def test_special_deadline_is_not_exemption(db_session, scenario):
    task, subject, _ = scenario
    db_session.add_all([RosterEntry(task_id=task.id, subject_id=subject.id, name="张三"),
                       Exemption(task_id=task.id, subject_id=subject.id, kind="special_deadline", status="active")])
    db_session.flush()
    assert workbench_data(db_session, task)["counts"]["exempt"] == 0


def test_publish_uses_same_instant_after_sqlite_roundtrip(db_session, scenario, monkeypatch):
    task, subject, h = scenario
    policy = TimePolicy(timezone="Asia/Shanghai", open_at="2026-11-01T00:00:00",
                        first_deadline="2026-11-08T18:00:00+08:00", correction_deadline="2026-11-10T18:00:00")
    bp = BlueprintVersion(task_id=task.id, version=2, status="draft",
                          blueprint_json=Blueprint(fields=[FieldDef(id="name", label="姓名")], time_policy=policy).model_dump_json())
    db_session.add(bp)
    db_session.flush()
    tasks.publish(db_session, task, bp.id)
    db_session.commit()
    with TestClient(app) as client:
        space = client.get("/api/me", headers=h).json()
        assert space["task"]["first_deadline"] == "2026-11-08T10:00:00+00:00"
        assert datetime.fromisoformat(space["blueprint"]["time_policy"]["first_deadline"]) == policy.first_deadline
    db_session.refresh(task)
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    monkeypatch.setattr(sub, "_now_utc", lambda: datetime(2026, 11, 8, 10, tzinfo=timezone.utc))
    with pytest.raises(sub.SubmitError, match="首次截止"):
        formal(db_session, task, subject, "deadline-boundary")


def test_invalid_timezone_is_validation_error():
    with pytest.raises(ValueError, match="未知任务时区"):
        TimePolicy(timezone="not/a/zone")


def test_formal_without_check_still_exposes_workbench_version(db_session, scenario):
    task, subject, _ = scenario
    rev = formal(db_session, task, subject, "without-check")
    row = next(r for r in workbench_data(db_session, task)["rows"]
               if r["subject_id"] == subject.id)
    assert row["formal"] is True
    assert row["revision"] == rev.version


def test_special_deadline_stays_in_required_and_reminder_pool(db_session, scenario):
    task, subject, _ = scenario
    db_session.add_all([
        RosterEntry(task_id=task.id, subject_id=subject.id, name="张三"),
        Exemption(task_id=task.id, subject_id=subject.id,
                  kind="special_deadline", status="active"),
    ])
    db_session.flush()
    counts = workbench_data(db_session, task)["counts"]
    assert counts["required"] == 1 and counts["unsubmitted"] == 1
    view = reminder_view(db_session, task)
    assert view["exempt"] == []
    assert [r["subject_id"] for r in view["targets"]] == [subject.id]


def test_explicit_empty_draft_does_not_restore_old_formal_fields(db_session, scenario):
    task, subject, _ = scenario
    rev = formal(db_session, task, subject, "old-formal")
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    sub.save_draft(db_session, submission, {}, expected_version=submission.draft_version,
                   slot_file_ids={})
    db_session.commit()
    db_session.expire_all()
    assert sub.read_draft(db_session, submission)["fields"] == {}
    assert submission.current_revision_id == rev.id
