"""演示种子数据回归测试：固化方案第 13 节「初始虚构状态」的计数。"""
from __future__ import annotations

from sqlalchemy import select

from app.models import Subject
from app.services import export as export_service
from app.services.checks import current_summary
from app.services.demo_seed import seed_demo
from app.services.progress import demo_route_data


def test_seed_demo_state(db_session):
    summary = seed_demo(db_session)
    db = db_session
    task_id = summary["task_id"]
    subjects = db.scalars(select(Subject).where(Subject.task_id == task_id)).all()
    assert len(subjects) == 5

    by_name = {s.display_name: s for s in subjects}
    # 应交 4 = 5 - 免交 1（孙七）
    assert by_name["孙七"].eligibility in ("not_assessed",)

    summaries = {name: current_summary(db, db.get(__import__("app.models", fromlist=["Task"]).Task, task_id), s.id)
                 for name, s in by_name.items()}
    assert summaries["张三"]["summary"] == "已验收"
    assert summaries["张三"]["acceptance"] == "accepted"
    assert summaries["李四"]["summary"] == "待补正"
    assert summaries["李四"]["acceptance"] == "not_accepted"
    assert summaries["王五"]["summary"] == "待人工"
    assert summaries["王五"]["acceptance"] == "pending"
    assert summaries["赵六"]["summary"] == "未正式提交"

    # 交付快照：正式包只纳入已验收的张三
    from app.models import Task

    task = db.get(Task, task_id)
    snap = export_service.create_snapshot(db, task, kind="formal")
    import json

    manifest = json.loads(snap.manifest_json)
    included = [e["name"] for e in manifest["entries"] if e["included"]]
    assert included == ["张三"]
    assert manifest["totals"] == {"subjects": 5, "included": 1, "excluded": 4}


def test_demo_route_projection_follows_seed_lifecycle(db_session):
    summary = seed_demo(db_session)
    from app.models import Task

    task = db_session.get(Task, summary["task_id"])
    route = demo_route_data(db_session, task)

    assert route["completed"] == 2
    assert [step["status"] for step in route["steps"]] == [
        "done", "done", "current", "upcoming"
    ]
    assert route["next"]["title"] == "检查并接手"
    assert "已验收 1/4" in route["next"]["detail"]
