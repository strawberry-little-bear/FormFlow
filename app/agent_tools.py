"""Constrained application-tool contracts and harness for FormFlow Agents.

The harness intentionally executes only explicitly registered Python callables.
It does not expose model-controlled SQL, filesystem access, network access, or
arbitrary dynamic dispatch. Tool results are JSON-safe, bounded, and auditable.
Tool timeouts are cooperative: handlers receive a monotonic deadline and MUST
pass remaining time into blocking I/O. Python cannot safely cancel a running
thread, so handlers must not launch detached or unbounded side effects.
"""
from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass, field, replace
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Mapping

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy.orm import Session

from .models import AuditEvent


class ToolErrorCode(str, Enum):
    INVALID_ARGUMENTS = "invalid_arguments"
    FORBIDDEN = "forbidden"
    BUDGET_EXHAUSTED = "budget_exhausted"
    TIMEOUT = "timeout"
    TOOL_FAILED = "tool_failed"
    RESULT_INVALID = "result_invalid"
    IDEMPOTENCY_CONFLICT = "idempotency_conflict"


class ToolFailure(Exception):
    """Safe, expected tool failure. The message is suitable for audit/UI logs."""

    def __init__(self, code: ToolErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


class ToolInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ToolResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str
    summary: str = Field(max_length=500)
    data: dict[str, Any] = Field(default_factory=dict)
    needs_human: bool = False


@dataclass(frozen=True)
class ToolContext:
    actor: str
    task_id: int | None = None
    subject_id: int | None = None
    run_id: int | None = None
    correlation_id: str | None = None
    rule_id: str | None = None
    simulation: bool = False
    allowed_scopes: frozenset[str] = frozenset()
    deadline_monotonic: float | None = None


@dataclass(frozen=True)
class ToolSpec:
    name: str
    description: str
    input_model: type[ToolInput]
    handler: Callable[[ToolContext, ToolInput], ToolResult | Mapping[str, Any]]
    required_scope: str
    timeout_seconds: float = 10.0
    budget_cost: int = 1
    audit_entity: str = "agent_tool"
    max_argument_bytes: int = 8_192
    max_result_bytes: int = 16_384
    idempotent: bool = True

    def __post_init__(self) -> None:
        if not self.name or any(ch.isspace() for ch in self.name):
            raise ValueError("tool name must be a non-empty identifier")
        if (self.timeout_seconds <= 0 or self.budget_cost <= 0
                or self.max_argument_bytes <= 0 or self.max_result_bytes <= 0):
            raise ValueError("timeout, budget cost, and payload limits must be positive")
        if not self.required_scope:
            raise ValueError("every tool must declare a required scope")


@dataclass
class ToolBudget:
    max_calls: int = 8
    max_cost: int = 8
    used_calls: int = 0
    used_cost: int = 0

    def spend(self, cost: int) -> None:
        if self.used_calls + 1 > self.max_calls or self.used_cost + cost > self.max_cost:
            raise ToolFailure(ToolErrorCode.BUDGET_EXHAUSTED, "Agent 工具预算已用尽，未继续调用")
        self.used_calls += 1
        self.used_cost += cost


@dataclass
class ToolInvocation:
    tool_name: str
    status: str
    error_code: ToolErrorCode | None = None
    summary: str = ""
    data: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0
    idempotency_key: str = ""
    needs_human: bool = False
    sequence: int = 0
    tool_version: str = "v1"
    correlation_id: str = ""


class ToolRegistry:
    """Explicit allowlist. Duplicate registrations are rejected."""

    def __init__(self) -> None:
        self._specs: dict[str, ToolSpec] = {}

    def register(self, spec: ToolSpec) -> None:
        if spec.name in self._specs:
            raise ValueError(f"tool already registered: {spec.name}")
        self._specs[spec.name] = spec

    def get(self, name: str) -> ToolSpec:
        try:
            return self._specs[name]
        except KeyError as exc:
            raise ToolFailure(ToolErrorCode.FORBIDDEN, "请求的工具不在允许清单中") from exc

    def list_for(self, context: ToolContext) -> list[dict[str, str]]:
        return [
            {"name": s.name, "description": s.description, "required_scope": s.required_scope}
            for s in self._specs.values()
            if s.required_scope in context.allowed_scopes
        ]


@dataclass
class _Replay:
    request_hash: str
    invocation: ToolInvocation


@dataclass(frozen=True)
class SkillSpec:
    """Explicit skill workflow constraints; not a prompt-only capability grant."""

    name: str
    description: str
    allowed_tools: frozenset[str]
    max_steps: int = 4
    stop_on_failure: bool = True
    human_on_unknown: bool = True

    def __post_init__(self) -> None:
        if not self.name or not self.allowed_tools or self.max_steps <= 0:
            raise ValueError("a skill needs a name, allowed tools, and a positive step limit")


class AgentToolHarness:
    """Run registered tools with scope checks, budgets, replay protection, and audit."""

    def __init__(self, registry: ToolRegistry, *, max_invocations: int = 8,
                 max_cost: int = 8, default_timeout_seconds: float = 10.0) -> None:
        if default_timeout_seconds <= 0:
            raise ValueError("default timeout must be positive")
        self.registry = registry
        self.budget = ToolBudget(max_calls=max_invocations, max_cost=max_cost)
        self.default_timeout_seconds = default_timeout_seconds
        self._replays: dict[str, _Replay] = {}
        self.trace: list[ToolInvocation] = []

    def invoke(self, tool_name: str, raw_arguments: Mapping[str, Any], *,
               context: ToolContext, db: Session,
               idempotency_key: str) -> ToolInvocation:
        spec: ToolSpec | None = None
        started = time.monotonic()
        request_hash = ""
        try:
            if not idempotency_key or len(idempotency_key) > 128:
                raise ToolFailure(ToolErrorCode.INVALID_ARGUMENTS, "需要有效的幂等键")
            spec = self.registry.get(tool_name)
            if spec.required_scope not in context.allowed_scopes:
                raise ToolFailure(ToolErrorCode.FORBIDDEN, "当前 Agent 上下文没有此工具的授权范围")
            if not isinstance(raw_arguments, Mapping):
                raise ToolFailure(ToolErrorCode.INVALID_ARGUMENTS, "工具参数必须是对象")
            canonical = _canonical_arguments(tool_name, raw_arguments, context)
            if len(canonical) > spec.max_argument_bytes:
                raise ToolFailure(ToolErrorCode.INVALID_ARGUMENTS, "工具参数超过允许大小")
            request_hash = hashlib.sha256(canonical).hexdigest()
            try:
                arguments = spec.input_model.model_validate(dict(raw_arguments))
            except (ValidationError, TypeError, ValueError) as exc:
                safe_error = _validation_summary(exc)
                raise ToolFailure(ToolErrorCode.INVALID_ARGUMENTS,
                                  f"工具参数不符合声明结构：{safe_error}") from exc
            prior = self._replays.get(idempotency_key)
            if prior:
                if prior.request_hash != request_hash:
                    raise ToolFailure(ToolErrorCode.IDEMPOTENCY_CONFLICT,
                                      "相同幂等键对应了不同请求；没有重复执行工具")
                return _copy_invocation(prior.invocation)
            tool_deadline = started + min(spec.timeout_seconds, self.default_timeout_seconds)
            if context.deadline_monotonic is not None:
                tool_deadline = min(tool_deadline, context.deadline_monotonic)
            if tool_deadline <= time.monotonic():
                raise ToolFailure(ToolErrorCode.TIMEOUT, "上层工具时限已耗尽；未启动新调用")
            self.budget.spend(spec.budget_cost)
            scoped_context = replace(context, deadline_monotonic=tool_deadline)
            result = spec.handler(scoped_context, arguments)
            if time.monotonic() > tool_deadline:
                raise ToolFailure(ToolErrorCode.TIMEOUT, "工具超过允许时限；结果不用于自动判断")
            try:
                normalized = result if isinstance(result, ToolResult) else ToolResult.model_validate(result)
            except (ValidationError, TypeError, ValueError) as exc:
                safe_error = _validation_summary(exc)
                raise ToolFailure(ToolErrorCode.RESULT_INVALID,
                                  f"工具结果不符合声明结构：{safe_error}") from exc
            encoded = normalized.model_dump_json().encode("utf-8")
            if len(encoded) > spec.max_result_bytes:
                raise ToolFailure(ToolErrorCode.RESULT_INVALID, "工具结果超过允许大小，未交给 Agent")
            invocation = ToolInvocation(
                tool_name=tool_name, status=normalized.status, summary=normalized.summary,
                data=normalized.data, duration_ms=int((time.monotonic() - started) * 1000),
                idempotency_key=idempotency_key, needs_human=normalized.needs_human)
        except ToolFailure as exc:
            invocation = ToolInvocation(
                tool_name=tool_name, status="failed", error_code=exc.code,
                summary=str(exc)[:500], duration_ms=int((time.monotonic() - started) * 1000),
                idempotency_key=idempotency_key[:128],
                needs_human=exc.code in {ToolErrorCode.BUDGET_EXHAUSTED, ToolErrorCode.TIMEOUT,
                                         ToolErrorCode.TOOL_FAILED, ToolErrorCode.RESULT_INVALID})
        except Exception as exc:  # noqa: BLE001 - harness boundary; fail closed
            invocation = ToolInvocation(
                tool_name=tool_name, status="failed", error_code=ToolErrorCode.TOOL_FAILED,
                summary=f"工具执行未完成（{type(exc).__name__}）；请重试或转人工",
                duration_ms=int((time.monotonic() - started) * 1000),
                idempotency_key=idempotency_key[:128], needs_human=True)

        invocation.sequence = len(self.trace) + 1
        invocation.correlation_id = str(context.correlation_id or "")[:96]
        self.trace.append(invocation)
        _audit(db, context, invocation, entity=spec.audit_entity if spec else "agent_tool")
        if spec is not None and spec.idempotent and idempotency_key and request_hash:
            self._replays[idempotency_key] = _Replay(request_hash, _copy_invocation(invocation))
        return invocation


class SkillRunner:
    """Restrict a workflow to a bounded, registered subset of tools."""

    def __init__(self, spec: SkillSpec, harness: AgentToolHarness) -> None:
        self.spec = spec
        self.harness = harness
        self.steps = 0
        self.stopped = False
        self.human_required: list[str] = []

    def invoke(self, tool_name: str, arguments: Mapping[str, Any], *,
               context: ToolContext, db: Session, idempotency_key: str) -> ToolInvocation:
        if self.stopped:
            return ToolInvocation(tool_name=tool_name, status="failed",
                                  error_code=ToolErrorCode.TOOL_FAILED,
                                  summary=f"技能 {self.spec.name} 已因前序失败停止")
        if tool_name not in self.spec.allowed_tools:
            return ToolInvocation(tool_name=tool_name, status="failed",
                                  error_code=ToolErrorCode.FORBIDDEN,
                                  summary=f"技能 {self.spec.name} 不允许使用此工具")
        if self.steps >= self.spec.max_steps:
            return ToolInvocation(tool_name=tool_name, status="failed",
                                  error_code=ToolErrorCode.BUDGET_EXHAUSTED,
                                  summary=f"技能 {self.spec.name} 已达到步骤上限")
        self.steps += 1
        invocation = self.harness.invoke(tool_name, arguments, context=context,
                                         db=db, idempotency_key=idempotency_key)
        if invocation.needs_human and self.spec.human_on_unknown:
            rule = invocation.data.get("rule_result", {}) if isinstance(invocation.data, dict) else {}
            rule_id = rule.get("rule_id") if isinstance(rule, dict) else None
            self.human_required.append(str(rule_id or tool_name))
        if invocation.status == "failed" and self.spec.stop_on_failure:
            self.stopped = True
        return invocation


def _validation_summary(exc: Exception) -> str:
    """Summarize schema failures without echoing their potentially sensitive input."""
    if isinstance(exc, ValidationError):
        items = []
        for error in exc.errors(include_input=False)[:5]:
            location = ".".join(str(x) for x in error.get("loc", ())) or "root"
            items.append(f"{location}: {error.get('msg', 'invalid')}")
        return "; ".join(items)[:240] or "invalid structure"
    return type(exc).__name__


def _canonical_arguments(tool_name: str, arguments: Mapping[str, Any],
                         context: ToolContext) -> bytes:
    try:
        scope = {
            "actor": context.actor,
            "task_id": context.task_id,
            "subject_id": context.subject_id,
            "run_id": context.run_id,
            "rule_id": context.rule_id,
            "simulation": context.simulation,
            "allowed_scopes": sorted(context.allowed_scopes),
        }
        return json.dumps({"tool": tool_name, "scope": scope,
                           "arguments": dict(arguments)},
                          ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                          default=str).encode("utf-8")
    except Exception as exc:  # noqa: BLE001
        raise ToolFailure(ToolErrorCode.INVALID_ARGUMENTS, "工具参数无法规范化") from exc


def _copy_invocation(invocation: ToolInvocation) -> ToolInvocation:
    return ToolInvocation(**invocation.__dict__)


def _audit(db: Session, context: ToolContext, invocation: ToolInvocation,
          *, entity: str = "agent_tool") -> None:
    """Append a compact audit event. Never persist raw tool arguments or results."""
    spec_name = invocation.tool_name[:64]
    payload = {
        "schema_version": 1,
        "tool": spec_name,
        "tool_version": invocation.tool_version,
        "sequence": invocation.sequence,
        "run_id": context.run_id,
        "correlation_id": invocation.correlation_id or context.correlation_id,
        "subject_id": context.subject_id,
        "rule_id": context.rule_id,
        "simulation": context.simulation,
        "status": invocation.status,
        "error_code": invocation.error_code.value if invocation.error_code else None,
        "duration_ms": invocation.duration_ms,
        "idempotency_key_hash": hashlib.sha256(invocation.idempotency_key.encode("utf-8")).hexdigest(),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    db.add(AuditEvent(task_id=context.task_id, actor=context.actor,
                      action="agent.tool.invoked", entity=entity[:64],
                      payload_json=json.dumps(payload, ensure_ascii=False, sort_keys=True)))
    db.flush()
