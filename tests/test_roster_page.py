"""名单管理页与凭证发放关联测试（P01/P02：名册计数、名单页数据、按条目发放凭证）。

方案口径：名册 = 应交 + 有效免交；应交 = 已正式提交 + 未正式提交；
验收/补正/人工待办都是已提交的子集，不能相加成总人数。
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import Base, engine
from app.main import app
from app.models import EXEMPTION_ACTIVE, Exemption, RosterEntry, Subject


@pytest.fixture()
def client():
    with TestClient(app) as c:  # 触发 lifespan：init_db 建表
        yield c


def _register(client, username, password="pw123456"):
    r = client.post("/api/accounts", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mk_task(client, headers, name="团课报告"):
    r = client.post("/api/tasks", data={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def _import_roster(client, headers, task_id, entries):
    r = client.post(f"/api/tasks/{task_id}/roster", json=entries, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def _grant(client, headers, task_id, name, entry_id=None):
    form = {"subject_name": name}
    if entry_id is not None:
        form["roster_entry_id"] = str(entry_id)
    r = client.post(f"/api/tasks/{task_id}/grants", data=form, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def test_roster_view_counts_and_flags(client, db_session):
    """名单页：名册总数/已发放/免交/待发放，四个计数互不重复计算。"""
    h = _register(client, "org-roster")
    tid = _mk_task(client, h)
    _import_roster(client, h, tid, [
        {"name": "张三", "ref": "一班"},
        {"name": "李四", "ref": "一班"},
        {"name": "王五", "ref": "二班"},
        {"name": "赵六", "ref": "二班"},
    ])
    _grant(client, h, tid, "张三", entry_id=1)
    _grant(client, h, tid, "李四", entry_id=2)
    r = client.get(f"/api/tasks/{tid}/roster", headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["total"] == 4 and d["granted"] == 2 and d["exempt"] == 0
    by_name = {e["name"]: e for e in d["entries"]}
    assert by_name["张三"]["granted"] is True and by_name["张三"]["subject_id"]
    assert by_name["王五"]["granted"] is False and by_name["王五"]["subject_id"] is None
    assert by_name["张三"]["ref"] == "一班"


def test_grant_links_roster_entry_and_rejects_foreign_entry(client, db_session):
    """按名册条目发放凭证：条目精确关联主体；跨任务/不存在条目 404。"""
    h = _register(client, "org-grant")
    tid = _mk_task(client, h)
    _import_roster(client, h, tid, [{"name": "张三"}, {"name": "李四"}])
    g = _grant(client, h, tid, "张三", entry_id=1)
    s = Session(engine)
    entry = s.get(RosterEntry, 1)
    assert entry.subject_id == g["subject_id"]
    # 同名复用：再次发放同一名字，仍关联同一条目
    g2 = _grant(client, h, tid, "张三", entry_id=1)
    assert g2["subject_id"] == g["subject_id"]
    s.close()
    # 不存在的条目
    r = client.post(f"/api/tasks/{tid}/grants",
                    data={"subject_name": "张三", "roster_entry_id": "999"}, headers=h)
    assert r.status_code == 404
    # 属于别的任务的条目
    tid2 = _mk_task(client, h, name="另一个任务")
    _import_roster(client, h, tid2, [{"name": "外人"}])
    r = client.post(f"/api/tasks/{tid}/grants",
                    data={"subject_name": "张三", "roster_entry_id": "3"}, headers=h)
    assert r.status_code == 404


def test_exempt_entry_excluded_from_pending(client, db_session):
    """有效免交主体：计入免交，不再计入待发放。"""
    h = _register(client, "org-exempt")
    tid = _mk_task(client, h)
    _import_roster(client, h, tid, [{"name": "张三"}, {"name": "李四"}])
    _grant(client, h, tid, "张三", entry_id=1)
    _grant(client, h, tid, "李四", entry_id=2)
    s = Session(engine)
    subj = s.scalar(select(Subject).where(Subject.display_name == "李四"))
    s.add(Exemption(task_id=tid, subject_id=subj.id, kind="exempt",
                    status=EXEMPTION_ACTIVE, reason="兵役"))
    s.commit()
    s.close()
    d = client.get(f"/api/tasks/{tid}/roster", headers=h).json()
    assert d["total"] == 2 and d["granted"] == 2 and d["exempt"] == 1
    by_name = {e["name"]: e for e in d["entries"]}
    assert by_name["李四"]["exempt"] is True
    assert by_name["张三"]["exempt"] is False
    # 待发放 = total - granted - exempt，不会为负
    assert max(0, d["total"] - d["granted"] - d["exempt"]) == 0


def test_cross_organizer_roster_denied(client, db_session):
    """组织者 B 读不到组织者 A 的名册（稳定 ID 不替代授权校验）。"""
    ha = _register(client, "owner-r")
    hb = _register(client, "other-r")
    tid = _mk_task(client, ha)
    _import_roster(client, ha, tid, [{"name": "张三"}])
    assert client.get(f"/api/tasks/{tid}/roster", headers=hb).status_code == 404


def test_draft_template_returns_full_blueprint(client, db_session, monkeypatch):
    """模板起草返回完整蓝图：名单页/设计台可直接渲染结构化面板。"""
    h = _register(client, "org-tpl")
    tid = _mk_task(client, h)
    r = client.post(f"/api/tasks/{tid}/draft/template",
                    data={"template": "class_report"}, headers=h)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["blueprint_version_id"] and d["version"] == 1
    bp = d["blueprint"]
    assert [f["id"] for f in bp["fields"]] == ["name", "term", "class_name"]
    assert [s["id"] for s in bp["slots"]] == ["report"]
    assert bp["rules"] == []
    # 草稿确实落库，可被后续修订引用（修订走桩模型，产生 v2）
    from app.schemas import Blueprint as BP, DraftResult
    from app.services import tasks as task_service
    revised_bp = BP.model_validate(bp)
    next(f for f in revised_bp.fields if f.id == "class_name").required = False
    revised = DraftResult(blueprint=revised_bp, publish_summary=["对象：名册内同学"])
    monkeypatch.setattr(task_service, "draft_blueprint", lambda *a, **k: revised)
    r2 = client.post(f"/api/tasks/{tid}/draft/revise",
                     data={"blueprint_version_id": str(d["blueprint_version_id"]),
                           "instruction": "把班级改成选填"},
                     headers=h)
    assert r2.status_code == 200, r2.text
    assert r2.json()["version"] == 2
    assert r2.json()["impact"]["fields"]["changed"] == ["class_name"]
