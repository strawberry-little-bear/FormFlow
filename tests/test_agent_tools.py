"""Constrained Agent tool runtime: authorization, budgets, replay, audit and review use."""
from __future__ import annotations

import json
import time

import pytest
from sqlalchemy import select

from app.agent_tools import (
    AgentToolHarness,
    SkillRunner,
    SkillSpec,
    ToolContext,
    ToolErrorCode,
    ToolFailure,
    ToolInput,
    ToolRegistry,
    ToolResult,
    ToolSpec,
)
from app.agents.tooling import build_review_skill, invoke_review_rule, review_tool_manifest
from app.models import AuditEvent
from app.parsing import ParseResult
from app.schemas import Blueprint, FieldDef, RuleDef
from app.agents.review_agent import CheckContext, FileInfo


class EchoInput(ToolInput):
    value: str


def _fixture(db_session, *, handler=None, scopes=frozenset({"demo:read"}), cost=1):
    calls = []

    def echo(context, args):
        calls.append((context.actor, args.value))
        if handler:
            return handler(context, args)
        return ToolResult(status="ok", summary=args.value, data={"echo": args.value})

    registry = ToolRegistry()
    registry.register(ToolSpec(
        name="demo.echo", description="Echo validated text.", input_model=EchoInput,
        handler=echo, required_scope="demo:read", timeout_seconds=0.05,
        budget_cost=cost, max_result_bytes=512,
    ))
    harness = AgentToolHarness(registry, max_invocations=2, max_cost=2,
                               default_timeout_seconds=0.05)
    context = ToolContext(actor="test-agent", task_id=4, subject_id=9,
                          run_id=12, allowed_scopes=scopes)
    return harness, context, calls


def test_tool_registry_exposes_only_tools_authorized_for_current_context(db_session):
    harness, context, _ = _fixture(db_session)
    assert [x["name"] for x in harness.registry.list_for(context)] == ["demo.echo"]
    denied = ToolContext(actor="review_agent", allowed_scopes=frozenset())
    assert harness.registry.list_for(denied) == []
    assert harness.invoke("missing.tool", {"value": "x"}, context=context,
                          db=db_session, idempotency_key="unknown").error_code is ToolErrorCode.FORBIDDEN


def test_harness_denies_missing_scope_and_invalid_arguments_without_handler_execution(db_session):
    harness, context, calls = _fixture(db_session)
    denied = ToolContext(actor="untrusted", allowed_scopes=frozenset())
    result = harness.invoke("demo.echo", {"value": "x"}, context=denied,
                            db=db_session, idempotency_key="no-scope")
    assert result.error_code is ToolErrorCode.FORBIDDEN
    bad = harness.invoke("demo.echo", {"value": "x", "extra": "unexpected"},
                         context=context, db=db_session, idempotency_key="bad-schema")
    assert bad.error_code is ToolErrorCode.INVALID_ARGUMENTS
    assert calls == []


def test_idempotent_retry_replays_result_without_duplicate_side_effect_and_audits_once(db_session):
    harness, context, calls = _fixture(db_session)
    first = harness.invoke("demo.echo", {"value": "safe"}, context=context,
                           db=db_session, idempotency_key="stable-key")
    replay = harness.invoke("demo.echo", {"value": "safe"}, context=context,
                            db=db_session, idempotency_key="stable-key")
    assert first.status == replay.status == "ok"
    assert len(calls) == 1
    assert len(harness.trace) == 1
    events = db_session.scalars(select(AuditEvent).where(
        AuditEvent.action == "agent.tool.invoked")).all()
    assert len(events) == 1
    payload = json.loads(events[0].payload_json)
    assert payload["run_id"] == 12 and payload["subject_id"] == 9
    assert payload["idempotency_key_hash"]
    assert "request_hash" not in payload
    assert "safe" not in events[0].payload_json  # no raw arguments/results in audit


def test_invocation_keeps_a_safe_correlation_id_for_trace_and_audit(db_session):
    harness, context, _ = _fixture(db_session)
    context = context.__class__(**{**context.__dict__, "correlation_id": "review-run:12"})
    invocation = harness.invoke("demo.echo", {"value": "trace"}, context=context,
                                db=db_session, idempotency_key="trace-key")
    assert invocation.correlation_id == "review-run:12"
    event = db_session.scalar(select(AuditEvent).where(
        AuditEvent.action == "agent.tool.invoked"))
    assert json.loads(event.payload_json)["correlation_id"] == "review-run:12"
    assert "trace" not in event.payload_json


def test_child_tool_deadline_is_clamped_to_parent_deadline(db_session):
    observed = []

    def inspect_deadline(context, _args):
        observed.append(context.deadline_monotonic)
        return ToolResult(status="ok", summary="within parent budget")

    harness, context, _calls = _fixture(db_session, handler=inspect_deadline)
    parent_deadline = time.monotonic() + 0.04
    context = ToolContext(**{**context.__dict__, "deadline_monotonic": parent_deadline})
    result = harness.invoke("demo.echo", {"value": "bounded"}, context=context,
                            db=db_session, idempotency_key="parent-bound")

    assert result.status == "ok"
    assert len(observed) == 1
    assert observed[0] <= parent_deadline


def test_expired_parent_deadline_fails_before_tool_handler_starts(db_session):
    harness, context, calls = _fixture(db_session)
    context = ToolContext(**{**context.__dict__,
                             "deadline_monotonic": time.monotonic() - 0.01})

    result = harness.invoke("demo.echo", {"value": "too late"}, context=context,
                            db=db_session, idempotency_key="expired-parent")

    assert result.status == "failed"
    assert result.error_code is ToolErrorCode.TIMEOUT
    assert result.needs_human
    assert calls == []
    assert harness.trace[-1].error_code is ToolErrorCode.TIMEOUT


def test_idempotent_replay_still_checks_current_authorization(db_session):
    harness, context, calls = _fixture(db_session)
    harness.invoke("demo.echo", {"value": "authorized"}, context=context,
                   db=db_session, idempotency_key="auth-replay")
    denied = ToolContext(actor="revoked-agent", task_id=4, subject_id=9,
                         run_id=12, allowed_scopes=frozenset())
    result = harness.invoke("demo.echo", {"value": "authorized"}, context=denied,
                            db=db_session, idempotency_key="auth-replay")
    assert result.error_code is ToolErrorCode.FORBIDDEN
    assert len(calls) == 1


@pytest.mark.parametrize(("scope_field", "scope_value"), [
    ("actor", "other-agent"),
    ("task_id", 5),
    ("subject_id", 10),
    ("run_id", 13),
    ("rule_id", "R-02"),
    ("simulation", True),
    ("allowed_scopes", frozenset({"demo:read", "other:read"})),
])
def test_idempotency_replay_is_bound_to_execution_scope(db_session, scope_field, scope_value):
    harness, context, calls = _fixture(db_session)
    first = harness.invoke("demo.echo", {"value": "result for subject 9"}, context=context,
                           db=db_session, idempotency_key="scope-bound")
    changed_scope = ToolContext(**{**context.__dict__, scope_field: scope_value})

    replay = harness.invoke("demo.echo", {"value": "result for subject 9"}, context=changed_scope,
                            db=db_session, idempotency_key="scope-bound")

    assert first.status == "ok"
    assert replay.status == "failed"
    assert replay.error_code is ToolErrorCode.IDEMPOTENCY_CONFLICT
    assert "没有重复执行工具" in replay.summary
    assert len(calls) == 1


def test_same_idempotency_key_cannot_be_reused_with_different_arguments(db_session):
    harness, context, calls = _fixture(db_session)
    harness.invoke("demo.echo", {"value": "first"}, context=context,
                   db=db_session, idempotency_key="same-key")
    result = harness.invoke("demo.echo", {"value": "second"}, context=context,
                            db=db_session, idempotency_key="same-key")
    assert result.error_code is ToolErrorCode.IDEMPOTENCY_CONFLICT
    assert len(calls) == 1


def test_budget_is_enforced_before_second_tool_execution(db_session):
    harness, context, calls = _fixture(db_session)
    harness.budget.max_calls = 1
    harness.invoke("demo.echo", {"value": "first"}, context=context,
                   db=db_session, idempotency_key="first")
    result = harness.invoke("demo.echo", {"value": "second"}, context=context,
                            db=db_session, idempotency_key="second")
    assert result.error_code is ToolErrorCode.BUDGET_EXHAUSTED
    assert len(calls) == 1


def test_tool_failure_timeout_and_oversized_result_fail_closed(db_session):
    # Leave enough margin for Windows runner timer granularity; the harness
    # timeout remains 50 ms, so this still exercises the same boundary.
    slow, context, _ = _fixture(db_session, handler=lambda _ctx, _args: time.sleep(0.2) or
                                ToolResult(status="ok", summary="late"))
    assert slow.invoke("demo.echo", {"value": "x"}, context=context, db=db_session,
                       idempotency_key="timeout").error_code is ToolErrorCode.TIMEOUT

    large, context, _ = _fixture(db_session, handler=lambda _ctx, _args:
                                 ToolResult(status="ok", summary="x", data={"long": "z" * 600}))
    assert large.invoke("demo.echo", {"value": "x"}, context=context, db=db_session,
                        idempotency_key="large").error_code is ToolErrorCode.RESULT_INVALID

    def exploding(_ctx, _args):
        raise RuntimeError("internal-only details")

    broken, context, _ = _fixture(db_session, handler=exploding)
    result = broken.invoke("demo.echo", {"value": "x"}, context=context,
                           db=db_session, idempotency_key="broken")
    assert result.error_code is ToolErrorCode.TOOL_FAILED
    assert "internal-only details" not in result.summary


def test_skill_limits_allowed_tools_and_maximum_steps(db_session):
    harness, context, calls = _fixture(db_session)
    spec = SkillSpec(name="bounded", description="One bounded demo step.",
                     allowed_tools=frozenset({"demo.echo"}), max_steps=1)
    runner = SkillRunner(spec, harness)
    assert runner.invoke("blocked.tool", {"value": "x"}, context=context,
                         db=db_session, idempotency_key="blocked").error_code is ToolErrorCode.FORBIDDEN
    assert runner.invoke("demo.echo", {"value": "ok"}, context=context,
                         db=db_session, idempotency_key="allowed").status == "ok"
    assert runner.invoke("demo.echo", {"value": "again"}, context=context,
                         db=db_session, idempotency_key="step-limit").error_code is ToolErrorCode.BUDGET_EXHAUSTED
    assert len(calls) == 1


def test_skill_can_stop_after_failure_and_record_human_handoffs(db_session):
    def manual_result(_ctx, _args):
        return ToolResult(status="unknown", summary="证据不足", data={
            "rule_result": {"rule_id": "R-01"}}, needs_human=True)

    harness, context, calls = _fixture(db_session, handler=manual_result)
    runner = SkillRunner(SkillSpec(name="manual", description="handoff", allowed_tools=frozenset({"demo.echo"}),
                                   max_steps=2, human_on_unknown=True), harness)
    result = runner.invoke("demo.echo", {"value": "uncertain"}, context=context,
                           db=db_session, idempotency_key="handoff")
    assert result.needs_human and runner.human_required == ["R-01"]

    failing, context, _ = _fixture(db_session, handler=lambda _ctx, _args: (_ for _ in ()).throw(RuntimeError()))
    stopping = SkillRunner(SkillSpec(name="stop", description="stop on errors", allowed_tools=frozenset({"demo.echo"}),
                                     max_steps=3, stop_on_failure=True), failing)
    first = stopping.invoke("demo.echo", {"value": "fail"}, context=context,
                            db=db_session, idempotency_key="failure")
    second = stopping.invoke("demo.echo", {"value": "blocked"}, context=context,
                             db=db_session, idempotency_key="after-failure")
    assert first.status == second.status == "failed"
    assert "已因前序失败停止" in second.summary


def test_review_skill_routes_only_blueprint_rules_and_records_per_rule_tool_audit(db_session, stub_llm):
    context = CheckContext(
        blueprint=Blueprint(
            fields=[FieldDef(id="name", label="姓名")],
            rules=[
                RuleDef(id="D-01", statement="姓名必填", requirement_source="原始要求",
                        executor="deterministic", check={"kind": "field_required", "field": "name"}),
                RuleDef(id="S-01", statement="材料含姓名", requirement_source="原始要求",
                        executor="semantic"),
                RuleDef(id="H-01", statement="真实性", requirement_source="原始要求",
                        executor="human_only"),
            ],
        ),
        fields={"name": "张三"},
        files=[FileInfo(file_id="f1", slot="report", original_name="x.txt", size=10,
                        parse=ParseResult(pages=["报告 姓名：张三"]))],
    )
    skill, scope = build_review_skill(context, client=stub_llm, db=db_session,
                                      task_id=2, subject_id=7, run_id=19)
    deterministic = invoke_review_rule(skill, scope, db_session, executor="deterministic",
                                       rule_id="D-01", idempotency_key="run19:D-01")
    assert deterministic.result == "satisfied"
    semantic = invoke_review_rule(skill, scope, db_session, executor="semantic",
                                  rule_id="S-01", idempotency_key="run19:S-01")
    assert semantic.result in {"unknown", "satisfied"}
    assert invoke_review_rule(skill, scope, db_session, executor="semantic",
                              rule_id="H-01", idempotency_key="run19:H-01").result == "failed"
    events = db_session.scalars(select(AuditEvent).where(
        AuditEvent.task_id == 2, AuditEvent.action == "agent.tool.invoked")).all()
    assert len(events) == 3
    assert all(e.entity == "rule_result" for e in events)
    assert all(json.loads(e.payload_json)["run_id"] == 19 for e in events)


def test_review_tool_manifest_matches_registered_harness_contract(db_session, stub_llm):
    context = CheckContext(blueprint=Blueprint(), fields={})
    skill, _scope = build_review_skill(context, client=stub_llm, db=db_session,
                                       task_id=2, subject_id=7, run_id=20)
    manifest = {entry["name"]: entry for entry in review_tool_manifest()}

    assert set(manifest) == set(skill.spec.allowed_tools)
    registered_timeouts = []
    for name, public_contract in manifest.items():
        registered = skill.harness.registry.get(name)
        registered_timeouts.append(registered.timeout_seconds)
        assert public_contract == {
            "name": registered.name,
            "description": registered.description,
            "required_scope": registered.required_scope,
            "timeout_seconds": registered.timeout_seconds,
            "budget_cost": registered.budget_cost,
            "max_argument_bytes": registered.max_argument_bytes,
            "max_result_bytes": registered.max_result_bytes,
            "idempotent": registered.idempotent,
        }
    assert skill.harness.default_timeout_seconds == max(registered_timeouts)
