#!/usr/bin/env python
"""一键启动 FormFlow 演示环境。

用法：
    python scripts/start_demo.py          # 启动 API + Worker（后台）
    python scripts/start_demo.py --check  # 仅检查依赖和种子状态
    python scripts/start_demo.py --stop   # 停止已运行的演示服务

自动完成：
1. 检查 Python 虚拟环境
2. 安装依赖（如未安装）
3. 设置隔离数据库和存储目录
4. 种子演示数据
5. 后台启动 API 和 Worker
6. 打印登录凭证和访问地址
"""
from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEMO_DB = ROOT / "data" / "demo" / "formflow.db"
DEMO_STORAGE = ROOT / "data" / "demo" / "storage"
API_PORT = 8000

ENV = {
    "FORMFLOW_DATABASE_URL": f"sqlite:///{DEMO_DB}",
    "FORMFLOW_STORAGE_DIR": str(DEMO_STORAGE),
    "FORMFLOW_LLM_API_KEY": "",
    "PATH": os.environ.get("PATH", ""),
}


def run(cmd: list[str], **kw) -> int:
    """Run a command, streaming output."""
    print(f"  $ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(ROOT), env={**os.environ, **ENV}, **kw)
    return result.returncode


def check_deps() -> bool:
    """Check if key dependencies are installed."""
    try:
        import fastapi  # noqa: F401
        import sqlalchemy  # noqa: F401
        return True
    except ImportError:
        return False


def install_deps():
    """Install requirements."""
    print("[2/5] 安装依赖...")
    pip = sys.executable.replace("python", "pip").replace("Scripts\\python.exe", "Scripts\\pip.exe")
    if not Path(pip).exists():
        pip = f"{sys.executable} -m pip"
    if isinstance(pip, str):
        run(pip.split() + ["install", "-q", "-r", "requirements.txt"])
    else:
        run([pip, "install", "-q", "-r", "requirements.txt"])


def seed_demo():
    """Seed demo data."""
    print("[3/5] 写入演示种子数据...")
    run([sys.executable, "scripts/seed_demo.py"], capture_output=True, text=True)


def start_api_bg() -> subprocess.Popen:
    """Start API server in background."""
    print("[4/5] 启动 API 服务...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "app.main:app",
         "--host", "127.0.0.1", "--port", str(API_PORT)],
        cwd=str(ROOT),
        env={**os.environ, **ENV},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    # Wait for server to be ready
    import urllib.request
    for _ in range(15):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{API_PORT}/docs", timeout=1)
            print(f"  API 已就绪: http://127.0.0.1:{API_PORT}/")
            return proc
        except Exception:
            time.sleep(1)
    print("  警告: API 未在 15 秒内就绪，请检查日志")
    return proc


def start_worker_bg() -> subprocess.Popen:
    """Start worker in background."""
    print("[5/5] 启动 Worker...")
    proc = subprocess.Popen(
        [sys.executable, "-m", "app.worker"],
        cwd=str(ROOT),
        env={**os.environ, **ENV},
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(2)
    print("  Worker 已启动")
    return proc


def stop_demo():
    """Stop running demo services."""
    print("停止演示服务...")
    try:
        # Try to find and kill uvicorn and worker processes
        for proc in ["uvicorn", "app.worker"]:
            subprocess.run(
                ["taskkill", "/f", "/im", proc] if sys.platform == "win32"
                else ["pkill", "-f", proc],
                capture_output=True,
            )
        print("已停止")
    except Exception:
        pass


def main():
    parser = argparse.ArgumentParser(description="FormFlow 演示环境一键启动")
    parser.add_argument("--check", action="store_true", help="仅检查，不启动")
    parser.add_argument("--stop", action="store_true", help="停止演示服务")
    args = parser.parse_args()

    if args.stop:
        stop_demo()
        return

    print("=" * 56)
    print("  FormFlow 收齐啦 · 演示环境一键启动")
    print("=" * 56)

    # Step 1: Check environment
    print(f"[1/5] 检查环境... Python {sys.version.split()[0]}")

    # Step 2: Install deps if needed
    if not check_deps():
        install_deps()
    else:
        print("  依赖已就绪")

    # Step 3: Seed demo data
    DEMO_DB.parent.mkdir(parents=True, exist_ok=True)
    (DEMO_STORAGE / "tmp").mkdir(parents=True, exist_ok=True)
    seed_demo()

    if args.check:
        print("\n检查完成，未启动服务。")
        return

    # Step 4-5: Start API + Worker
    api_proc = start_api_bg()
    worker_proc = start_worker_bg()

    print("\n" + "=" * 56)
    print("  演示环境已启动！")
    print(f"  访问地址: http://127.0.0.1:{API_PORT}/")
    print("  组织者: demo / demo1234")
    print("  提交者凭证见种子脚本输出")
    print()
    print("  停止服务: python scripts/start_demo.py --stop")
    print("  演示边界: 离线种子为脚本桩，无模型密钥时 AI 起草不可用")
    print("=" * 56)

    try:
        api_proc.wait()
    except KeyboardInterrupt:
        print("\n正在停止...")
        api_proc.terminate()
        worker_proc.terminate()


if __name__ == "__main__":
    main()
