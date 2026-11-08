#!/usr/bin/env python
"""Run read-only checks before starting a FormFlow deployment."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import settings


def configure_output_encoding() -> None:
    """Keep Chinese diagnostics readable when stdout/stderr are redirected."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def _is_local_url(value: str) -> bool:
    return value.startswith(("http://127.0.0.1", "http://localhost", "http://[::1]"))


def _resolved(path: Path) -> Path:
    return path.expanduser().resolve()


def _can_write(path: Path) -> bool:
    """Check permission bits without creating a probe file."""
    return bool(os.access(path, os.W_OK))


def deployment_issues(*, allow_offline: bool) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if settings.environment != "production":
        errors.append("FORMFLOW_ENV 必须设置为 production")
    if settings.allow_registration:
        errors.append("生产环境必须关闭 FORMFLOW_ALLOW_REGISTRATION")

    database_url = settings.database_url.replace("\\", "/")
    storage_dir = _resolved(settings.storage_dir)
    if "/data/demo" in database_url or storage_dir.name == "demo":
        errors.append("数据库或附件目录仍指向演示数据")

    if not settings.llm_configured:
        if allow_offline:
            warnings.append("未配置模型密钥：将以离线/人工接手模式运行")
        else:
            errors.append("未配置模型密钥；如需离线运行请加 --allow-offline")
    else:
        if settings.llm_base_url == "https://your-provider.example/v1":
            errors.append("FORMFLOW_LLM_BASE_URL 仍是占位地址")
        if settings.llm_model == "your-model":
            errors.append("FORMFLOW_LLM_MODEL 仍是占位模型")
        if settings.llm_base_url.startswith("http://") and not _is_local_url(settings.llm_base_url):
            errors.append("公网模型地址必须使用 HTTPS")

    storage_parent = storage_dir if storage_dir.exists() else storage_dir.parent
    if not storage_parent.exists():
        errors.append(f"附件目录及其父目录不存在：{storage_dir}")
    elif not storage_parent.is_dir():
        errors.append(f"附件目录父路径不是目录：{storage_parent}")
    elif not _can_write(storage_parent):
        errors.append(f"附件目录父路径不可写：{storage_parent}")

    heartbeat_parent = _resolved(settings.worker_heartbeat_file).parent
    if heartbeat_parent != storage_dir:
        errors.append("FORMFLOW_WORKER_HEARTBEAT_FILE 必须位于 FORMFLOW_STORAGE_DIR 内")

    return errors, warnings


def check_url(base_url: str) -> list[str]:
    base = base_url.rstrip("/")
    failures: list[str] = []
    for path in ("/api/health", "/api/ready"):
        request = Request(f"{base}{path}", headers={"Accept": "application/json"})
        try:
            with urlopen(request, timeout=5) as response:
                if response.status != 200:
                    failures.append(f"{path} 返回 HTTP {response.status}")
        except HTTPError as exc:
            failures.append(f"{path} 返回 HTTP {exc.code}")
        except (URLError, OSError) as exc:
            failures.append(f"{path} 无法访问：{exc}")
    return failures


def main(argv: list[str] | None = None) -> int:
    configure_output_encoding()
    parser = argparse.ArgumentParser(description="只读检查 FormFlow 生产部署配置")
    parser.add_argument("--allow-offline", action="store_true", help="允许未配置模型密钥，以离线模式运行")
    parser.add_argument("--url", help="额外检查已启动实例的 /api/health 与 /api/ready")
    args = parser.parse_args(argv)

    errors, warnings = deployment_issues(allow_offline=args.allow_offline)
    errors.extend(check_url(args.url) if args.url else [])
    for warning in warnings:
        print(f"WARN  {warning}")
    for error in errors:
        print(f"FAIL  {error}", file=sys.stderr)
    if errors:
        print(f"部署预检失败：{len(errors)} 项必须处理", file=sys.stderr)
        return 1
    print("部署预检通过：生产边界、数据目录和模型配置可用")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
