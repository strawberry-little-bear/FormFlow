"""Trusted tool surface for the rule-review skill.

Rules are selected by the application, never by model-supplied tool names.
Each handler closes over the current CheckContext and only receives a validated
rule ID. There is no model-controlled filesystem, SQL, network or send tool.
"""
from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any, Callable, Mapping

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


@dataclass(frozen=True)
class ReviewToolContract:
    name: str
    description: str
    required_scope: str
    timeout_seconds: float
    budget_cost: int = 1
    max_argument_bytes: int = 8_192
    max_result_bytes: int = 16_384
    idempotent: bool = True
    audit_entity: str = "rule_result"

    def manifest_entry(self) -> dict[str, object]:
        return {
            "name": self.name,
            "description": self.description,
            "required_scope": self.required_scope,
            "timeout_seconds": self.timeout_seconds,
            "budget_cost": self.budget_cost,
            "max_argument_bytes": self.max_argument_bytes,
            "max_result_bytes": self.max_result_bytes,
            "idempotent": self.idempotent,
        }

    def tool_spec(
        self,
        handler: Callable[[ToolContext, ReviewRuleInput], ToolResult | Mapping[str, Any]],
    ) -> ToolSpec:
        return ToolSpec(
            name=self.name,
            description=self.description,
            input_model=ReviewRuleInput,
            handler=handler,
            required_scope=self.required_scope,
            timeout_seconds=self.timeout_seconds,
            budget_cost=self.budget_cost,
            audit_entity=self.audit_entity,
            max_argument_bytes=self.max_argument_bytes,
            max_result_bytes=self.max_result_bytes,
            idempotent=self.idempotent,
        )


def _review_tool_contracts() -> tuple[ReviewToolContract, ...]:
    semantic_timeout = max(30.0, settings.llm_timeout_seconds * (settings.llm_max_retries + 1) + 10.0)
    return (
        ReviewToolContract(
            name="review.deterministic_rule",
            description="Run one allowlisted deterministic check from the current published blueprint.",
            required_scope="review:deterministic",
            timeout_seconds=5.0,
        ),
        ReviewToolContract(
            name="review.semantic_rule",
            description="Investigate one allowlisted semantic rule and verify quoted evidence against current parsed materials.",
            required_scope="review:semantic",
            timeout_seconds=semantic_timeout,
        ),
    )


def review_tool_manifest() -> list[dict[str, object]]:
    """Expose the review tool contract without constructing a live runner."""
    return [contract.manifest_entry() for contract in _review_tool_contracts()]


def review_harness_budget(deterministic_rules: int, semantic_rules: int) -> dict[str, int]:
    """Compute invocation and cost limits from the same contracts used by the harness."""
    contracts = {contract.name: contract for contract in _review_tool_contracts()}
    invocations = deterministic_rules + semantic_rules
    cost = (
        deterministic_rules * contracts["review.deterministic_rule"].budget_cost
        + semantic_rules * contracts["review.semantic_rule"].budget_cost
    )
    return {"max_invocations": max(1, invocations), "max_cost": max(1, cost)}


def _tool_result(result: RuleResultOut) -> ToolResult:
    return ToolResult(status=result.result, summary=result.explanation[:500],
                      data={"rule_result": result.model_dump(mode="json")},
                      needs_human=result.result in {"unknown", "failed"})


def build_review_skill(ctx: CheckContext, *, client: LLMClient,
                       db: Session, task_id: int, subject_id: int,
                       run_id: int, actor: str = "review_agent") -> tuple[SkillRunner, ToolContext]:
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

    def semantic_handler(scope: ToolContext, args: ReviewRuleInput) -> ToolResult:
        rule = semantic.get(args.rule_id)
        if rule is None:
            raise ValueError("rule id is outside the semantic review scope")
        return _tool_result(run_semantic_rule(
            rule, ctx, client, deadline_monotonic=scope.deadline_monotonic))

    contracts = _review_tool_contracts()
    registry.register(contracts[0].tool_spec(deterministic_handler))
    registry.register(contracts[1].tool_spec(semantic_handler))
    max_tool_timeout = max(contract.timeout_seconds for contract in contracts)
    budget = review_harness_budget(len(deterministic), len(semantic))
    harness = AgentToolHarness(
        registry,
        **budget,
        default_timeout_seconds=max_tool_timeout,
    )
    runner = SkillRunner(RULE_REVIEW_SKILL, harness)
    context = ToolContext(
        actor=actor,
        task_id=task_id,
        subject_id=subject_id,
        run_id=run_id,
        correlation_id=f"review-run:{run_id}",
        simulation=bool(getattr(client, "is_simulation", False)),
        allowed_scopes=frozenset({"review:deterministic", "review:semantic"}),
    )
    return runner, context


def invoke_review_rule(runner: SkillRunner, context: ToolContext, db: Session,
                       *, executor: str, rule_id: str, idempotency_key: str) -> RuleResultOut:
    tool_name = ("review.deterministic_rule" if executor == "deterministic"
                 else "review.semantic_rule")
    invocation = runner.invoke(tool_name, {"rule_id": rule_id},
                               context=replace(context, rule_id=rule_id),
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
