"""演示种子数据回归测试：固化方案第 13 节「初始虚构状态」的计数。"""
from __future__ import annotations

import json

from sqlalchemy import select

from app.config import settings
from app.models import AuditEvent, CheckRun, Subject, RUN_FAILED
from app.services import export as export_service
from app.services.checks import current_summary
from app.services.demo_seed import seed_demo
from app.services.progress import _review_run_failure, _review_run_source, _review_run_trace, demo_route_data


def test_review_run_failure_is_safe_and_actionable():
    budget = CheckRun(status=RUN_FAILED, budget_exhausted=True)
    assert _review_run_failure(budget) == {
        "code": "budget_exhausted",
        "title": "运行预算已用完",
        "detail": "未完成的项目保留为待确认，没有被当成通过。",
        "action": "组织者可以重试，或直接打开复核页人工核对。",
    }

    model = CheckRun(status=RUN_FAILED, error="LLMError: gateway unavailable")
    failure = _review_run_failure(model)
    assert failure["code"] == "model_unavailable"
    assert "gateway" not in str(failure).lower()

    pending = CheckRun(status="success", error="LLMError: ignored")
    assert _review_run_failure(pending) is None


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
    assert route["current"]["title"] == "检查并接手"
    assert route["current"]["status"] == "current"
    assert route["next"]["title"] == "固定交付"
    assert route["next"]["status"] == "upcoming"
    assert route["next"]["href"] == f"#/delivery/{task.id}"
    assert route["steps"][2]["href"] == f"#/review/{task.id}/2"
    assert "李四" in route["current"]["detail"]
    signal = route["review_signal"]
    assert signal["subject_name"] == "李四"
    assert signal["review_href"] == f"#/review/{task.id}/2"
    assert signal["run_id"] is not None
    assert signal["status"] == "success"
    assert signal["pages_read"] >= 1
    assert signal["deterministic_rules"] >= 1
    assert signal["semantic_rules"] >= 1
    assert signal["pending_rules"] >= 1
    assert signal["focus_rule"]["statement"]
    assert signal["focus_rule"]["status"] in {"有问题", "待确认", "检查未完成", "人工判断"}
    assert signal["focus_rule"]["executor"] in {"deterministic", "semantic", "cross_material", "human_only"}
    assert signal["run_source"] == "simulation"
    assert signal["budget"]["pages"] == {
        "used": signal["pages_read"], "limit": settings.max_pages_per_run}
    assert signal["budget"]["semantic_calls"] == {
        "used": signal["llm_calls_used"], "limit": settings.max_llm_calls_per_run}
    assert len(signal["trace"]) == signal["trace_total"]
    assert {item["tool"] for item in signal["trace"]} == {
        "review.deterministic_rule", "review.semantic_rule"}
    assert all("summary" not in item and "rule_id" not in item for item in signal["trace"])


def test_review_run_source_distinguishes_live_and_missing_modes(db_session):
    summary = seed_demo(db_session)
    from app.models import Task

    task = db_session.get(Task, summary["task_id"])
    route = demo_route_data(db_session, task)
    run = db_session.get(CheckRun, route["review_signal"]["run_id"])
    events = db_session.scalars(select(AuditEvent).where(
        AuditEvent.task_id == task.id,
        AuditEvent.action == "agent.tool.invoked")).all()
    matched = [event for event in events
               if json.loads(event.payload_json or "{}").get("run_id") == run.id]
    assert matched
    for event in matched:
        payload = json.loads(event.payload_json)
        if payload.get("tool") == "review.semantic_rule":
            payload["simulation"] = False
            event.payload_json = json.dumps(payload, ensure_ascii=False)
    db_session.flush()
    assert _review_run_source(db_session, task, run) == "live"
    assert _review_run_source(db_session, task, CheckRun(id=run.id + 1000000)) == "unknown"


def test_review_run_trace_is_compact_and_ordered(db_session):
    summary = seed_demo(db_session)
    from app.models import Task

    task = db_session.get(Task, summary["task_id"])
    route = demo_route_data(db_session, task)
    run = db_session.get(CheckRun, route["review_signal"]["run_id"])
    trace = _review_run_trace(db_session, task, run)
    assert trace
    assert [item["sequence"] for item in trace] == sorted(item["sequence"] for item in trace)
    assert all(set(item) == {"tool", "tool_version", "sequence", "execution_attempt",
                             "status", "simulation", "duration_ms"}
               for item in trace)
    signal = route["review_signal"]
    assert signal["revision_version"] > 0
    assert signal["blueprint_version"] > 0
    assert signal["retry"] == {"attempt": 1, "retried_from": None}
    db_session.add(AuditEvent(task_id=task.id, action="check.retry",
                              payload_json=json.dumps({"from_run": run.id - 1,
                                                       "new_run": run.id})))
    db_session.flush()
    retried_signal = demo_route_data(db_session, task)["review_signal"]
    assert retried_signal["retry"] == {"attempt": 2, "retried_from": run.id - 1}
