"""Exemption expiry/revocation must agree across roster, reminders and snapshots."""
import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, text

from app.models import Exemption, ManualDecision, RosterEntry, Subject
from app.services import decisions as dec, notifications, export
from app.services.checks import create_run, execute_run
from app.services.progress import exempt_subject_ids, workbench_data
from app.services.submissions import formal_submit, get_or_create_draft
from app.schemas import Blueprint
from tests.conftest import make_task, publish_blueprint


@pytest.fixture
def roster(db_session):
    task = make_task(db_session)
    publish_blueprint(db_session, task, Blueprint())
    subject = Subject(task_id=task.id, kind="individual", display_name="同学")
    db_session.add(subject)
    db_session.flush()
    db_session.add(RosterEntry(task_id=task.id, subject_id=subject.id, name="同学"))
    db_session.flush()
    return task, subject


def assert_pool(db, task, subject, exempt, submitted=False):
    counts = workbench_data(db, task)["counts"]
    assert counts["exempt"] == int(exempt)
    assert counts["required"] == int(not exempt)
    assert counts["submitted"] == int(submitted and not exempt)
    view = notifications.reminder_view(db, task)
    assert [r["subject_id"] for r in view["exempt"]] == ([subject.id] if exempt else [])
    assert [r["subject_id"] for r in view["targets"]] == ([subject.id] if not exempt and not submitted else [])


def test_revoke_restores_required_pool_and_keeps_history(db_session, roster):
    task, subject = roster
    intent = notifications.create_notification(db_session, task, content="请提交")
    d = dec.record_decision(db_session, task, subject, decision="exempt", reason="因病")
    db_session.flush()
    e = db_session.scalar(select(Exemption))
    assert e.decision_id == d.id
    assert d.revision_id is None
    assert_pool(db_session, task, subject, True)
    revocation = dec.revoke_decision(db_session, task, d.id, "已恢复")
    assert e.status == "revoked"
    assert_pool(db_session, task, subject, False)
    assert d.revoked and revocation.decision == "revoke"
    assert len(json.loads(intent.targets_json)) == 1
    with pytest.raises(dec.DecisionError, match="撤销记录"):
        dec.revoke_decision(db_session, task, revocation.id, "撤回撤销")


def test_expiry_exact_boundary_and_offset(db_session, roster, monkeypatch):
    task, subject = roster
    expiry = datetime.now(timezone.utc) + timedelta(hours=1)
    d = dec.record_decision(db_session, task, subject, decision="exempt", reason="临时", expires_at=expiry)
    db_session.commit()
    db_session.expire_all()  # SQLite roundtrip removes timezone information.
    from app.services import progress
    monkeypatch.setattr(progress, "utcnow", lambda: expiry - timedelta(microseconds=1))
    assert_pool(db_session, task, subject, True)
    monkeypatch.setattr(progress, "utcnow", lambda: expiry)
    assert_pool(db_session, task, subject, False)
    assert d.revoked is False  # Expiry changes effective state, not historical facts.


def test_duplicate_exemptions_revoke_independently(db_session, roster):
    task, subject = roster
    first = dec.record_decision(db_session, task, subject, decision="exempt", reason="一")
    second = dec.record_decision(db_session, task, subject, decision="exempt", reason="二")
    db_session.flush()
    dec.revoke_decision(db_session, task, first.id, "撤销一")
    assert_pool(db_session, task, subject, True)
    dec.revoke_decision(db_session, task, second.id, "撤销二")
    assert_pool(db_session, task, subject, False)


def test_formal_exemptions_are_task_scoped_and_snapshots_stay_fixed(db_session, roster):
    task, subject = roster
    sub = get_or_create_draft(db_session, task, subject.id)
    rev = formal_submit(db_session, task, sub, fields={}, slot_file_ids={}, idempotency_key="first")
    execute_run(db_session, create_run(db_session, task, rev))
    dec.record_decision(db_session, task, subject, decision="accept_current", reason="确认验收")
    d = dec.record_decision(db_session, task, subject, decision="exempt", reason="免交")
    assert d.revision_id is None
    assert_pool(db_session, task, subject, True, submitted=True)
    snap = export.create_snapshot(db_session, task)
    original = snap.manifest_json
    entry = json.loads(original)["entries"][0]
    assert entry["exempt"] and entry["accepted"] and not entry["included"]
    assert "免交" in entry["excluded_reason"]
    dec.revoke_decision(db_session, task, d.id, "恢复应交")
    assert_pool(db_session, task, subject, False, submitted=True)
    assert json.loads(export.create_snapshot(db_session, task).manifest_json)["entries"][0]["included"]
    assert snap.manifest_json == original
    # New formal versions do not invalidate task-level exemption.
    d2 = dec.record_decision(db_session, task, subject, decision="exempt", reason="再次免交")
    formal_submit(db_session, task, sub, fields={"extra": "v2"}, slot_file_ids={}, idempotency_key="second")
    assert d2.revision_id is None
    assert subject.id in exempt_subject_ids(db_session, task)


def test_expired_deadline_rejected_and_naive_time_uses_task_zone(db_session, roster):
    task, subject = roster
    with pytest.raises(dec.DecisionError, match="晚于"):
        dec.record_decision(db_session, task, subject, decision="exempt", reason="过期", expires_at=datetime(2000, 1, 1))
    with pytest.raises(dec.DecisionError, match="整个主体"):
        dec.record_decision(db_session, task, subject, decision="exempt", reason="规则", scope_rule_id="r1")
    d = dec.record_decision(db_session, task, subject, decision="exempt", reason="有效", expires_at=datetime(2099, 1, 1, 8))
    assert d.expires_at == datetime(2099, 1, 1, tzinfo=timezone.utc)


def test_legacy_link_is_idempotent_and_preserves_standalone(db_session, roster):
    task, subject = roster
    d = dec.record_decision(db_session, task, subject, decision="exempt", reason="旧记录")
    db_session.flush()
    e = db_session.scalar(select(Exemption).where(Exemption.decision_id == d.id))
    e.decision_id = None
    db_session.add(Exemption(task_id=task.id, subject_id=subject.id, kind="special_deadline", reason="延期"))
    db_session.commit()
    from app.db import _link_legacy_exemptions, _add_missing_columns
    _add_missing_columns()
    _link_legacy_exemptions()
    _link_legacy_exemptions()
    db_session.expire_all()
    assert db_session.get(Exemption, e.id).decision_id == d.id
    standalone = db_session.scalar(select(Exemption).where(Exemption.kind == "special_deadline"))
    assert standalone.decision_id is None
    dec.revoke_decision(db_session, task, d.id, "撤销")
    assert_pool(db_session, task, subject, False)


def test_existing_sqlite_schema_upgrades_without_rebuilding(tmp_path, monkeypatch):
    from sqlalchemy import create_engine
    import app.db as database
    legacy = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with legacy.begin() as conn:
        conn.execute(text("CREATE TABLE submissions (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE exemptions (id INTEGER PRIMARY KEY, reason TEXT)"))
        conn.execute(text("INSERT INTO exemptions (id, reason) VALUES (1, '保留旧记录')"))
    monkeypatch.setattr(database, "engine", legacy)
    database._add_missing_columns()
    database._add_missing_columns()
    with legacy.connect() as conn:
        row = conn.execute(text("SELECT reason, decision_id FROM exemptions WHERE id=1")).one()
        assert row == ("保留旧记录", None)
    legacy.dispose()


def test_api_revoke_rejects_wrong_subject_and_preserves_decision(db_session, roster):
    from fastapi.testclient import TestClient
    from app.main import app
    from app.models import Account
    from tests.test_authz import _register
    task, subject = roster
    db_session.commit()
    with TestClient(app) as client:
        h = _register(client, "exemption-api")
        task.created_by = db_session.scalar(select(Account).where(Account.username == "exemption-api")).id
        other = Subject(task_id=task.id, kind="individual", display_name="另一人")
        db_session.add(other)
        d = dec.record_decision(db_session, task, subject, decision="exempt", reason="核实免交")
        db_session.commit()
        path = f"/api/tasks/{task.id}/subjects"
        response = client.post(f"{path}/{other.id}/decisions/{d.id}/revoke", headers=h, data={"reason":"尝试错位"})
        assert response.status_code == 404
        db_session.refresh(d)
        assert not d.revoked
        response = client.post(f"{path}/{subject.id}/decisions/{d.id}/revoke", headers=h, data={"reason":"恢复应交"})
        assert response.status_code == 200
        view = client.get(f"/api/tasks/{task.id}/workbench", headers=h)
        assert view.status_code == 200
        assert view.json()["counts"]["exempt"] == 0
        task_view = view.json()["task"]
        assert task_view["timezone"] == task.timezone
        assert task_view["first_deadline"] is None
        assert task_view["correction_deadline"] is None
