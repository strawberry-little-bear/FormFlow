# -*- coding: utf-8 -*-
# V10 members consistency tests
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.agents.requirements_agent import validate_blueprint
from app.agents.review_agent import CheckContext, run_deterministic
from app.db import engine
from app.main import app
from app.models import (RESULT_ISSUE, RESULT_SATISFIED, RESULT_UNKNOWN,
                        Member, RosterEntry, Subject)
from app.schemas import Blueprint, FieldDef, RuleDef
from app.services import tasks as task_service
from tests.conftest import make_task

RULE = RuleDef(id="M1", statement="申报成员与登记一致",
               requirement_source="申报成员与登记一致",
               executor="deterministic",
               check={"kind": "members_match", "field": "members"})


def _bp():
    return Blueprint(
        fields=[FieldDef(id="members", label="成员")],
        rules=[RuleDef(id="M1", statement="申报成员与登记一致",
                       requirement_source="申报成员与登记一致",
                       executor="deterministic",
                       check={"kind": "members_match", "field": "members"})],
    )


def _ctx(fields=None, members=None):
    return CheckContext(blueprint=_bp(), fields=fields or {},
                        members=members or [], files=[])


def test_members_identical_satisfied():
    r = run_deterministic(RULE, _ctx(fields={"members": "张三、李四"},
                                     members=["张三", "李四"]))
    assert r.result == RESULT_SATISFIED
    assert "一致" in r.explanation


def test_members_mismatch_issue_with_both_sides():
    r = run_deterministic(RULE, _ctx(fields={"members": "张三,王五"},
                                     members=["张三", "李四"]))
    assert r.result == RESULT_ISSUE
    assert "仅申报未登记：王五" in r.explanation
    assert "仅登记未申报：李四" in r.explanation


def test_members_no_roster_unknown():
    r = run_deterministic(RULE, _ctx(fields={"members": "张三"}, members=[]))
    assert r.result == RESULT_UNKNOWN
    assert "登记" in r.explanation


def test_members_not_declared_issue():
    r = run_deterministic(RULE, _ctx(fields={}, members=["张三"]))
    assert r.result == RESULT_ISSUE
    assert "未申报" in r.explanation


def test_validate_members_match_ok_and_ghost_field():
    assert validate_blueprint(_bp()) == []
    bp = _bp()
    bp.rules[0].check["field"] = "ghost"
    errs = validate_blueprint(bp)
    assert any("不存在的字段 ghost" in e for e in errs)


def test_add_members_dedup(db_session):
    task = make_task(db_session, subject_kind="team")
    subj = Subject(task_id=task.id, kind="team", display_name="甲队")
    db_session.add(subj)
    db_session.flush()
    added = task_service.add_members(db_session, subj, ["张三", "李四"])
    assert added == ["张三", "李四"]
    again = task_service.add_members(db_session, subj, ["张三", "赵六"])
    assert again == ["赵六"]
    names = sorted(m.name for m in subj.members)
    assert names == ["张三", "李四", "赵六"]


def test_same_name_subjects_only_other_ids(db_session):
    task = make_task(db_session)
    a = Subject(task_id=task.id, kind="individual", display_name="同名")
    b = Subject(task_id=task.id, kind="individual", display_name="同名")
    c = Subject(task_id=task.id, kind="individual", display_name="其他")
    db_session.add_all([a, b, c])
    db_session.flush()
    same = task_service.same_name_subjects(db_session, task, a)
    assert [x["id"] for x in same] == [b.id]
    assert same[0]["name"] == "同名"
    assert task_service.same_name_subjects(db_session, task, c) == []


@pytest.fixture()
def client():
    with TestClient(app) as c:  # 触发 lifespan：init_db 建表
        yield c


def _register(client, username):
    r = client.post("/api/accounts", data={"username": username, "password": "pw123456"})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": username, "password": "pw123456"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def _mk_task(client, headers, name, subject_kind="individual"):
    r = client.post("/api/tasks", data={"name": name, "subject_kind": subject_kind},
                    headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def test_grant_registers_team_members(client, db_session):
    h = _register(client, "org-m1")
    tid = _mk_task(client, h, "团队赛", subject_kind="team")
    r = client.post("/api/tasks/" + str(tid) + "/grants",
                    data={"subject_name": "甲队", "members": "[\"张三\", \"李四\"]"},
                    headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["members_added"] == ["张三", "李四"]
    sid = body["subject_id"]
    s = Session(engine)
    names = sorted(m.name for m in s.scalars(select(Member).where(
        Member.subject_id == sid)).all())
    s.close()
    assert names == ["张三", "李四"]


def test_grant_resubmit_warns_same_name(client, db_session):
    h = _register(client, "org-m2")
    tid = _mk_task(client, h, "团队赛2", subject_kind="team")
    r1 = client.post("/api/tasks/" + str(tid) + "/grants",
                     data={"subject_name": "甲队", "members": "[\"张三\"]"}, headers=h)
    assert r1.status_code == 200
    assert "warning" not in r1.json()
    r2 = client.post("/api/tasks/" + str(tid) + "/grants",
                     data={"subject_name": "甲队"}, headers=h)
    assert r2.status_code == 200
    assert "此前的凭证失效" in r2.json().get("warning", "")
    assert "相同姓名不自动合并" in r2.json()["warning"]
    assert r2.json()["subject_id"] == r1.json()["subject_id"]
    assert client.get("/api/me", headers={"Authorization": "Bearer " + r1.json()["credential"]}).status_code == 401
    assert client.get("/api/me", headers={"Authorization": "Bearer " + r2.json()["credential"]}).status_code == 200


def test_roster_reissue_uses_bound_subject_for_duplicate_names(client, db_session):
    h = _register(client, "org-m2-bound")
    tid = _mk_task(client, h, "同名主体")
    first = client.post("/api/tasks/" + str(tid) + "/grants",
                        data={"subject_name": "同名"}, headers=h)
    assert first.status_code == 200
    first_subject_id = first.json()["subject_id"]

    bound = Subject(task_id=tid, kind="individual", display_name="同名")
    db_session.add(bound)
    db_session.flush()
    entry = RosterEntry(task_id=tid, name="同名", subject_id=bound.id)
    db_session.add(entry)
    db_session.commit()

    second = client.post("/api/tasks/" + str(tid) + "/grants",
                         data={"subject_name": "同名", "roster_entry_id": str(entry.id)}, headers=h)
    assert second.status_code == 200
    assert second.json()["subject_id"] == bound.id
    assert second.json()["subject_id"] != first_subject_id
    assert client.get("/api/me", headers={"Authorization": "Bearer " + first.json()["credential"]}).status_code == 200
    assert client.get("/api/me", headers={"Authorization": "Bearer " + second.json()["credential"]}).status_code == 200



def test_grant_individual_ignores_members(client, db_session):
    h = _register(client, "org-m3")
    tid = _mk_task(client, h, "个人赛")
    r = client.post("/api/tasks/" + str(tid) + "/grants",
                    data={"subject_name": "张三", "members": "[\"李四\"]"}, headers=h)
    assert r.status_code == 200
    assert "members_added" not in r.json()
    s = Session(engine)
    assert s.scalars(select(Member)).all() == []
    s.close()


def _add_two_same_name(tid):
    s = Session(engine)
    a = Subject(task_id=tid, kind="individual", display_name="同名")
    b = Subject(task_id=tid, kind="individual", display_name="同名")
    c = Subject(task_id=tid, kind="individual", display_name="其他")
    s.add_all([a, b, c])
    s.commit()
    ids = (a.id, b.id, c.id)
    s.close()
    return ids


def test_findings_same_name_hint(client, db_session):
    h = _register(client, "org-m4")
    tid = _mk_task(client, h, "同名任务")
    a_id, b_id, c_id = _add_two_same_name(tid)
    r = client.get("/api/tasks/" + str(tid) + "/subjects/" + str(a_id) + "/findings",
                   headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["id"] for x in body["same_name_subjects"]] == [b_id]
    assert body["same_name_hint"]
    r = client.get("/api/tasks/" + str(tid) + "/subjects/" + str(c_id) + "/findings",
                   headers=h)
    body = r.json()
    assert body["same_name_subjects"] == []
    assert body["same_name_hint"] == ""


def test_decision_returns_same_name(client, db_session):
    h = _register(client, "org-m5")
    tid = _mk_task(client, h, "决定任务")
    a_id, b_id, _c_id = _add_two_same_name(tid)
    scope = client.get(f"/api/tasks/{tid}/subjects/{a_id}/findings", headers=h).json()["review_context"]
    r = client.post("/api/tasks/" + str(tid) + "/subjects/" + str(a_id) + "/decisions",
                    data={"decision": "exempt", "reason": "同名待核", "expected_current_revision": 0, "expected_review_context": scope}, headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert [x["id"] for x in body["same_name_subjects"]] == [b_id]
    assert body["same_name_hint"]
