"""Formal receipt requires structural completeness, while partial drafts stay editable."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.main import app
from app.models import BlueprintVersion, CheckRun, Revision, Subject
from app.schemas import Blueprint, FieldDef, SlotDef
from app.security import utcnow
from app.services import submissions as sub
from app.services import tasks
from tests.conftest import make_task, publish_blueprint


@pytest.fixture()
def scenario(db_session):
    db = db_session
    task = make_task(db, first_deadline=utcnow() + timedelta(days=1))
    bp = Blueprint(fields=[
        FieldDef(id='name', label='姓名'),
        FieldDef(id='track', label='赛道', type='enum', options=['数字', '实物', '特殊'], required=False),
        FieldDef(id='address', label='地址', required_condition='track==实物'),
        FieldDef(id='count', label='数量', type='number', required=False),
    ], slots=[SlotDef(id='report', label='报告', formats=['txt'], max_count=1, max_size_mib=1),
              SlotDef(id='photo', label='实物照片', required_condition='track==实物', max_count=2)])
    publish_blueprint(db, task, bp)
    subject = Subject(task_id=task.id, kind='individual', display_name='测试主体')
    db.add(subject)
    db.flush()
    submission = sub.get_or_create_draft(db, task, subject.id)
    return db, task, subject, submission


def file(db, submission, slot='report', name='report.txt', content=b'report'):
    return sub.attach_file(db, submission, slot=slot, original_name=name,
                           content=content, sha256='', mime='text/plain')


def formal(scenario, fields=None, files=None, key='submit'):
    db, task, _, submission = scenario
    return sub.formal_submit(db, task, submission, fields=fields or {},
                             slot_file_ids=files or {}, idempotency_key=key)


def test_missing_fields_and_slots_are_aggregated_without_mutations(scenario):
    db, _, _, submission = scenario
    sub.save_draft(db, submission, {'name': 'draft'}, slot_file_ids={})
    version = submission.draft_version
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '  ', 'track': '实物'})
    assert {(i['target'], i['id'], i['code']) for i in e.value.issues} == {
        ('field', 'name', 'required'), ('field', 'address', 'required'),
        ('slot', 'report', 'required'), ('slot', 'photo', 'required')}
    assert submission.current_revision_id is None
    assert submission.draft_version == version
    assert sub.read_draft(db, submission)['fields'] == {'name': 'draft'}
    assert db.scalar(select(func.count()).select_from(Revision)) == 0
    assert db.scalar(select(func.count()).select_from(CheckRun)) == 0


@pytest.mark.parametrize('blank', [None, '', ' \t\n', [], {}])
def test_required_empty_values_cannot_bypass_gate(scenario, blank):
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': blank})
    assert any(i['id'] == 'name' and i['code'] == 'required' for i in e.value.issues)


def test_zero_and_inactive_conditional_items_are_valid(scenario):
    db, _, _, submission = scenario
    f = file(db, submission)
    bp = Blueprint.model_validate_json(db.get(BlueprintVersion, scenario[1].current_blueprint_id).blueprint_json)
    bp.fields[-1].required = True
    db.get(BlueprintVersion, scenario[1].current_blueprint_id).blueprint_json = bp.model_dump_json()
    rev = formal(scenario, {'name': '测试', 'count': 0, 'track': '数字'}, {'report': [f.file_id]})
    assert rev.version == 1


def test_condition_boolean_combinations_use_backend_check_semantics(scenario):
    db, task, _, submission = scenario
    bp = Blueprint.model_validate_json(db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json)
    bp.slots[1].required_condition = "track==实物 and name!=免交 or track==特殊"
    db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json = bp.model_dump_json()
    f = file(db, submission)
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试', 'track': '特殊'}, {'report': [f.file_id]})
    assert any(i['id'] == 'photo' and i['code'] == 'required' for i in e.value.issues)
    assert formal(scenario, {'name': '免交', 'track': '数字'}, {'report': [f.file_id]}).version == 1


@pytest.mark.parametrize('manifest,code', [
    ({'report': 'bad'}, 'invalid_files'),
    ({'report': [123]}, 'invalid_files'),
    ({'report': [{'file_id': 'bad'}]}, 'invalid_files'),
    ({'ghost': ['bad']}, 'unknown_slot'),
    ({'report': ['missing']}, 'invalid_file'),
])
def test_bad_manifests_return_located_errors_not_500(scenario, manifest, code):
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试'}, manifest)
    assert any(i['target'] == 'slot' and i['code'] == code for i in e.value.issues)


def test_duplicates_count_wrong_slot_and_failed_file_are_rejected(scenario):
    db, _, _, submission = scenario
    one = file(db, submission)
    two = file(db, submission, name='two.txt')
    photo = file(db, submission, slot='photo')
    for ids, expected in [([one.file_id, one.file_id], 'duplicate_file'),
                          ([one.file_id, two.file_id], 'max_count'),
                          ([photo.file_id], 'invalid_file')]:
        with pytest.raises(sub.SubmissionValidationError) as e:
            formal(scenario, {'name': '测试'}, {'report': ids})
        assert any(i['id'] == 'report' and i['code'] == expected for i in e.value.issues)
    one.status = 'failed'
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试'}, {'report': [one.file_id]})
    assert e.value.issues[0]['code'] == 'failed_file'


def test_foreign_file_does_not_leak_its_name(scenario):
    db, task, _, _ = scenario
    other = Subject(task_id=task.id, kind='individual', display_name='另一主体')
    db.add(other)
    db.flush()
    f = file(db, sub.get_or_create_draft(db, task, other.id), name='private-name.txt')
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试'}, {'report': [f.file_id]})
    assert e.value.issues[0]['code'] == 'invalid_file'
    assert 'private-name' not in str(e.value)


def test_current_blueprint_constraints_rechecked_and_idempotent_receipt_preserved(scenario):
    db, task, _, submission = scenario
    f = file(db, submission)
    fields, files = {'name': '测试'}, {'report': [f.file_id]}
    rev = formal(scenario, fields, files)
    bp = Blueprint.model_validate_json(db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json)
    bp.fields.append(FieldDef(id='new', label='新要求'))
    bp.slots[0].formats = ['pdf']
    bp.slots[0].max_size_mib = 0.000001
    db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json = bp.model_dump_json()
    assert formal(scenario, fields, files).id == rev.id
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, fields, files, key='v2')
    assert {i['code'] for i in e.value.issues} == {'required', 'file_constraints'}
    assert submission.current_revision_id == rev.id
    assert db.scalar(select(func.count()).select_from(Revision)) == 1
    bp.slots[0].formats = ['txt']
    db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json = bp.model_dump_json()
    with pytest.raises(sub.SubmissionValidationError, match='不能超过'):
        formal(scenario, {'name': '测试', 'new': '已填'}, files, key='v2')


def test_unsupported_conditions_are_visible_not_silently_optional(scenario):
    db, task, _, submission = scenario
    bp = Blueprint.model_validate_json(db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json)
    bp.fields[0].required_condition = 'len(name)>0'
    bp.slots[0].required_condition = 'track in [实物]'
    db.get(BlueprintVersion, task.current_blueprint_id).blueprint_json = bp.model_dump_json()
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试'})
    assert len([i for i in e.value.issues if i['code'] == 'unsupported_condition']) == 2


def test_api_errors_locate_items_partial_draft_and_retry_share_contract(scenario):
    db, task, subject, _ = scenario
    token = tasks.issue_grant(db, task, subject)
    db.commit()
    headers = {'Authorization': 'Bearer ' + token}
    with TestClient(app) as client:
        r = client.post('/api/me/submit', headers=headers, json={
            'fields': {}, 'slot_file_ids': {}, 'idempotency_key': 'api'})
        assert r.status_code == 422, r.text
        assert r.json()['detail']['code'] == 'submission_validation'
        assert {i['id'] for i in r.json()['detail']['issues']} == {'name', 'report'}
        assert client.get('/api/me/receipt', headers=headers).json() == {'formal': False}
        draft = client.post('/api/me/draft', headers=headers, json={
            'fields': {'track': '数字'}, 'slot_file_ids': {}, 'expected_version': 1})
        assert draft.status_code == 200, draft.text
        assert client.get('/api/me/draft', headers=headers).json()['fields'] == {'track': '数字'}
        uploaded = client.post('/api/me/files', headers=headers, data={'slot': 'report'},
                               files={'file': ('report.txt', b'test', 'text/plain')})
        assert uploaded.status_code == 200, uploaded.text
        payload = {'fields': {'name': '测试', 'track': '数字'},
                   'slot_file_ids': {'report': [uploaded.json()['file_id']]}, 'idempotency_key': 'api'}
        r = client.post('/api/me/submit', headers=headers, json=payload)
        assert r.status_code == 200, r.text
        again = client.post('/api/me/submit', headers=headers, json=payload)
        assert again.json() == r.json()
        db.expire_all()
        assert db.scalar(select(func.count()).select_from(Revision)) == 1
        assert db.scalar(select(func.count()).select_from(CheckRun)) == 1
        # Lost success response can still recover its receipt after task closure.
        db.get(type(task), task.id).status = 'closed'
        db.commit()
        recovered = client.post('/api/me/submit', headers=headers, json=payload)
        assert recovered.status_code == 200, recovered.text
        assert recovered.json() == r.json()


@pytest.mark.parametrize('invalid', ['其他', ['实物'], {'track': '实物'}, 123])
def test_invalid_enum_cannot_bypass_conditional_requirements(scenario, invalid):
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试', 'track': invalid})
    assert any(i['target'] == 'field' and i['id'] == 'track' and i['code'] == 'invalid_option'
               for i in e.value.issues)


def test_condition_values_trim_whitespace_consistently(scenario):
    with pytest.raises(sub.SubmissionValidationError) as e:
        formal(scenario, {'name': '测试', 'track': ' 实物 '})
    assert {i['id'] for i in e.value.issues} == {'address', 'photo', 'report'}


def test_optional_enum_whitespace_is_empty_like_frontend(scenario):
    db, _, _, submission = scenario
    f = file(db, submission)
    assert formal(scenario, {'name': '测试', 'track': ' \t '},
                  {'report': [f.file_id]}).version == 1
