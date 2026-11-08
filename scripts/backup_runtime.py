#!/usr/bin/env python
"""Back up and verify a production FormFlow SQLite runtime.

The database and private attachment directory are captured as one archive with
sha256 entries. The command reads paths from the same environment as API and
Worker, so it cannot silently back up a different instance.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sys

from dotenv import load_dotenv

# When invoked as ``python scripts/backup_runtime.py`` Python puts only the
# scripts directory on sys.path. Add the repository root so the documented
# command works from a clean checkout as well as via ``python -m`` imports.
ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import Settings, settings
from scripts.backup_demo import (
    BackupError,
    create_backup,
    restore_backup,
    verify_backup,
)


def configure_output_encoding() -> None:
    """Keep Chinese CLI diagnostics safe when stdout/stderr are redirected."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def runtime_data_dir(config: Settings | None = None) -> Path:
    """Return the configured data directory, rejecting unsupported layouts."""
    config = config or settings
    url = config.database_url
    if not url.startswith("sqlite:///"):
        raise BackupError("当前备份工具只支持 SQLite；共享数据库应使用供应商原生备份")
    raw_path = url.split("///", 1)[1]
    database = Path(raw_path).expanduser().resolve()
    data_dir = database.parent
    storage = Path(config.storage_dir).expanduser().resolve()
    if database.name != "formflow.db":
        raise BackupError("数据库文件名必须是 formflow.db，避免恢复到错误实例")
    if storage != data_dir / "storage":
        raise BackupError("FORMFLOW_STORAGE_DIR 必须是数据库目录下的 storage")
    return data_dir


def default_output(data_dir: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return data_dir.parent / "backups" / f"formflow-{stamp}.zip"


def main(argv: list[str] | None = None) -> int:
    configure_output_encoding()
    parser = argparse.ArgumentParser(description="备份、校验和恢复 FormFlow 生产 SQLite 数据")
    parser.add_argument("--env-file", type=Path,
                        help="读取指定环境文件后执行，不修改当前 .env")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create", help="在线备份数据库与附件")
    create.add_argument("--output", type=Path)
    verify = subparsers.add_parser("verify", help="在临时目录校验并实际恢复备份")
    verify.add_argument("archive", type=Path)
    restore = subparsers.add_parser("restore", help="恢复到一个新的数据目录，不覆盖现有目录")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--target", required=True, type=Path)
    args = parser.parse_args(argv)

    try:
        config = settings
        if args.env_file:
            env_file = args.env_file.expanduser().resolve()
            if not env_file.is_file():
                raise BackupError(f"环境文件不存在：{env_file}")
            for key in tuple(os.environ):
                if key.startswith("FORMFLOW_"):
                    os.environ.pop(key, None)
            load_dotenv(env_file, override=True)
            config = Settings()
        if args.command == "create":
            data_dir = runtime_data_dir(config)
            output = args.output or default_output(data_dir)
            result = create_backup(data_dir, output, data_dir / "services.json")
            print(f"生产备份已创建：{result}")
        elif args.command == "verify":
            manifest = verify_backup(args.archive)
            print(f"备份校验通过：{len(manifest['files'])} 个文件；SQLite 完整性正常")
        else:
            result = restore_backup(args.archive, args.target)
            print(f"已恢复到新数据目录：{result}")
    except BackupError as exc:
        print(f"备份操作失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
