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
from ..agents.tooling import RULE_REVIEW_SKILL, review_tool_manifest


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


def agent_runtime_manifest(db: Session, task: Task) -> dict:
    """Return the non-sensitive runtime contract for one organizer task."""
    counts = _blueprint_counts(db, task)
    review_invocations = counts["deterministic"] + counts["semantic"]
    tools = review_tool_manifest()
    return {
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
            "max_invocations": max(1, review_invocations),
            "max_cost": max(1, review_invocations),
            "semantic_model_calls_per_run": settings.max_llm_calls_per_run,
            "parsed_pages_per_run": settings.max_pages_per_run,
            "idempotency": "required",
            "result_limit_bytes": max(item["max_result_bytes"] for item in tools),
            "audit": "记录工具类别、scope、状态、耗时和幂等键摘要；不保存原始材料、参数或结果正文",
        },
        "mcp": {
            "external_adapter_configured": False,
            "adapters": [],
            "boundary": "当前没有外部 MCP adapter；模型不能访问网络、文件系统或任意 SQL。",
        },
        "human_control": [
            "unknown / failed 结果转人工",
            "材料覆盖缺口转人工",
            "资格、补正和最终验收由组织者决定",
        ],
    }
