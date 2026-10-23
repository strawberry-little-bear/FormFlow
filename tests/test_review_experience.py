"""Organizer review: manual tasks, decision overlays and explicit acceptance state."""
import json
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.main import app
from app.models import Account, AuditEvent, BlueprintVersion, FileObject, RuleResult, Subject
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.security import utcnow
from app.services.checks import create_run, execute_run, rule_details
from app.services.decisions import record_decision, revoke_decision
from app.services.submissions import attach_file, formal_submit, get_or_create_draft
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


def submit(db, task, subject, key='v1', fields=None, client=None):
    revision = formal_submit(db, task, get_or_create_draft(db, task, subject.id),
                             fields=fields or {}, slot_file_ids={}, idempotency_key=key)
    run = create_run(db, task, revision)
    execute_run(db, run, client)
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
    assert page['tool_trace'] == []
    assert page['acceptance'] == dict(ready=False, accepted=False, blockers=['没有正式提交版本'])
    assert page['files'] == []


def test_review_exposes_only_current_formal_files_and_serves_original(review):
    db, client, h, task, subject, path = review
    blueprint = Blueprint(
        slots=[SlotDef(id='report', label='团课报告', formats=['txt'], max_count=2)],
        rules=[RuleDef(id='H-01', statement='人工核对签字', requirement_source='任务说明', executor='human_only')],
    )
    version = BlueprintVersion(task_id=task.id, version=2, status='published',
                               blueprint_json=blueprint.model_dump_json())
    db.add(version)
    db.flush()
    task.current_blueprint_id = version.id
    submission = get_or_create_draft(db, task, subject.id)
    old_file = attach_file(db, submission, slot='report', original_name='旧版本.txt',
                           content='old evidence'.encode(), sha256='', mime='text/plain')
    formal_submit(db, task, submission, fields={},
                  slot_file_ids={'report': [old_file.file_id]}, idempotency_key='review-file-v1')
    new_file = attach_file(db, submission, slot='report', original_name='当前版本-很长的材料文件名.txt',
                           content='current evidence'.encode(), sha256='', mime='text/plain')
    second = formal_submit(db, task, submission, fields={},
                           slot_file_ids={'report': [new_file.file_id]}, idempotency_key='review-file-v2')
    db.commit()

    page = findings(client, h, path)
    assert page['revision']['id'] == second.id
    assert [item['file_id'] for item in page['files']] == [new_file.file_id]
    assert page['files'][0]['name'] == '当前版本-很长的材料文件名.txt'
    assert page['files'][0]['slot'] == '团课报告'
    assert page['files'][0]['url'].endswith(f'/files/{new_file.file_id}')

    served = client.get(page['files'][0]['url'], headers=h)
    assert served.status_code == 200, served.text
    assert served.content == b'current evidence'
    assert served.headers['content-type'].startswith('text/plain')
    assert served.headers['content-disposition'].startswith('inline;')

    assert client.get(f'{path}/files/{old_file.file_id}', headers=h).status_code == 404
    assert client.get(f'{path}/files/{new_file.file_id}-other', headers=h).status_code == 404
    assert db.scalar(select(FileObject).where(FileObject.file_id == old_file.file_id)) is not None


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


def test_findings_exposes_only_the_active_runs_audited_tool_trace(review, stub_llm):
    db, client, headers, task, subject, path = review
    blueprint = Blueprint(
        fields=[FieldDef(id='name', label='姓名')],
        rules=[RuleDef(id='D-01', statement='姓名必填', requirement_source='报名表需登记姓名',
                       executor='deterministic', check={'kind': 'field_required', 'field': 'name'})],
    )
    version = BlueprintVersion(task_id=task.id, version=2, status='published',
                               blueprint_json=blueprint.model_dump_json())
    db.add(version)
    db.flush()
    task.current_blueprint_id = version.id
    db.commit()

    stub_llm.is_simulation = True
    revision, first_run = submit(db, task, subject, fields={'name': '测试主体'}, client=stub_llm)
    page = findings(client, headers, path)
    assert page['run']['id'] == first_run.id
    assert len(page['tool_trace']) == 1
    trace = page['tool_trace'][0]
    assert trace['tool'] == 'review.deterministic_rule'
    assert trace['rule_id'] == 'D-01'
    assert trace['status'] == 'satisfied'
    assert trace['simulation'] is True
    assert trace['sequence'] == 1
    assert trace['tool_version'] == 'v1'
    assert trace['correlation_id'] == f'review-run:{first_run.id}'
    assert 'arguments' not in trace and 'result' not in trace
    event = db.scalar(select(AuditEvent).where(
        AuditEvent.task_id == task.id, AuditEvent.action == 'agent.tool.invoked'))
    owner_id = db.scalar(select(Account.id).where(Account.username == 'review-ux'))
    assert event.actor == f'review_agent:account:{owner_id}'
    assert json.loads(event.payload_json)['rule_id'] == 'D-01'
    assert json.loads(event.payload_json)['sequence'] == 1
    assert json.loads(event.payload_json)['tool_version'] == 'v1'

    # Starting a new run must not present the earlier run's tool trace as current.
    next_run = create_run(db, task, revision)
    db.commit()
    current = findings(client, headers, path)
    assert current['run']['id'] == next_run.id
    assert current['tool_trace'] == []


def test_decision_then_separate_acceptance_and_revoke(review):
    db, client, h, task, subject, path = review
    rev, _ = submit(db, task, subject)
    form = dict(decision='approve_exception', scope_rule_id='H-01', reason='签字已人工核对',
                expected_current_revision=rev.id, expected_review_context=findings(client, h, path)['review_context'])
    assert client.post(path + '/decisions', headers=h, data=form).status_code == 200
    page = findings(client, h, path)
    assert page['rules'][0]['decision']['reason'] == form['reason']
    assert page['rules'][0]['result'] == 'manual_pending'
    assert page['acceptance'] == dict(ready=True, accepted=False, blockers=[])
    accept = client.post(path + '/decisions', headers=h, data=dict(
        decision='accept_current', reason='本版本全部核对完成', expected_current_revision=rev.id,
        expected_review_context=page['review_context']))
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
            decision='accept_current', reason='旧版验收', expected_current_revision=d.revision_id,
            expected_review_context=page['review_context']))
        assert stale.status_code == 409


@pytest.mark.parametrize('change', ['member_add', 'member_name', 'member_extra', 'member_remove',
                                    'subject', 'blueprint', 'revision', 'run'])
def test_changed_review_scope_rejects_old_reason_without_creating_decision(review, change):
    from app.models import Member, ManualDecision
    db, client, h, task, subject, path = review
    rev, _ = submit(db, task, subject)
    member = Member(subject_id=subject.id, name='原成员', extra_json='{"role":"leader"}')
    db.add(member)
    db.commit()
    before = findings(client, h, path)
    if change == 'member_add':
        db.add(Member(subject_id=subject.id, name='新成员'))
    elif change == 'member_name':
        member.name = '替换成员'
    elif change == 'member_extra':
        member.extra_json = '{"role":"other"}'
    elif change == 'member_remove':
        db.delete(member)
    elif change == 'subject':
        subject.display_name = '新主体名称'
    elif change == 'blueprint':
        newer = BlueprintVersion(task_id=task.id, version=2, status='published',
                                  blueprint_json=Blueprint().model_dump_json())
        db.add(newer)
        db.flush()
        task.current_blueprint_id = newer.id
    elif change == 'revision':
        submit(db, task, subject, 'v2')
    elif change == 'run':
        create_run(db, task, rev)
    db.commit()
    after = findings(client, h, path)
    assert before['review_context'] != after['review_context']
    result = client.post(path + '/decisions', headers=h, data=dict(
        decision='approve_exception', scope_rule_id='H-01', reason='旧范围理由',
        expected_current_revision=rev.id, expected_review_context=before['review_context']))
    assert result.status_code == 409, result.text
    assert not db.scalars(select(ManualDecision)).all()


def test_review_scope_is_stable_and_can_submit_when_unchanged(review):
    db, client, h, task, subject, path = review
    rev, _ = submit(db, task, subject)
    page = findings(client, h, path)
    assert page['review_context'] == findings(client, h, path)['review_context']
    assert len(page['review_context']) == 64
    result = client.post(path + '/decisions', headers=h, data=dict(
        decision='approve_exception', scope_rule_id='H-01', reason='本范围已核对',
        expected_current_revision=rev.id, expected_review_context=page['review_context']))
    assert result.status_code == 200, result.text
    # A decision does not change evidence scope or invalidate another rule's note.
    assert findings(client, h, path)['review_context'] == page['review_context']


def test_public_decision_requires_review_context(review):
    db, client, h, task, subject, path = review
    rev, _ = submit(db, task, subject)
    response = client.post(path + '/decisions', headers=h, data=dict(
        decision='confirm_pass', scope_rule_id='H-01', reason='缺范围不能保存',
        expected_current_revision=rev.id))
    assert response.status_code == 422
    assert '复核范围' in response.json()['detail']


def test_review_context_is_account_scoped(review):
    from app.services.review_context import review_context
    db, _, _, task, subject, _ = review
    assert review_context(db, task, subject, 1) != review_context(db, task, subject, 2)
