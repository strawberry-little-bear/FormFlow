"""Read-only MCP bridge for organizer task navigation and runtime discovery."""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlparse

import httpx
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations


def _expect_object(value: Any, response_name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ToolError(f"FormFlow API returned an invalid {response_name} response")
    return value


def _expect_object_list(value: Any, response_name: str) -> list[dict[str, Any]]:
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise ToolError(f"FormFlow API returned an invalid {response_name} response")
    return value


def _expect_string_list(value: Any, response_name: str) -> list[str]:
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise ToolError(f"FormFlow API returned an invalid {response_name} response")
    return value


def _api_client_from_env() -> httpx.AsyncClient:
    base_url = os.getenv("FORMFLOW_MCP_API_URL", "http://127.0.0.1:8000").rstrip("/")
    token = os.getenv("FORMFLOW_MCP_TOKEN", "").strip()
    parsed = urlparse(base_url)
    local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if not (parsed.scheme == "https" or local_http) or not parsed.netloc:
        raise RuntimeError("FORMFLOW_MCP_API_URL must use HTTPS or a loopback HTTP address")
    if not token:
        raise RuntimeError("Set FORMFLOW_MCP_TOKEN to an organizer session token")
    return httpx.AsyncClient(
        base_url=base_url,
        headers={"Authorization": f"Bearer {token}"},
        timeout=httpx.Timeout(10.0),
    )


def create_server(client: httpx.AsyncClient | None = None) -> MCPServer:
    """Build the server; client injection keeps protocol tests isolated."""
    api = client
    server = MCPServer("FormFlow Organizer Read-only")
    readonly = ToolAnnotations(readOnlyHint=True, destructiveHint=False)

    async def request(path: str) -> Any:
        if api is None:
            raise ToolError("MCP API client is not configured")
        try:
            response = await api.get(path)
        except httpx.TimeoutException as exc:
            raise ToolError("FormFlow API timed out; confirm the local demo service is running") from exc
        except httpx.RequestError as exc:
            raise ToolError("FormFlow API is unavailable; confirm its address and service status") from exc
        if response.status_code == 401:
            raise ToolError("Organizer session expired; create a new session token")
        if response.status_code == 404:
            raise ToolError("Task not found or not available to this organizer")
        if response.is_error:
            raise ToolError(f"FormFlow API returned HTTP {response.status_code}")
        try:
            return _expect_object(response.json(), "JSON")
        except ValueError as exc:
            raise ToolError("FormFlow API returned invalid JSON") from exc

    @server.tool(
        title="List my FormFlow tasks",
        description=(
            "List tasks owned by the authenticated organizer. Read-only; returns task name, "
            "status, and mode without participant or submission details."
        ),
        annotations=readonly,
    )
    async def list_my_tasks() -> str:
        payload = await request("/api/tasks")
        rows = _expect_object_list(payload.get("tasks"), "task list")
        tasks = [
            {key: task.get(key) for key in ("id", "name", "status", "mode", "created_at")}
            for task in rows
        ]
        return json.dumps({"tasks": tasks}, ensure_ascii=False)

    @server.tool(
        title="Get task next step",
        description=(
            "Read the current workflow position and next navigation step for one task owned "
            "by the authenticated organizer. Does not return participant names or evidence."
        ),
        annotations=readonly,
    )
    async def get_task_next_step(task_id: int) -> str:
        if task_id < 1:
            raise ToolError("task_id must be a positive integer")
        payload = await request(f"/api/tasks/{task_id}/demo-route")
        for key in ("current", "next"):
            if payload.get(key) is not None:
                _expect_object(payload[key], f"workflow {key}")

        def step_brief(step: dict[str, Any] | None) -> dict[str, Any] | None:
            if not step:
                return None
            return {key: step.get(key) for key in ("title", "status") if key in step}

        result = {
            "task_id": payload.get("task_id"),
            "completed": payload.get("completed"),
            "total": payload.get("total"),
            "current": step_brief(payload.get("current")),
            "next": step_brief(payload.get("next")),
        }
        return json.dumps(result, ensure_ascii=False)

    @server.tool(
        title="Get task collection progress",
        description=(
            "Read aggregate collection progress for one task owned by the authenticated organizer. "
            "Returns counts only; participant rows, names, evidence, and decisions are omitted."
        ),
        annotations=readonly,
    )
    async def get_task_collection_progress(task_id: int) -> str:
        if task_id < 1:
            raise ToolError("task_id must be a positive integer")
        payload = await request(f"/api/tasks/{task_id}/workbench")
        task = _expect_object(payload.get("task"), "workbench task")
        counts = _expect_object(payload.get("counts"), "workbench counts")
        mode = task.get("mode")
        if mode == "roster":
            allowed_counts = (
                "roster", "exempt", "required", "submitted", "unsubmitted",
                "accepted", "eligibility_pending",
            )
        elif mode == "open":
            allowed_counts = ("registered", "submitted", "accepted", "eligibility_pending")
        else:
            raise ToolError("FormFlow API returned an invalid workbench task mode")
        projected_counts = {}
        for key in allowed_counts:
            if key not in counts:
                continue
            value = counts[key]
            if isinstance(value, bool) or not isinstance(value, int) or value < 0:
                raise ToolError(f"FormFlow API returned an invalid workbench count: {key}")
            projected_counts[key] = value
        return json.dumps({"task_id": task_id, "mode": mode, "counts": projected_counts},
                          ensure_ascii=False)

    @server.tool(
        title="Get task Agent runtime",
        description=(
            "Read the published Agent runtime contract for one task owned by the authenticated "
            "organizer: skills, allowed tools, harness limits, MCP boundary, and human controls. "
            "Does not return participant names, evidence, prompts, or review results."
        ),
        annotations=readonly,
    )
    async def get_task_agent_runtime(task_id: int) -> str:
        if task_id < 1:
            raise ToolError("task_id must be a positive integer")
        payload = await request(f"/api/tasks/{task_id}/agent-runtime")
        for key in ("model", "scope", "harness", "mcp"):
            if key in payload:
                _expect_object(payload[key], f"Agent runtime {key}")
        for key in ("skills", "tools"):
            if key in payload:
                _expect_object_list(payload[key], f"Agent runtime {key}")
        if "human_control" in payload:
            _expect_string_list(payload["human_control"], "Agent runtime human_control")
        mcp = payload.get("mcp")
        if isinstance(mcp, dict) and "adapters" in mcp:
            _expect_object_list(mcp["adapters"], "Agent runtime MCP adapters")
        result = {
            "task_id": payload.get("task_id"),
            "model": {
                key: payload.get("model", {}).get(key)
                for key in ("configured", "mode", "label")
            },
            "scope": {
                key: payload.get("scope", {}).get(key)
                for key in ("published_blueprint", "deterministic_rules", "semantic_rules", "human_rules")
            },
            "skills": [
                {
                    key: skill.get(key)
                    for key in (
                        "name", "description", "allowed_tools", "max_steps",
                        "stop_on_failure", "human_on_unknown", "execution",
                        "request_idempotency", "version_conflict", "human_gate",
                    )
                    if key in skill
                }
                for skill in payload.get("skills", [])
            ],
            "tools": [
                {
                    key: tool.get(key)
                    for key in ("name", "description", "scope", "timeout_seconds", "max_result_bytes", "idempotency")
                    if key in tool
                }
                for tool in payload.get("tools", [])
            ],
            "harness": {
                key: payload.get("harness", {}).get(key)
                for key in (
                    "max_steps", "max_invocations", "max_cost", "semantic_model_calls_per_run",
                    "parsed_pages_per_run", "idempotency", "result_limit_bytes", "audit",
                )
            },
            "mcp": {
                "adapters": [
                    {key: adapter.get(key) for key in ("name", "transport", "tools", "scope") if key in adapter}
                    for adapter in payload.get("mcp", {}).get("adapters", [])
                ],
                "boundary": payload.get("mcp", {}).get("boundary"),
            },
            "human_control": payload.get("human_control", []),
        }
        return json.dumps(result, ensure_ascii=False)

    return server


def main() -> None:
    client = _api_client_from_env()
    try:
        create_server(client).run(transport="stdio")
    finally:
        import asyncio

        asyncio.run(client.aclose())


if __name__ == "__main__":
    main()
