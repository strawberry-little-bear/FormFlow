"""Interactively demonstrate FormFlow's read-only organizer MCP sidecar."""
from __future__ import annotations

import asyncio
import getpass
import json
import os
import sys
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from mcp import Client
from mcp.client.stdio import StdioServerParameters

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_API_URL = "http://127.0.0.1:8000"


def validate_api_url(api_url: str) -> str:
    base_url = api_url.rstrip("/")
    parsed = urlparse(base_url)
    local_http = parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}
    if not parsed.netloc or not (parsed.scheme == "https" or local_http):
        raise ValueError("API 地址必须使用 HTTPS；HTTP 仅允许本机地址")
    return base_url


def login(api_url: str, username: str, password: str) -> str:
    body = urlencode({"username": username, "password": password}).encode("utf-8")
    request = Request(
        f"{api_url}/api/auth/login", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST",
    )
    with urlopen(request, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    token = payload.get("token")
    if not isinstance(token, str) or not token:
        raise RuntimeError("登录响应中没有有效会话 token")
    return token


def choose_task_id(
    tasks: list[dict],
    input_fn=input,
    output_fn=print,
    *,
    requested_id: int | None = None,
) -> int:
    """Choose the task the live MCP walkthrough should inspect."""
    task_ids = {task["id"] for task in tasks}
    if not task_ids:
        raise ValueError("没有可展示的任务；请先运行 scripts/seed_demo.py。")
    if requested_id is not None:
        if requested_id in task_ids:
            return requested_id
        raise ValueError(f"任务 #{requested_id} 不在当前组织者的任务列表中。")
    if len(task_ids) == 1:
        return next(iter(task_ids))

    default_id = tasks[0]["id"]
    output_fn("\n检测到多个任务，请输入要演示的任务编号；直接回车使用列表第一项：")
    while True:
        raw = input_fn(f"任务编号 [#{default_id}]: ").strip()
        if not raw:
            return default_id
        try:
            task_id = int(raw)
        except ValueError:
            output_fn("请输入列表中的数字任务编号。")
            continue
        if task_id in task_ids:
            return task_id
        output_fn("这个任务不在当前账号的任务列表中，请重新选择。")


def format_collection_progress(counts: dict, mode: str) -> str:
    eligibility_pending = counts.get("eligibility_pending", 0)
    if mode == "roster":
        return (
            f"- 名单 {counts.get('roster', 0)} · 免交 {counts.get('exempt', 0)} · "
            f"应交 {counts.get('required', 0)} · 已提交 {counts.get('submitted', 0)} · "
            f"未提交 {counts.get('unsubmitted', 0)} · 资格待核 {eligibility_pending} · "
            f"已验收 {counts.get('accepted', 0)}"
        )
    return (
        f"- 开放报名主体 {counts.get('registered', 0)} · "
        f"已提交 {counts.get('submitted', 0)} · 资格待核 {eligibility_pending} · "
        f"已验收 {counts.get('accepted', 0)}"
    )


async def show_mcp(api_url: str, token: str, requested_task_id: int | None = None) -> None:
    child_env = os.environ.copy()
    child_env.update({"FORMFLOW_MCP_API_URL": api_url, "FORMFLOW_MCP_TOKEN": token})
    params = StdioServerParameters(
        command=sys.executable, args=["-m", "app.mcp_server"], env=child_env, cwd=ROOT,
    )
    async with Client(params, read_timeout_seconds=20) as client:
        tools = await client.list_tools()
        print("\nMCP 工具发现：")
        for tool in tools.tools:
            access = "只读" if tool.annotations and tool.annotations.read_only_hint else "未标注只读"
            print(f"- {tool.name}（{access}）：{tool.description}")

        task_result = await client.call_tool("list_my_tasks", {})
        if task_result.is_error:
            raise RuntimeError(task_result.content[0].text)
        tasks = json.loads(task_result.content[0].text).get("tasks", [])
        print(f"\nlist_my_tasks：返回 {len(tasks)} 个组织者任务")
        for task in tasks:
            print(f"- #{task['id']} {task['name']} · {task['status']} · {task['mode']}")
        if not tasks:
            print("没有可展示的任务；请先运行 scripts/seed_demo.py。")
            return

        task_id = choose_task_id(tasks, requested_id=requested_task_id)
        progress_result = await client.call_tool("get_task_collection_progress", {"task_id": task_id})
        route_result = await client.call_tool("get_task_next_step", {"task_id": task_id})
        runtime_result = await client.call_tool("get_task_agent_runtime", {"task_id": task_id})
        if progress_result.is_error or route_result.is_error or runtime_result.is_error:
            failed = next(result for result in (progress_result, route_result, runtime_result) if result.is_error)
            raise RuntimeError(failed.content[0].text)
        progress = json.loads(progress_result.content[0].text)
        route = json.loads(route_result.content[0].text)
        runtime = json.loads(runtime_result.content[0].text)
        counts = progress.get("counts", {})
        print(f"\nget_task_collection_progress（任务 #{task_id}）：")
        print(format_collection_progress(counts, progress.get("mode", "")))
        current, next_step = route.get("current") or {}, route.get("next") or {}
        print(f"\nget_task_next_step（任务 #{task_id}）：")
        print(f"- 当前：{current.get('title', '无')}；下一步：{next_step.get('title', '无')}")
        print(f"\nget_task_agent_runtime（任务 #{task_id}）：")
        print(f"- Skill：{', '.join(skill['name'] for skill in runtime.get('skills', [])) or '无'}")
        print(f"- 受限工具：{', '.join(tool['name'] for tool in runtime.get('tools', [])) or '无'}")
        harness = runtime.get("harness", {})
        print(f"- Harness：最多 {harness.get('max_steps', '未设置')} 步 / {harness.get('max_invocations', '未设置')} 次调用")
        print(f"- 人工控制点：{len(runtime.get('human_control', []))} 项；没有读取名单或材料正文")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="演示 FormFlow 组织者只读 MCP sidecar")
    parser.add_argument("--api-url", default=DEFAULT_API_URL, help="本地 API 地址，默认 %(default)s")
    parser.add_argument("--username", default=os.getenv("FORMFLOW_DEMO_USERNAME", "demo"),
                        help="组织者账号；交互模式下默认 %(default)s")
    parser.add_argument("--task-id", type=int, default=None,
                        help="直接选择任务编号；省略时单任务自动选择，多任务交互选择")
    parser.add_argument("--non-interactive", action="store_true",
                        help="从 FORMFLOW_DEMO_PASSWORD 读取密码，不读取 stdin")
    args = parser.parse_args()
    try:
        api_url = validate_api_url(args.api_url)
        username = args.username.strip() or "demo"
        if args.non_interactive:
            password = os.getenv("FORMFLOW_DEMO_PASSWORD", "")
            if not password:
                raise RuntimeError("非交互模式需要设置 FORMFLOW_DEMO_PASSWORD（密码不会显示或写入文件）。")
        else:
            username = input(f"组织者账号 [{username}]: ").strip() or username
            password = getpass.getpass("组织者密码（输入不回显）: ")
        token = login(api_url, username, password)
        print("登录成功；会话 token 不会显示。启动 MCP stdio sidecar…")
        asyncio.run(show_mcp(api_url, token, requested_task_id=args.task_id))
        return 0
    except HTTPError as exc:
        print("登录失败：账号或密码不正确。" if exc.code == 401 else f"登录接口返回 HTTP {exc.code}。", file=sys.stderr)
    except (URLError, TimeoutError) as exc:
        print(f"无法连接 FormFlow API：{exc}", file=sys.stderr)
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
    except Exception as exc:
        print(f"MCP 演示失败：{exc}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
