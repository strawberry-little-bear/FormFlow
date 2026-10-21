"""Trusted tool surface for the rule-review skill.

Rules are selected by the application, never by model-supplied tool names.
Each handler closes over the current CheckContext and only receives a validated
rule ID. There is no model-controlled filesystem, SQL, network or send tool.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ..agent_tools import (
    AgentToolHarness,
    SkillRunner,
    SkillSpec,
    ToolContext,
    ToolInput,
    ToolRegistry,
    ToolResult,
    ToolSpec,
)
from ..config import settings
from ..llm import LLMClient
from ..schemas import RuleResultOut
from .review_agent import CheckContext, run_deterministic, run_semantic_rule


class ReviewRuleInput(ToolInput):
    rule_id: str


RULE_REVIEW_SKILL = SkillSpec(
    name="review_one_submission",
    description="按正式蓝图逐条核验；不确定或失败时停止为自动判断并交由人工处理。",
    allowed_tools=frozenset({"review.deterministic_rule", "review.semantic_rule"}),
    max_steps=128,
    stop_on_failure=False,
    human_on_unknown=True,
)


def _tool_result(result: RuleResultOut) -> ToolResult:
    return ToolResult(status=result.result, summary=result.explanation[:500],
                      data={"rule_result": result.model_dump(mode="json")},
                      needs_human=result.result in {"unknown", "failed"})


def build_review_skill(ctx: CheckContext, *, client: LLMClient,
                       db: Session, task_id: int, subject_id: int,
                       run_id: int) -> tuple[SkillRunner, ToolContext]:
    """Build an ephemeral, per-run skill scope from the immutable review context."""
    deterministic = {r.id: r for r in ctx.blueprint.rules
                     if r.executor.value == "deterministic"}
    semantic = {r.id: r for r in ctx.blueprint.rules
                if r.executor.value in {"semantic", "cross_material"}}
    registry = ToolRegistry()

    def deterministic_handler(_scope: ToolContext, args: ReviewRuleInput) -> ToolResult:
        rule = deterministic.get(args.rule_id)
        if rule is None:
            raise ValueError("rule id is outside the deterministic review scope")
        return _tool_result(run_deterministic(rule, ctx))

    def semantic_handler(_scope: ToolContext, args: ReviewRuleInput) -> ToolResult:
        rule = semantic.get(args.rule_id)
        if rule is None:
            raise ValueError("rule id is outside the semantic review scope")
        return _tool_result(run_semantic_rule(rule, ctx, client))

    registry.register(ToolSpec(
        name="review.deterministic_rule",
        description="Run one allowlisted deterministic check from the current published blueprint.",
        input_model=ReviewRuleInput,
        handler=deterministic_handler,
        required_scope="review:deterministic",
        timeout_seconds=5.0,
        budget_cost=1,
        audit_entity="rule_result",
        max_result_bytes=16_384,
    ))
    semantic_timeout = max(30.0, settings.llm_timeout_seconds * (settings.llm_max_retries + 1) + 10.0)
    registry.register(ToolSpec(
        name="review.semantic_rule",
        description="Investigate one allowlisted semantic rule and verify quoted evidence against current parsed materials.",
        input_model=ReviewRuleInput,
        handler=semantic_handler,
        required_scope="review:semantic",
        timeout_seconds=semantic_timeout,
        budget_cost=1,
        audit_entity="rule_result",
        max_result_bytes=16_384,
    ))
    harness = AgentToolHarness(
        registry,
        max_invocations=max(1, len(deterministic) + len(semantic)),
        max_cost=max(1, len(deterministic) + len(semantic)),
        default_timeout_seconds=max(semantic_timeout, 5.0),
    )
    runner = SkillRunner(RULE_REVIEW_SKILL, harness)
    context = ToolContext(
        actor="review_agent",
        task_id=task_id,
        subject_id=subject_id,
        run_id=run_id,
        allowed_scopes=frozenset({"review:deterministic", "review:semantic"}),
    )
    return runner, context


def invoke_review_rule(runner: SkillRunner, context: ToolContext, db: Session,
                       *, executor: str, rule_id: str, idempotency_key: str) -> RuleResultOut:
    tool_name = ("review.deterministic_rule" if executor == "deterministic"
                 else "review.semantic_rule")
    invocation = runner.invoke(tool_name, {"rule_id": rule_id}, context=context,
                               db=db, idempotency_key=idempotency_key)
    if invocation.status == "failed":
        detail = invocation.summary or "工具未完成"
        return RuleResultOut(rule_id=rule_id, result="failed",
                             explanation=f"{detail}；没有把未完成的检查当作结论",
                             next_step="重试或交由组织者人工复核")
    raw = invocation.data.get("rule_result") if isinstance(invocation.data, dict) else None
    try:
        result = RuleResultOut.model_validate(raw)
    except Exception as exc:  # noqa: BLE001 - fail closed at the harness boundary
        return RuleResultOut(rule_id=rule_id, result="failed",
                             explanation=f"工具结果无法验证（{type(exc).__name__}）",
                             next_step="重试或交由组织者人工复核")
    if result.rule_id != rule_id:
        return RuleResultOut(rule_id=rule_id, result="failed",
                             explanation="工具返回的规则范围与请求不一致",
                             next_step="交由组织者人工复核")
    return result
