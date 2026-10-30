#!/usr/bin/env python
"""一键启动 FormFlow 演示环境。

用法：
    python scripts/start_demo.py          # 首次初始化后启动 API + Worker
    python scripts/start_demo.py --port 8010  # 端口被占用时改用空闲端口
    python scripts/start_demo.py --check  # 只读检查依赖、种子与服务状态
    python scripts/start_demo.py --reset  # 重置隔离演示数据后启动
    python scripts/start_demo.py --stop   # 仅停止本启动器记录的进程
"""
from __future__ import annotations

import argparse
import csv
from contextlib import closing
import json
import locale
import os
import shutil
import signal
import sqlite3
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
DEMO_DIR = ROOT / "data" / "demo"
DEMO_DB = DEMO_DIR / "formflow.db"
DEMO_STORAGE = DEMO_DIR / "storage"
PID_FILE = DEMO_DIR / "services.json"
SEED_MARKER = DEMO_DIR / "seeded.json"
LOG_DIR = DEMO_DIR / "logs"
DEFAULT_API_PORT = 8000
API_PORT = DEFAULT_API_PORT
WORKER_READY_MARKER = b"[worker] ready"
WORKER_READY_TIMEOUT = 15.0
EXPECTED_AGENT_RUNTIME_CONTRACT_VERSION = 1

ENV = {
    "FORMFLOW_DATABASE_URL": f"sqlite:///{DEMO_DB}",
    "FORMFLOW_STORAGE_DIR": str(DEMO_STORAGE),
    "FORMFLOW_LLM_API_KEY": "",
    "PATH": os.environ.get("PATH", ""),
}


def valid_port(value: str) -> int:
    try:
        port = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("port must be an integer from 1 to 65535") from exc
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("port must be an integer from 1 to 65535")
    return port


def command_env() -> dict[str, str]:
    return {**os.environ, **ENV}


def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    print(f"  $ {' '.join(cmd)}")
    return subprocess.run(cmd, cwd=str(ROOT), env=command_env(), **kw)


def check_deps() -> bool:
    sys.dont_write_bytecode = True
    try:
        import fastapi  # noqa: F401
        import sqlalchemy  # noqa: F401
        import uvicorn  # noqa: F401
        return True
    except ImportError:
        return False


def install_deps() -> bool:
    print("[2/5] 安装依赖...")
    result = run([sys.executable, "-m", "pip", "install", "-q", "--require-hashes", "-r", "requirements.lock"])
    return result.returncode == 0 and check_deps()


def seed_demo() -> bool:
    """Run the destructive seed command and show its one-time credentials."""
    print("[3/5] 写入演示种子数据...")
    # Keep subprocess output as bytes: on Windows, a child process can still
    # write through the active console code page even when the parent uses
    # UTF-8 mode. Decoding after communicate prevents the reader thread from
    # failing before we can report the seed result.
    result = run([sys.executable, "scripts/seed_demo.py"], capture_output=True)

    def decode_output(raw: bytes | str | None) -> str:
        if not raw:
            return ""
        if isinstance(raw, str):
            return raw
        for encoding in ("utf-8", "mbcs"):
            try:
                return raw.decode(encoding)
            except UnicodeDecodeError:
                continue
        return raw.decode("utf-8", errors="replace")

    stdout = decode_output(result.stdout)
    stderr = decode_output(result.stderr)
    if stdout:
        print(stdout, end="" if stdout.endswith("\n") else "\n")
    if stderr:
        print(stderr, file=sys.stderr, end="" if stderr.endswith("\n") else "\n")
    if result.returncode:
        print(f"种子数据写入失败（退出码 {result.returncode}）。")
        return False
    return True


def port_available(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def reset_demo_data() -> None:
    """Remove only the isolated demo database and its files."""
    demo_dir = DEMO_DIR.resolve()
    expected = (ROOT / "data" / "demo").resolve()
    if demo_dir != expected or demo_dir.parent != (ROOT / "data").resolve():
        raise RuntimeError(f"拒绝删除非演示目录：{demo_dir}")
    for path in DEMO_DIR.glob("formflow.db*"):
        if path.is_file():
            path.unlink()
    for path in (DEMO_STORAGE, LOG_DIR):
        if path.exists():
            shutil.rmtree(path)
    for path in (PID_FILE, SEED_MARKER):
        if path.exists():
            path.unlink()


def prepare_demo_data(reset: bool = False) -> bool | None:
    """Initialize the isolated demo database once, preserving existing state."""
    retry_seed = SEED_MARKER.exists() and SEED_MARKER.read_text(encoding="utf-8") == "pending\n"
    db_existed = DEMO_DB.exists()
    if reset:
        reset_demo_data()
        db_existed = False
        retry_seed = False
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    DEMO_STORAGE.mkdir(parents=True, exist_ok=True)
    if not db_existed or retry_seed:
        SEED_MARKER.write_text("pending\n", encoding="utf-8")
        if not seed_demo():
            return None
        SEED_MARKER.write_text("initialized\n", encoding="utf-8")
        return True
    print("[3/5] 已保留现有演示数据；如需重置请使用 --reset")
    return False


def _open_log(name: str):
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return (LOG_DIR / f"{name}.log").open("ab")


def _start_process(name: str, command: list[str]) -> subprocess.Popen:
    log = _open_log(name)
    try:
        proc = subprocess.Popen(
            command,
            cwd=str(ROOT),
            env=command_env(),
            stdin=subprocess.DEVNULL,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0),
            start_new_session=(sys.platform != "win32"),
        )
    finally:
        log.close()
    return proc


def start_api_bg() -> subprocess.Popen | None:
    print("[4/5] 启动 API 服务...")
    proc = _start_process("api", [
        sys.executable, "-m", "uvicorn", "app.main:app",
        "--host", "127.0.0.1", "--port", str(API_PORT),
    ])
    for _ in range(15):
        if proc.poll() is not None:
            break
        _, healthy = api_health_status()
        if healthy:
            print(f"  API 已就绪: http://127.0.0.1:{API_PORT}/")
            return proc
        time.sleep(1)
    print(f"  API 未能就绪，请查看日志：{LOG_DIR / 'api.log'}")
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return None


def start_worker_bg(timeout: float = WORKER_READY_TIMEOUT) -> subprocess.Popen | None:
    print("[5/5] 启动 Worker...")
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = LOG_DIR / "worker.log"
    log_offset = log_path.stat().st_size if log_path.exists() else 0
    proc = _start_process("worker", [sys.executable, "-u", "-m", "app.worker"])
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            print(f"  Worker 启动失败，请查看日志：{log_path}")
            return None
        try:
            with log_path.open("rb") as log:
                log.seek(log_offset)
                if any(line.strip() == WORKER_READY_MARKER for line in log):
                    print("  Worker 已就绪")
                    return proc
        except OSError:
            pass
        time.sleep(0.25)

    print(f"  Worker 就绪超时，请查看日志：{log_path}")
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
    return None


def write_processes(processes: dict[str, int]) -> None:
    DEMO_DIR.mkdir(parents=True, exist_ok=True)
    temp_file = PID_FILE.with_suffix(".tmp")
    temp_file.write_text(json.dumps(processes), encoding="utf-8")
    temp_file.replace(PID_FILE)


def stop_demo() -> None:
    """Stop only processes whose PIDs were recorded by this launcher."""
    if not PID_FILE.exists():
        print("没有由启动器登记的演示进程。")
        return
    try:
        processes = json.loads(PID_FILE.read_text(encoding="utf-8"))
        if not isinstance(processes, dict):
            raise ValueError("invalid process registry")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print(f"无法读取演示进程记录：{exc}", file=sys.stderr)
        return

    status = []
    for name, pid in processes.items():
        if name not in {"api", "worker"} or not isinstance(pid, int):
            continue
        label = "API" if name == "api" else "Worker"
        try:
            if not process_is_running(pid):
                status.append(f"{label} 已退出")
                continue
            if sys.platform == "win32":
                # Windows 原生命令使用当前代码页输出；不需要读取输出时保留字节，
                # 避免 PYTHONUTF8=1 下把中文 taskkill 输出误按 UTF-8 解码。
                result = subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"],
                                         check=False, capture_output=True)
                if result.returncode and process_is_running(pid):
                    status.append(f"{label} 停止失败")
                    continue
            else:
                os.kill(pid, signal.SIGTERM)
            status.append(f"{label} 已停止")
        except ProcessLookupError:
            status.append(f"{label} 已退出")
        except OSError:
            status.append(f"{label} 停止失败")
    PID_FILE.unlink(missing_ok=True)
    print(f"演示进程状态：{'；'.join(status) if status else '没有可停止的登记进程'}")


def demo_database_status() -> tuple[str, bool]:
    if not DEMO_DB.is_file():
        return "尚未初始化", False

    if SEED_MARKER.is_file() and SEED_MARKER.read_text(encoding="utf-8") == "pending\n":
        return "上次播种未完成；正常启动时会自动重试", False

    try:
        uri = f"{DEMO_DB.resolve().as_uri()}?mode=ro"
        with closing(sqlite3.connect(uri, uri=True, timeout=2)) as db:
            integrity = db.execute("PRAGMA quick_check(1)").fetchone()
            if not integrity or integrity[0] != "ok":
                return f"完整性检查失败：{integrity[0] if integrity else '无结果'}", False

            tables = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'")}
            required = {"accounts", "tasks", "subjects"}
            missing = sorted(required - tables)
            if missing:
                return f"缺少核心数据表：{', '.join(missing)}", False

            demo_account = db.execute(
                "SELECT count(*) FROM accounts WHERE username = 'demo'").fetchone()[0]
            tasks = db.execute("SELECT count(*) FROM tasks").fetchone()[0]
            subjects = db.execute("SELECT count(*) FROM subjects").fetchone()[0]
            if not demo_account or not tasks or not subjects:
                return "数据库结构正常，但演示账号、任务或主体种子不完整", False
    except (OSError, sqlite3.Error) as exc:
        return f"无法只读打开或检查：{exc}", False

    return "已就绪（完整性与演示种子正常）", True


def api_listener_status() -> bool:
    try:
        with socket.create_connection(("127.0.0.1", API_PORT), timeout=0.25):
            return True
    except OSError:
        return False


def api_health_status() -> tuple[str, bool]:
    if not api_listener_status():
        return "未监听", False
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/api/health", timeout=0.5) as response:
            status = response.status
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return "HTTP 404 · 当前端口不是本版演示 API（请为新版选择空闲端口）", False
        return f"HTTP {exc.code}", False
    except (urllib.error.URLError, TimeoutError, OSError):
        return "端口有监听，但 HTTP 检查失败", False
    except (UnicodeDecodeError, json.JSONDecodeError):
        return "响应不是有效的 FormFlow 健康信息", False
    if status != 200:
        return f"HTTP {status}", False
    if not isinstance(payload, dict) or payload.get("service") != "formflow":
        return "端口被其他服务占用", False
    version = payload.get("agent_runtime_contract_version")
    if version != EXPECTED_AGENT_RUNTIME_CONTRACT_VERSION:
        return f"Agent runtime 合同不匹配（服务端 {version!r}，当前需要 {EXPECTED_AGENT_RUNTIME_CONTRACT_VERSION}）", False
    return f"HTTP {status} · FormFlow 合同 v{version}", True


def process_is_running(pid: int) -> bool:
    if pid <= 0:
        return False
    if sys.platform == "win32":
        result = subprocess.run(
            ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
            check=False, capture_output=True, text=True, encoding="mbcs", errors="replace",
        )
        if result.returncode:
            return False
        output = result.stdout or ""
        if isinstance(output, bytes):
            try:
                output = output.decode("mbcs", errors="replace")
            except LookupError:
                # ``mbcs`` is available on Windows, but this branch is also
                # exercised by cross-platform tests that simulate tasklist.
                output = output.decode(locale.getpreferredencoding(False), errors="replace")
        return any(len(row) > 1 and row[1] == str(pid) for row in csv.reader(output.splitlines()))
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def registered_process_status() -> str:
    if not PID_FILE.exists():
        return "无启动器进程登记"
    try:
        processes = json.loads(PID_FILE.read_text(encoding="utf-8"))
        if not isinstance(processes, dict):
            raise ValueError("进程登记格式无效")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return f"进程登记不可读：{exc}"

    states = []
    for name in ("api", "worker"):
        pid = processes.get(name)
        if not isinstance(pid, int) or isinstance(pid, bool):
            states.append(f"{name}=未登记")
        else:
            state = "运行中" if process_is_running(pid) else "已退出"
            states.append(f"{name} PID {pid} {state}")
    return "；".join(states)


def worker_health_status() -> tuple[str, bool]:
    """Report whether the registered worker is alive and has emitted its ready marker."""
    if not PID_FILE.exists():
        return "Worker 未登记", False
    try:
        processes = json.loads(PID_FILE.read_text(encoding="utf-8"))
        worker_pid = processes.get("worker") if isinstance(processes, dict) else None
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return f"Worker 登记不可读：{exc}", False
    if not isinstance(worker_pid, int) or isinstance(worker_pid, bool):
        return "Worker 未登记", False
    if not process_is_running(worker_pid):
        return f"Worker PID {worker_pid} 已退出", False
    log_path = LOG_DIR / "worker.log"
    try:
        ready = any(line.strip() == WORKER_READY_MARKER for line in log_path.read_bytes().splitlines())
    except OSError:
        ready = False
    if not ready:
        return f"Worker PID {worker_pid} 运行中但未见 ready", False
    return f"Worker PID {worker_pid} 运行中 · ready", True


def agent_runtime_status() -> tuple[str, bool]:
    """Validate the local Agent runtime contract without reading task materials."""
    try:
        from app.agents.tooling import RULE_REVIEW_SKILL, review_tool_manifest
        from app.services.agent_runtime import AGENT_RUNTIME_CONTRACT_VERSION

        tools = review_tool_manifest()
        if AGENT_RUNTIME_CONTRACT_VERSION != EXPECTED_AGENT_RUNTIME_CONTRACT_VERSION:
            return (
                f"合同版本 {AGENT_RUNTIME_CONTRACT_VERSION!r} 不匹配，"
                f"当前需要 {EXPECTED_AGENT_RUNTIME_CONTRACT_VERSION}",
                False,
            )
        if not RULE_REVIEW_SKILL.name or RULE_REVIEW_SKILL.max_steps <= 0 or not tools:
            return "Skill 或受限工具清单不完整", False
        return f"合同 v{AGENT_RUNTIME_CONTRACT_VERSION} · Skill 已加载 · 工具 {len(tools)} 项", True
    except Exception as exc:  # pragma: no cover - dependency/import failures are environment-specific
        return f"Agent runtime 不可加载：{exc}", False


def mcp_bridge_status() -> tuple[str, bool]:
    """Perform a bounded stdio handshake so readiness catches protocol failures."""
    try:
        import asyncio

        from mcp import Client
        from mcp.client.stdio import StdioServerParameters

        expected = {
            "list_my_tasks",
            "get_task_collection_progress",
            "get_task_next_step",
            "get_task_agent_runtime",
        }
        probe_env = command_env()
        # Listing tools does not call the API, but the server still requires a
        # syntactically valid local endpoint and a non-empty session token.
        probe_env.update({
            "FORMFLOW_MCP_API_URL": "http://127.0.0.1:1",
            "FORMFLOW_MCP_TOKEN": "readiness-probe",
        })
        params = StdioServerParameters(
            command=sys.executable,
            args=["-m", "app.mcp_server"],
            env=probe_env,
            cwd=str(ROOT),
        )

        async def probe() -> tuple[set[str], bool]:
            async with Client(params, read_timeout_seconds=3) as client:
                result = await asyncio.wait_for(client.list_tools(), timeout=3)
                tools = list(result.tools)
                return (
                    {tool.name for tool in tools},
                    all(bool(tool.annotations and tool.annotations.read_only_hint) for tool in tools),
                )

        names, read_only = asyncio.run(probe())
        if names != expected:
            return f"stdio MCP 工具清单不匹配（发现 {len(names)} 项）", False
        if not read_only:
            return "stdio MCP 工具未全部标记为只读", False
        return f"stdio MCP 协议可用 · {len(names)} 项只读工具", True
    except Exception as exc:  # pragma: no cover - dependency/import failures are environment-specific
        return f"MCP 只读桥握手失败：{exc}", False


def check_status() -> bool:
    deps_ok = check_deps()
    database_status, database_ok = demo_database_status()
    print(f"Python 依赖：{'已就绪' if deps_ok else '缺少'}")
    print(f"演示数据库：{database_status} ({DEMO_DB})")
    api_state, api_ok = api_health_status()
    print(f"API 健康检查：{api_state} (127.0.0.1:{API_PORT}/api/health)")
    worker_state, worker_ok = worker_health_status()
    print(f"Worker：{worker_state}")
    runtime_state, runtime_ok = agent_runtime_status()
    print(f"Agent runtime：{runtime_state}")
    mcp_state, mcp_ok = mcp_bridge_status()
    print(f"MCP 只读桥：{mcp_state}")
    print(f"登记进程：{registered_process_status()}")
    if LOG_DIR.exists():
        print(f"日志目录：{LOG_DIR}")
    ready = deps_ok and database_ok and api_ok and worker_ok and runtime_ok and mcp_ok
    print(f"演示就绪：{'是' if ready else '否'}")
    return ready


def main() -> int:
    parser = argparse.ArgumentParser(description="FormFlow 演示环境一键启动")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--check", action="store_true", help="只读检查，不安装、不写入、不启动")
    mode.add_argument("--reset", action="store_true", help="重置隔离演示数据后启动")
    mode.add_argument("--stop", action="store_true", help="停止启动器登记的演示进程")
    parser.add_argument("--port", type=valid_port, default=DEFAULT_API_PORT,
                        help=f"API 监听端口（默认：{DEFAULT_API_PORT}）")
    args = parser.parse_args()

    if args.stop:
        stop_demo()
        return 0
    global API_PORT
    API_PORT = args.port
    if args.check:
        return 0 if check_status() else 1

    print("=" * 56)
    print("  FormFlow 收齐啦 · 演示环境一键启动")
    print("=" * 56)
    print(f"[1/5] 检查环境... Python {sys.version.split()[0]}")

    if not check_deps():
        if not install_deps():
            print("依赖安装失败，请检查 Python/pip 和 requirements.lock。", file=sys.stderr)
            return 1
    else:
        print("  依赖已就绪")

    if args.reset:
        stop_demo()
        for _ in range(5):
            if port_available(API_PORT):
                break
            time.sleep(1)

    if not port_available(API_PORT):
        print(f"端口 127.0.0.1:{API_PORT} 已被占用；未修改演示数据。", file=sys.stderr)
        return 1

    seed_result = prepare_demo_data(reset=args.reset)
    if seed_result is None:
        return 1
    seeded = seed_result

    api_proc = start_api_bg()
    if api_proc is None:
        return 1
    worker_proc = start_worker_bg()
    if worker_proc is None:
        print("Worker 启动失败，正在停止 API。", file=sys.stderr)
        api_proc.terminate()
        try:
            api_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            api_proc.kill()
        return 1
    write_processes({"api": api_proc.pid, "worker": worker_proc.pid})

    print("\n" + "=" * 56)
    print("  演示环境已启动！")
    print(f"  访问地址: http://127.0.0.1:{API_PORT}/")
    print("  组织者: demo / demo1234")
    if seeded:
        print("  提交者凭证已在上方种子输出中显示")
    else:
        print("  提交者凭证沿用已有演示数据")
    print(f"  API 日志: {LOG_DIR / 'api.log'}")
    print(f"  Worker 日志: {LOG_DIR / 'worker.log'}")
    print("  停止服务: python scripts/start_demo.py --stop")
    print("  演示边界: 离线种子为脚本桩，无模型密钥时 AI 起草不可用")
    print("=" * 56)

    try:
        api_proc.wait()
    except KeyboardInterrupt:
        print("\n正在停止演示服务...")
    finally:
        for proc in (worker_proc, api_proc):
            if proc.poll() is None:
                proc.terminate()
        for proc in (worker_proc, api_proc):
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        PID_FILE.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
