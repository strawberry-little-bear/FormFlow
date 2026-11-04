"""MCP protocol contract for the read-only organizer bridge."""
from __future__ import annotations

import asyncio
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys

import httpx
from mcp import Client
from mcp.client.stdio import StdioServerParameters

from app.mcp_server import create_server


def test_mcp_tools_are_read_only_and_project_only_navigation_data():
    seen: list[str] = []
    seen_auth: list[str | None] = []

    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        seen_auth.append(request.headers.get("Authorization"))
        if request.url.path == "/api/tasks":
            return httpx.Response(200, json={"tasks": [{
                "id": 7,
                "name": "春季报名",
                "status": "collecting",
                "mode": "roster",
                "created_at": "2026-10-24T00:00:00Z",
                "owner_token": "must-not-escape",
            }]})
        if request.url.path == "/api/tasks/7/workbench":
            return httpx.Response(200, json={
                "task": {"id": 7, "mode": "roster", "name": "private task detail"},
                "counts": {
                    "roster": 5, "exempt": 1, "required": 4, "submitted": 3,
                    "unsubmitted": 1, "accepted": 1, "eligibility_pending": 2,
                    "private_count": 99,
                },
                "rows": [{"name": "private participant", "evidence": "private material"}],
            })
        if request.url.path == "/api/tasks/7/agent-runtime":
            return httpx.Response(200, json={
                "task_id": 7,
                "model": {"configured": False, "mode": "offline", "label": "离线可演示", "secret": "hidden"},
                "scope": {"published_blueprint": True, "semantic_rules": 2, "participants": ["hidden"]},
                "skills": [{"name": "review_one_submission", "allowed_tools": ["inspect_evidence"], "prompt": "hidden"}],
                "tools": [{"name": "inspect_evidence", "scope": "current_submission", "handler_secret": "hidden"}],
                "harness": {"max_steps": 4, "semantic_model_calls_per_run": 2, "raw_material": "hidden"},
                "mcp": {"adapters": [{"name": "formflow-organizer-readonly", "transport": "stdio", "tools": ["get_task_next_step"], "token": "hidden"}], "boundary": "只读边界", "api_key": "hidden"},
                "human_control": ["最终验收由组织者决定"],
                "audit_events": [{"evidence": "hidden"}],
            })
        return httpx.Response(200, json={
            "task_id": 7,
            "completed": 2,
            "total": 4,
            "current": {"title": "检查并接手", "status": "current", "href": "#/review/7/4", "detail": "检查正式提交"},
            "next": {"title": "固定交付", "status": "upcoming", "href": "#/delivery/7", "detail": "验收后导出"},
            "review_signal": {"subject_name": "隐私字段", "evidence": "材料正文"},
        })

    api = httpx.AsyncClient(
        transport=httpx.MockTransport(respond),
        base_url="http://test",
        headers={"Authorization": "Bearer organizer-session"},
    )

    async def exercise():
        async with api, Client(create_server(api)) as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {
                "list_my_tasks", "get_task_collection_progress", "get_task_next_step",
                "get_task_agent_runtime",
            }
            assert all(tool.annotations.read_only_hint for tool in tools.tools)

            progress = await client.call_tool("get_task_collection_progress", {"task_id": 7})
            counts = json.loads(progress.content[0].text)
            assert counts == {"task_id": 7, "mode": "roster", "counts": {
                "roster": 5, "exempt": 1, "required": 4, "submitted": 3,
                "unsubmitted": 1, "accepted": 1, "eligibility_pending": 2,
            }}
            assert "private participant" not in progress.content[0].text
            assert "private material" not in progress.content[0].text
            assert "private_count" not in progress.content[0].text
            listing = await client.call_tool("list_my_tasks", {})
            listed = json.loads(listing.content[0].text)
            assert listed == {"tasks": [{
                "id": 7,
                "name": "春季报名",
                "status": "collecting",
                "mode": "roster",
                "created_at": "2026-10-24T00:00:00Z",
            }]}

            route = await client.call_tool("get_task_next_step", {"task_id": 7})
            summary = json.loads(route.content[0].text)
            assert summary["current"] == {"title": "检查并接手", "status": "current"}
            assert summary["next"] == {"title": "固定交付", "status": "upcoming"}
            assert "review_signal" not in summary
            assert "subject_name" not in route.content[0].text
            assert "href" not in summary["next"]
            runtime_result = await client.call_tool("get_task_agent_runtime", {"task_id": 7})
            runtime = json.loads(runtime_result.content[0].text)
            assert runtime["model"]["label"] == "离线可演示"
            assert runtime["skills"][0]["allowed_tools"] == ["inspect_evidence"]
            assert runtime["harness"]["semantic_model_calls_per_run"] == 2
            assert runtime["mcp"]["boundary"] == "只读边界"
            assert runtime["human_control"] == ["最终验收由组织者决定"]
            for private_key in ("secret", "prompt", "participants", "raw_material", "api_key", "token", "audit_events"):
                assert private_key not in runtime_result.content[0].text
            assert seen == ["/api/tasks/7/workbench", "/api/tasks", "/api/tasks/7/demo-route", "/api/tasks/7/agent-runtime"]
            assert seen_auth == ["Bearer organizer-session"] * 4

    asyncio.run(exercise())


def test_mcp_collection_progress_projects_open_enrollment_counts_only():
    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/api/tasks/12/workbench"
        return httpx.Response(200, json={
            "task": {"id": 12, "mode": "open", "name": "private task detail"},
            "counts": {
                "registered": 8, "submitted": 5, "accepted": 3,
                "eligibility_pending": 1, "required": 99, "unsubmitted": 94,
            },
            "rows": [{"name": "private participant", "evidence": "private material"}],
        })

    api = httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://test")

    async def exercise():
        async with api, Client(create_server(api)) as client:
            result = await client.call_tool("get_task_collection_progress", {"task_id": 12})
            assert not result.is_error
            assert json.loads(result.content[0].text) == {
                "task_id": 12,
                "mode": "open",
                "counts": {
                    "registered": 8,
                    "submitted": 5,
                    "accepted": 3,
                    "eligibility_pending": 1,
                },
            }
            assert "private participant" not in result.content[0].text
            assert "private material" not in result.content[0].text
            assert "required" not in result.content[0].text
            assert "unsubmitted" not in result.content[0].text

    asyncio.run(exercise())


def test_mcp_stdio_process_exposes_tools_and_preserves_utf8():
    seen_auth: list[str | None] = []

    class ApiHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            seen_auth.append(self.headers.get("Authorization"))
            if self.path == "/api/tasks":
                payload = {"tasks": [{
                    "id": 42,
                    "name": "秋季报名（演示）",
                    "status": "collecting",
                    "mode": "roster",
                    "created_at": "2026-10-24T00:00:00Z",
                }]}
            elif self.path == "/api/tasks/42/demo-route":
                payload = {
                    "task_id": 42,
                    "completed": 2,
                    "total": 4,
                    "current": {"title": "检查并接手", "status": "current"},
                    "next": {"title": "固定交付", "status": "upcoming"},
                    "participants": [{"name": "不应泄露"}],
                }
            elif self.path == "/api/tasks/42/workbench":
                payload = {
                    "task": {"id": 42, "mode": "roster", "name": "不应投影"},
                    "counts": {"roster": 5, "exempt": 1, "required": 4,
                               "submitted": 3, "unsubmitted": 1, "accepted": 1},
                    "rows": [{"name": "不应泄露"}],
                }
            elif self.path == "/api/tasks/42/agent-runtime":
                payload = {
                    "task_id": 42,
                    "model": {"configured": True, "mode": "online", "label": "模型已接入"},
                    "scope": {"published_blueprint": True, "deterministic_rules": 1, "semantic_rules": 2, "human_rules": 1},
                    "skills": [{"name": "review_one_submission", "allowed_tools": ["inspect_evidence"]}],
                    "tools": [{"name": "inspect_evidence", "scope": "current_submission"}],
                    "harness": {"max_steps": 4, "semantic_model_calls_per_run": 2, "parsed_pages_per_run": 12},
                    "mcp": {"adapters": [], "boundary": "网页 Agent 不连接 sidecar"},
                    "human_control": ["最终验收由组织者决定"],
                    "evidence": "private-material-body",
                }
            else:
                self.send_error(404)
                return
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, _format, *_args):
            pass

    api = ThreadingHTTPServer(("127.0.0.1", 0), ApiHandler)
    thread = threading.Thread(target=api.serve_forever, daemon=True)
    thread.start()
    env = os.environ.copy()
    env.update({
        "FORMFLOW_MCP_API_URL": f"http://127.0.0.1:{api.server_port}",
        "FORMFLOW_MCP_TOKEN": "stdio-organizer-session",
    })
    params = StdioServerParameters(
        command=sys.executable,
        args=["-m", "app.mcp_server"],
        env=env,
        cwd=Path(__file__).resolve().parents[1],
    )

    async def exercise():
        async with Client(params, read_timeout_seconds=15) as client:
            tools = await client.list_tools()
            assert {tool.name for tool in tools.tools} == {
                "list_my_tasks", "get_task_collection_progress", "get_task_next_step",
                "get_task_agent_runtime",
            }
            assert all(tool.annotations.read_only_hint for tool in tools.tools)

            listing = await client.call_tool("list_my_tasks", {})
            task = json.loads(listing.content[0].text)["tasks"][0]
            assert task["name"] == "秋季报名（演示）"

            progress_result = await client.call_tool("get_task_collection_progress", {"task_id": 42})
            progress = json.loads(progress_result.content[0].text)
            assert progress["counts"]["unsubmitted"] == 1
            assert "不应泄露" not in progress_result.content[0].text

            route = await client.call_tool("get_task_next_step", {"task_id": task["id"]})
            summary = json.loads(route.content[0].text)
            assert summary["current"]["title"] == "检查并接手"
            assert summary["next"] == {"title": "固定交付", "status": "upcoming"}
            assert "participants" not in route.content[0].text
            runtime_result = await client.call_tool("get_task_agent_runtime", {"task_id": 42})
            runtime = json.loads(runtime_result.content[0].text)
            assert runtime["skills"][0]["name"] == "review_one_submission"
            assert "sidecar" in runtime["mcp"]["boundary"]
            assert "private-material-body" not in runtime_result.content[0].text
            assert seen_auth == ["Bearer stdio-organizer-session"] * 4

    try:
        asyncio.run(exercise())
    finally:
        api.shutdown()
        api.server_close()
        thread.join(timeout=2)


def test_mcp_tool_rejects_nonpositive_task_id():
    async def exercise():
        async with Client(create_server()) as client:
            result = await client.call_tool("get_task_next_step", {"task_id": 0})
            assert result.is_error
            assert "positive integer" in result.content[0].text
            runtime = await client.call_tool("get_task_agent_runtime", {"task_id": -1})
            assert runtime.is_error
            assert "positive integer" in runtime.content[0].text
            progress = await client.call_tool("get_task_collection_progress", {"task_id": 0})
            assert progress.is_error
            assert "positive integer" in progress.content[0].text

    asyncio.run(exercise())


def test_mcp_tool_preserves_api_auth_and_ownership_failures():
    async def exercise():
        async def unauthorized(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(401)

        api = httpx.AsyncClient(transport=httpx.MockTransport(unauthorized), base_url="http://test")
        async with api, Client(create_server(api)) as client:
            result = await client.call_tool("list_my_tasks", {})
            assert result.is_error
            assert "session expired" in result.content[0].text

        async def not_owned(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(404)

        api = httpx.AsyncClient(transport=httpx.MockTransport(not_owned), base_url="http://test")
        async with api, Client(create_server(api)) as client:
            result = await client.call_tool("get_task_next_step", {"task_id": 999})
            assert result.is_error
            assert "not available to this organizer" in result.content[0].text

    asyncio.run(exercise())


def test_mcp_tools_fail_closed_on_invalid_api_payloads():
    cases = [
        ("/api/tasks", httpx.Response(200, text="private upstream body"), "list_my_tasks", {}, "invalid JSON"),
        ("/api/tasks", httpx.Response(200, json={"tasks": [None]}), "list_my_tasks", {}, "invalid task list"),
        ("/api/tasks/3/demo-route", httpx.Response(200, json={"current": "private upstream body"}),
         "get_task_next_step", {"task_id": 3}, "invalid workflow current"),
        ("/api/tasks/3/agent-runtime", httpx.Response(200, json={"skills": "private upstream body"}),
         "get_task_agent_runtime", {"task_id": 3}, "invalid Agent runtime skills"),
        ("/api/tasks/3/workbench", httpx.Response(200, json={"counts": []}),
         "get_task_collection_progress", {"task_id": 3}, "invalid workbench task"),
        ("/api/tasks/3/workbench", httpx.Response(200, json={
            "task": {"mode": "roster"}, "counts": {"submitted": True},
        }), "get_task_collection_progress", {"task_id": 3}, "invalid workbench count"),
    ]

    async def exercise():
        for expected_path, response, tool_name, arguments, message in cases:
            async def respond(request: httpx.Request) -> httpx.Response:
                assert request.url.path == expected_path
                return response

            api = httpx.AsyncClient(transport=httpx.MockTransport(respond), base_url="http://test")
            async with api, Client(create_server(api)) as client:
                result = await client.call_tool(tool_name, arguments)
                assert result.is_error
                assert message in result.content[0].text
                assert "private upstream body" not in result.content[0].text

    asyncio.run(exercise())


def test_mcp_configuration_requires_token_and_secure_remote_url(monkeypatch):
    from app.mcp_server import _api_client_from_env

    monkeypatch.setenv("FORMFLOW_MCP_TOKEN", "session")
    monkeypatch.setenv("FORMFLOW_MCP_API_URL", "http://remote.example")
    try:
        _api_client_from_env()
    except RuntimeError as exc:
        assert "HTTPS" in str(exc)
    else:  # pragma: no cover - security assertion
        raise AssertionError("remote HTTP must be rejected")

    monkeypatch.setenv("FORMFLOW_MCP_API_URL", "http://127.0.0.1:8000")
    client = _api_client_from_env()
    assert client.headers["Authorization"] == "Bearer session"
    asyncio.run(client.aclose())

    monkeypatch.delenv("FORMFLOW_MCP_TOKEN")
    try:
        _api_client_from_env()
    except RuntimeError as exc:
        assert "FORMFLOW_MCP_TOKEN" in str(exc)
    else:  # pragma: no cover - security assertion
        raise AssertionError("missing token must be rejected")
