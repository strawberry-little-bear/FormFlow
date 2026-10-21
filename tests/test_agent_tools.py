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
from app.agents.tooling import build_review_skill, invoke_review_rule
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
    slow, context, _ = _fixture(db_session, handler=lambda _ctx, _args: time.sleep(0.06) or
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
    assert all(json.loads(e.payload_json)["run_id"] == 19 for e in events)
