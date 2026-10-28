"""Server-owned Agent runtime manifest used by the showcase surfaces.

The manifest is intentionally descriptive only. It exposes the same bounded
review skill and tool limits that the check service uses, while keeping model
prompts, material contents, arguments, and hidden reasoning out of the UI.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from ..config import settings
from ..models import BlueprintVersion, Task
from ..schemas import Blueprint
from ..agents.tooling import RULE_REVIEW_SKILL, review_harness_budget, review_tool_manifest

AGENT_RUNTIME_CONTRACT_VERSION = 1
MCP_READONLY_TOOLS = (
    "list_my_tasks",
    "get_task_collection_progress",
    "get_task_next_step",
    "get_task_agent_runtime",
)


def _blueprint_counts(db: Session, task: Task) -> dict[str, int]:
    counts = {"deterministic": 0, "semantic": 0, "human_only": 0}
    if task.current_blueprint_id is None:
        return counts
    version = db.get(BlueprintVersion, task.current_blueprint_id)
    if version is None:
        return counts
    try:
        blueprint = Blueprint.model_validate_json(version.blueprint_json)
    except Exception:  # pragma: no cover - corrupt legacy rows fail closed
        return counts
    for rule in blueprint.rules:
        if rule.executor.value in {"semantic", "cross_material"}:
            counts["semantic"] += 1
        elif rule.executor.value == "human_only":
            counts["human_only"] += 1
        else:
            counts["deterministic"] += 1
    return counts


def _contract_self_test(
    tools: list[dict[str, object]], budget: dict[str, int], mcp_tools: list[str]
) -> dict[str, object]:
    """Check the published runtime contract without invoking a model or tool."""
    tool_names = {
        str(tool.get("name")) for tool in tools if isinstance(tool.get("name"), str)
    }
    checks = [
        {
            "id": "skill_allowlist",
            "label": "Skill 只使用已注册工具",
            "passed": RULE_REVIEW_SKILL.allowed_tools <= tool_names,
            "detail": "审核 Skill 的白名单与工具注册表一致",
        },
        {
            "id": "tool_limits",
            "label": "每个工具都有正向边界",
            "passed": all(
                float(tool.get("timeout_seconds", 0)) > 0
                and int(tool.get("budget_cost", 0)) > 0
                and int(tool.get("max_argument_bytes", 0)) > 0
                and int(tool.get("max_result_bytes", 0)) > 0
                for tool in tools
            ),
            "detail": "超时、预算、输入和结果上限均已声明",
        },
        {
            "id": "budget_bound",
            "label": "运行预算已计算",
            "passed": budget.get("max_invocations", 0) >= 1 and budget.get("max_cost", 0) >= 1,
            "detail": "本次蓝图的工具调用与成本上限已生成",
        },
        {
            "id": "human_gate",
            "label": "不确定结果转人工",
            "passed": RULE_REVIEW_SKILL.human_on_unknown is True,
            "detail": "unknown / failed 不会自动变成通过或不合格",
        },
        {
            "id": "mcp_readonly",
            "label": "MCP 只读工具固定",
            "passed": tuple(mcp_tools) == MCP_READONLY_TOOLS and len(set(mcp_tools)) == len(mcp_tools),
            "detail": "sidecar 仅提供 4 项组织者只读读取工具",
        },
    ]
    passed = sum(1 for check in checks if check["passed"])
    return {
        "mode": "static_contract",
        "status": "passed" if passed == len(checks) else "needs_attention",
        "passed": passed,
        "total": len(checks),
        "checks": checks,
        "note": "只验证服务端运行合同、白名单和预算；没有调用模型，也没有读取材料。",
    }


def agent_runtime_manifest(db: Session, task: Task) -> dict:
    """Return the non-sensitive runtime contract for one organizer task."""
    counts = _blueprint_counts(db, task)
    budget = review_harness_budget(counts["deterministic"], counts["semantic"])
    tools = review_tool_manifest()
    mcp_tools = list(MCP_READONLY_TOOLS)
    contract_self_test = _contract_self_test(tools, budget, mcp_tools)
    return {
        "contract_version": AGENT_RUNTIME_CONTRACT_VERSION,
        "task_id": task.id,
        "model": {
            "configured": settings.llm_configured,
            "mode": "online" if settings.llm_configured else "offline",
            "label": "模型已接入" if settings.llm_configured else "离线可演示",
        },
        "scope": {
            "published_blueprint": task.current_blueprint_id is not None,
            "deterministic_rules": counts["deterministic"],
            "semantic_rules": counts["semantic"],
            "human_rules": counts["human_only"],
        },
        "skills": [{
            "name": RULE_REVIEW_SKILL.name,
            "description": RULE_REVIEW_SKILL.description,
            "allowed_tools": sorted(RULE_REVIEW_SKILL.allowed_tools),
            "max_steps": RULE_REVIEW_SKILL.max_steps,
            "stop_on_failure": RULE_REVIEW_SKILL.stop_on_failure,
            "human_on_unknown": RULE_REVIEW_SKILL.human_on_unknown,
        }, {
            "name": "requirements_draft",
            "description": "把组织者原始要求整理成待确认蓝图草案；不自行发布。",
            "allowed_tools": [],
            "execution": "application_service",
            "request_idempotency": "task_account_request_id",
            "version_conflict": "fail_closed",
            "human_gate": "发布前必须由组织者确认",
        }],
        "tools": tools,
        "harness": {
            "max_steps": RULE_REVIEW_SKILL.max_steps,
            **budget,
            "semantic_model_calls_per_run": settings.max_llm_calls_per_run,
            "parsed_pages_per_run": settings.max_pages_per_run,
            "idempotency": "required",
            "idempotency_scope": "harness_instance",
            "recovery_delivery": "at_least_once",
            "recovery_note": "worker恢复未完成运行时会重新执行；崩溃前已发出的模型请求可能重复，幂等缓存不跨进程保留",
            "result_limit_bytes": max(item["max_result_bytes"] for item in tools),
            "audit": "记录工具类别、scope、状态、耗时和幂等键摘要；不保存原始材料、参数或结果正文",
        },
        "contract_self_test": contract_self_test,
        "mcp": {
            "external_adapter_configured": False,
            "external_adapter_available": True,
            "adapters": [{
                "name": "formflow-organizer-readonly",
                "transport": "stdio",
                "tools": mcp_tools,
                "scope": "organizer_session",
            }],
            "boundary": "网页内置 Agent 不调用外部 MCP；可选 stdio sidecar 提供 4 项组织者只读工具（任务列表、收集汇总、流程下一步、Agent runtime），不读取逐人名单或材料。",
        },
        "human_control": [
            "unknown / failed 结果转人工",
            "材料覆盖缺口转人工",
            "资格、补正和最终验收由组织者决定",
        ],
    }
