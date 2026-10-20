"""Organizer review: manual tasks, decision overlays and explicit acceptance state."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Account, BlueprintVersion, RuleResult, Subject
from app.schemas import Blueprint, RuleDef
from app.security import utcnow
from app.services.checks import create_run, execute_run, rule_details
from app.services.decisions import record_decision, revoke_decision
from app.services.submissions import formal_submit, get_or_create_draft
from tests.conftest import make_task, publish_blueprint
from tests.test_authz import _register


@pytest.fixture()
def review(db_session):
    db = db_session
    with TestClient(app) as client:
        headers = _register(client, 'review-ux')
        task = make_task(db)
        task.created_by = db.scalar(select(Account).where(Account.username == 'review-ux')).id
        publish_blueprint(db, task, Blueprint(rules=[RuleDef(
            id='H-01', statement='人工核对签字', requirement_source='任务说明', executor='human_only')]))
        subject = Subject(task_id=task.id, kind='individual', display_name='测试主体')
        db.add(subject)
        db.flush()
        db.commit()
        path = f'/api/tasks/{task.id}/subjects/{subject.id}'
        yield db, client, headers, task, subject, path


def submit(db, task, subject, key='v1'):
    revision = formal_submit(db, task, get_or_create_draft(db, task, subject.id),
                             fields={}, slot_file_ids={}, idempotency_key=key)
    run = create_run(db, task, revision)
    execute_run(db, run)
    db.commit()
    return revision, run


def findings(client, headers, path):
    response = client.get(path + '/findings', headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_no_formal_revision_is_not_ready(review):
    _, client, h, _, _, path = review
    page = findings(client, h, path)
    assert page['rules'] == []
    assert page['acceptance'] == dict(ready=False, accepted=False, blockers=['没有正式提交版本'])


def test_manual_review_uses_run_blueprint_without_fabricating_machine_results(review):
    db, client, h, task, subject, path = review
    _, run = submit(db, task, subject)
    newer = BlueprintVersion(task_id=task.id, version=2, status='published',
                             blueprint_json=Blueprint(rules=[RuleDef(
                                 id='H-NEW', statement='新要求', requirement_source='修订',
                                 executor='human_only')]).model_dump_json())
    db.add(newer)
    db.flush()
    task.current_blueprint_id = newer.id
    db.commit()
    page = findings(client, h, path)
    assert [r['rule_id'] for r in page['rules']] == ['H-01']
    assert page['rules'][0]['result'] == 'manual_pending'
    assert page['rules'][0]['decision'] is None
    assert 'H-01' in page['acceptance']['blockers'][0]
    assert not page['acceptance']['ready']
    assert not db.scalars(select(RuleResult)).all()
    assert rule_details(db, run) == []  # submitters still see machine facts only


def test_decision_then_separate_acceptance_and_revoke(review):
    db, client, h, task, subject, path = review
    rev, _ = submit(db, task, subject)
    form = dict(decision='approve_exception', scope_rule_id='H-01', reason='签字已人工核对',
                expected_current_revision=rev.id)
    assert client.post(path + '/decisions', headers=h, data=form).status_code == 200
    page = findings(client, h, path)
    assert page['rules'][0]['decision']['reason'] == form['reason']
    assert page['rules'][0]['result'] == 'manual_pending'
    assert page['acceptance'] == dict(ready=True, accepted=False, blockers=[])
    accept = client.post(path + '/decisions', headers=h, data=dict(
        decision='accept_current', reason='本版本全部核对完成', expected_current_revision=rev.id))
    assert accept.status_code == 200, accept.text
    assert findings(client, h, path)['acceptance']['accepted']
    db.expire_all()
    decision_id = page['rules'][0]['decision']['id']
    revoke_decision(db, task, decision_id, '签字需要重新核对')
    db.commit()
    # Revoke is history, never a replacement rule resolution.
    page = findings(client, h, path)
    assert page['rules'][0]['decision'] is None
    assert any('H-01' in b for b in page['acceptance']['blockers'])


@pytest.mark.parametrize('invalid', ['expired', 'revoked', 'old_revision'])
def test_inactive_decisions_do_not_label_current_rule_as_handled(review, invalid):
    db, client, h, task, subject, path = review
    submit(db, task, subject)
    d = record_decision(db, task, subject, decision='approve_exception',
                        scope_rule_id='H-01', reason='旧核对')
    if invalid == 'expired':
        d.expires_at = utcnow() - timedelta(seconds=1)
    elif invalid == 'revoked':
        revoke_decision(db, task, d.id, '撤销核对')
    else:
        submit(db, task, subject, 'v2')
    db.commit()
    page = findings(client, h, path)
    assert page['rules'][0]['decision'] is None
    assert not page['acceptance']['ready']
    if invalid == 'old_revision':
        stale = client.post(path + '/decisions', headers=h, data=dict(
            decision='accept_current', reason='旧版验收', expected_current_revision=d.revision_id))
        assert stale.status_code == 409
