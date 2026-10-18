# -*- coding: utf-8 -*-
"""澄清轮次闭环测试（G2 / 方案第 3 节：澄清要求 → 确认蓝图）。

- 组织者回答澄清后基于当前草案修订，产生新草案版本，历史不被篡改；
- 已回答的澄清与当前草案进入修订提示；
- 无实质变化（含模型不可用降级）不制造新版本；
- 修改影响按稳定 ID 结构化呈现；
- API 层校验 answered 格式与归属。
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.agents.requirements_agent import blueprint_diff, draft_blueprint
from app.main import app
from app.models import AuditEvent, BlueprintVersion, Task
from app.schemas import Blueprint, DraftResult
from app.services import tasks as task_service
from tests.conftest import StubLLM

REQUIREMENT = "请名册内同学提交 2026 秋季第 1 期团课报告，包含姓名和期次，PDF 或 DOCX，11 月 8 日 18:00 前提交。"


class CapturingLLM(StubLLM):
    def __init__(self, responses=None, error=None):
        super().__init__(responses=responses, error=error)
        self.messages: list[list[dict]] = []

    def chat(self, messages, temperature=0.2):
        self.messages.append([dict(m) for m in messages])
        return super().chat(messages, temperature)


def _draft_payload(rules_extra=None, clarifications=None):
    rules = [
        {"id": "C-R01", "statement": "材料格式与大小符合要求",
         "requirement_source": "PDF 或 DOCX", "executor": "deterministic",
         "capability": "supported", "check": {"kind": "slot_constraints", "slot": "report"}},
    ]
    if rules_extra:
        rules.extend(rules_extra)
    return {
        "blueprint": {
            "task_scope": {"name": "团课报告收集", "mode": "roster", "subject_kind": "individual"},
            "fields": [{"id": "name", "label": "姓名", "required": True}],
            "slots": [{"id": "report", "label": "报告", "formats": ["pdf", "docx"],
                       "max_count": 1, "max_size_mib": 10}],
            "rules": rules,
            "time_policy": {"timezone": "Asia/Shanghai"},
        },
        "clarifications": clarifications or [],
        "publish_summary": ["对象：名册内同学"],
    }


def _make_task_with_draft(db, stub):
    task = Task(name="团课报告", mode="roster", subject_kind="individual",
                timezone="Asia/Shanghai", created_by=None, status="draft")
    db.add(task)
    db.flush()
    result = draft_blueprint(REQUIREMENT, client=stub)
    bp = task_service.save_draft(db, task, result)
    db.flush()
    return task, bp


# ---------------------------------------------------------------- 服务层
def test_clarification_loop_closes(db_session):
    """回答澄清 → 修订 → 新版本不再带该澄清；提示中含已回答与当前草案。"""
    stub = CapturingLLM(responses=[
        _draft_payload(clarifications=[
            {"question": "截止时间是 11 月 8 日 18:00 吗？", "why": "影响时间策略",
             "affects_rule_ids": []},
            {"question": "是否需要同时提交查重报告？", "why": "影响材料槽位",
             "affects_rule_ids": []},
        ]),
        _draft_payload(rules_extra=[
            {"id": "C-R02", "statement": "报告期次与登记一致",
             "requirement_source": "2026 秋季第 1 期团课报告",
             "executor": "semantic", "capability": "supported"},
        ]),
    ])
    task, bp1 = _make_task_with_draft(db_session, stub)
    first = Blueprint.model_validate_json(bp1.blueprint_json)
    assert bp1.version == 1

    answered = {"截止时间是 11 月 8 日 18:00 吗？": "是，11 月 8 日 18:00",
                "是否需要同时提交查重报告？": "不需要"}
    result, bp2, impact = task_service.revise_draft(
        db_session, task, bp1.id, requirement=REQUIREMENT, answered=answered,
        client=stub)

    # 新版本、历史保留
    assert bp2.id != bp1.id and bp2.version == 2
    assert db_session.get(BlueprintVersion, bp1.id).blueprint_json == bp1.blueprint_json
    # 澄清已闭环：修订后的草案不再带这两条澄清
    assert [c.question for c in result.clarifications] == []
    # 修订提示包含已回答澄清与当前草案
    revise_call = stub.messages[1][1]["content"]
    assert "【组织者已回答的澄清】" in revise_call
    assert "11 月 8 日 18:00" in revise_call
    assert "【当前草案】" in revise_call
    # 修改影响：新增一条规则
    assert impact["rules"]["added"] == ["C-R02"]
    assert impact["rules"]["changed"] == []
    assert "rules+1" in impact["summary"]
    # 审计记录澄清轮次
    audits = db_session.scalars(select(AuditEvent).where(
        AuditEvent.task_id == task.id, AuditEvent.action == "blueprint.revised")).all()
    assert len(audits) == 1
    payload = json.loads(audits[0].payload_json)
    assert payload["from_version"] == 1 and payload["to_version"] == 2
    assert len(payload["answered"]) == 2


def test_revise_keeps_draft_when_llm_unavailable(db_session):
    """模型不可用：保留原草案、不制造新版本、给警告。"""
    from app.llm import LLMUnavailable

    ok = CapturingLLM(responses=[_draft_payload()])
    task, bp1 = _make_task_with_draft(db_session, ok)
    bad = CapturingLLM(error=LLMUnavailable("网关 503"))
    result, bp, impact = task_service.revise_draft(
        db_session, task, bp1.id, requirement=REQUIREMENT,
        answered={"截止时间是 11 月 8 日 18:00 吗？": "是"}, client=bad)
    assert bp.id == bp1.id  # 不制造新版本
    assert any("暂不可用" in w for w in result.warnings)
    versions = db_session.scalars(select(BlueprintVersion)).all()
    assert len(versions) == 1


def test_revise_noop_when_content_identical(db_session):
    """修订结果与原草案一致：不制造新版本。"""
    stub = CapturingLLM(responses=[_draft_payload()])
    task, bp1 = _make_task_with_draft(db_session, stub)
    stub.responses = [_draft_payload()]  # 修订返回同样内容
    result, bp, impact = task_service.revise_draft(
        db_session, task, bp1.id, requirement=REQUIREMENT, client=stub)
    assert bp.id == bp1.id
    assert impact["summary"] == "无实质变化"
    versions = db_session.scalars(select(BlueprintVersion)).all()
    assert len(versions) == 1


def test_revise_rejects_foreign_blueprint(db_session):
    """蓝图版本不属于该任务 → 拒绝（稳定 ID 不替代授权校验）。"""
    stub = CapturingLLM(responses=[_draft_payload()])
    task, bp1 = _make_task_with_draft(db_session, stub)
    other = Task(name="别的任务", mode="roster", subject_kind="individual",
                 timezone="Asia/Shanghai", created_by=None, status="draft")
    db_session.add(other)
    db_session.flush()
    with pytest.raises(ValueError):
        task_service.revise_draft(db_session, other, bp1.id, requirement=REQUIREMENT)


def test_blueprint_diff_details():
    """diff 按稳定 ID 报告新增/移除/变更，含能力与时间策略变化。"""
    old = Blueprint(
        fields=[{"id": "name", "label": "姓名"}],
        slots=[{"id": "report", "label": "报告"}],
        rules=[{"id": "C-R01", "statement": "s", "requirement_source": "s",
                "executor": "semantic"}],
    )
    new = Blueprint(
        fields=[{"id": "name", "label": "姓名"}, {"id": "term", "label": "期次"}],
        slots=[{"id": "report", "label": "报告"}],
        rules=[{"id": "C-R01", "statement": "s", "requirement_source": "s",
                "executor": "deterministic", "check": {"kind": "slot_presence", "slot": "report"}}],
    )
    diff = blueprint_diff(old, new)
    assert diff["fields"]["added"] == ["term"]
    assert diff["rules"]["changed"] == ["C-R01"]
    assert diff["rules"]["added"] == [] and diff["rules"]["removed"] == []
    assert "fields+1" in diff["summary"] and "rules~1" in diff["summary"]


# ---------------------------------------------------------------- API 层
@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def _register(client, username, password="pw123456"):
    assert client.post("/api/accounts",
                       data={"username": username, "password": password}).status_code == 200
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mk_task(client, headers, name="团课报告"):
    r = client.post("/api/tasks", data={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def test_api_revise_validates_input(client, db_session):
    headers = _register(client, "org-rev")
    task_id = _mk_task(client, headers)
    base = f"/api/tasks/{task_id}/draft/revise"
    # answered 不是 JSON
    r = client.post(base, data={"blueprint_version_id": 1, "answered": "{oops"},
                    headers=headers)
    assert r.status_code == 422
    # answered 不是对象
    r = client.post(base, data={"blueprint_version_id": 1, "answered": "[1,2]"},
                    headers=headers)
    assert r.status_code == 422
    # 蓝图版本不存在
    r = client.post(base, data={"blueprint_version_id": 999, "answered": "{}"},
                    headers=headers)
    assert r.status_code == 404


def test_api_revise_happy_path(client, db_session, monkeypatch):
    """澄清回答经 API 进入修订流程，返回新版本与修改影响。"""
    headers = _register(client, "org-rev2")
    task_id = _mk_task(client, headers)
    # 先用模板造一个草案版本
    r = client.post(f"/api/tasks/{task_id}/draft/template",
                    data={"template": "class_report"}, headers=headers)
    assert r.status_code == 200, r.text
    bp_id = r.json()["blueprint_version_id"]

    revised = DraftResult(
        blueprint=Blueprint(
            task_scope={"name": "团课报告收集"},
            fields=[{"id": "name", "label": "姓名"}, {"id": "term", "label": "期次"},
                    {"id": "class_name", "label": "班级"}, {"id": "contact", "label": "联系人"}],
        ),
        publish_summary=["对象：名册内同学"],
    )
    monkeypatch.setattr(task_service, "draft_blueprint",
                        lambda *a, **k: revised)
    r = client.post(f"/api/tasks/{task_id}/draft/revise",
                    data={"blueprint_version_id": bp_id,
                          "requirement": REQUIREMENT,
                          "answered": json.dumps({"截止时间是 11 月 8 日 18:00 吗？": "是"},
                                                 ensure_ascii=False)},
                    headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == 2
    assert body["impact"]["fields"]["added"] == ["contact"]
    assert body["draft"]["blueprint"]["fields"][-1]["id"] == "contact"


def test_api_revise_rejects_other_users_blueprint(client, db_session):
    """他人任务的蓝图版本 → 404（不泄露存在性）。"""
    h1 = _register(client, "org-a")
    h2 = _register(client, "org-b")
    t1 = _mk_task(client, h1, "任务A")
    r = client.post(f"/api/tasks/{t1}/draft/template",
                    data={"template": "class_report"}, headers=h1)
    bp_id = r.json()["blueprint_version_id"]
    t2 = _mk_task(client, h2, "任务B")
    r = client.post(f"/api/tasks/{t2}/draft/revise",
                    data={"blueprint_version_id": bp_id, "answered": "{}"}, headers=h2)
    assert r.status_code == 404
