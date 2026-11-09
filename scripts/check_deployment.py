#!/usr/bin/env python
"""Run read-only checks before starting a FormFlow deployment."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import stat
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings, settings


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


def deployment_issues(
    *,
    allow_offline: bool,
    secret_file: Path | None = None,
    config: Settings | None = None,
) -> tuple[list[str], list[str]]:
    """Return production configuration problems without changing the filesystem."""
    config = config or settings
    errors: list[str] = []
    warnings: list[str] = []

    if config.environment != "production":
        errors.append("FORMFLOW_ENV 必须设置为 production")
    if config.allow_registration:
        errors.append("生产环境必须关闭 FORMFLOW_ALLOW_REGISTRATION")
    if not getattr(config, "llm_input_mode_valid", True):
        errors.append(
            "FORMFLOW_LLM_INPUT_MODE 无效；请使用 auto、direct、text 或 ocr"
        )

    database_url = config.database_url.replace("\\", "/")
    storage_dir = _resolved(config.storage_dir)
    if "/data/demo" in database_url or storage_dir.name == "demo":
        errors.append("数据库或附件目录仍指向演示数据")

    file_secret_configured = False
    if secret_file is not None:
        try:
            file_secret_configured = secret_file.is_file() and secret_file.stat().st_size > 0
            if file_secret_configured and os.name != "nt":
                mode = stat.S_IMODE(secret_file.stat().st_mode)
                if mode & 0o077:
                    errors.append(f"模型 Secret 文件权限过宽（应为 600）：{secret_file}")
        except OSError:
            errors.append(f"模型 Secret 文件无法读取：{secret_file}")

    if not config.llm_configured and not file_secret_configured:
        if allow_offline:
            warnings.append("未配置模型密钥：将以离线/人工接手模式运行")
        else:
            errors.append("未配置模型密钥；如需离线运行请加 --allow-offline")
    else:
        if config.llm_base_url == "https://your-provider.example/v1":
            errors.append("FORMFLOW_LLM_BASE_URL 仍是占位地址")
        if config.llm_model == "your-model":
            errors.append("FORMFLOW_LLM_MODEL 仍是占位模型")
        if config.llm_base_url.startswith("http://") and not _is_local_url(config.llm_base_url):
            errors.append("公网模型地址必须使用 HTTPS")

    storage_parent = storage_dir if storage_dir.exists() else storage_dir.parent
    if not storage_parent.exists():
        errors.append(f"附件目录及其父目录不存在：{storage_dir}")
    elif not storage_parent.is_dir():
        errors.append(f"附件目录父路径不是目录：{storage_parent}")
    elif not _can_write(storage_parent):
        errors.append(f"附件目录父路径不可写：{storage_parent}")

    heartbeat_parent = _resolved(config.worker_heartbeat_file).parent
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
    parser.add_argument("--secret-file", type=Path, help="只检查文件型模型 Secret 非空，不读取或打印内容")
    parser.add_argument("--env-file", type=Path,
                        help="读取指定环境文件后检查，不修改当前 .env 或写入文件")
    args = parser.parse_args(argv)

    config = settings
    if args.env_file:
        env_file = args.env_file.expanduser().resolve()
        if not env_file.is_file():
            print(f"FAIL  环境文件不存在：{env_file}", file=sys.stderr)
            return 1
        # Make the file authoritative instead of accidentally inheriting a
        # developer's FORMFLOW_* values from the process or local .env.
        for key in tuple(os.environ):
            if key.startswith("FORMFLOW_"):
                os.environ.pop(key, None)
        load_dotenv(env_file, override=True)
        config = Settings()

    errors, warnings = deployment_issues(
        allow_offline=args.allow_offline,
        secret_file=args.secret_file.expanduser().resolve() if args.secret_file else None,
        config=config,
    )
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
