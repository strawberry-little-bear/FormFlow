#!/usr/bin/env python
"""Create one organizer account from the deployment environment.

The password is requested through getpass so it does not appear in shell
history, process arguments, or application logs.
"""
from __future__ import annotations

import argparse
import getpass
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Windows runners and older PowerShell hosts can expose a legacy code page;
# help and validation messages should never make account setup crash.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="backslashreplace")


def _load_environment(env_file: Path | None) -> int:
    """Load an explicit deployment environment before importing app modules."""
    if env_file is None:
        return 0

    resolved = env_file.expanduser().resolve()
    if not resolved.is_file():
        print(f"环境文件不存在：{resolved}", file=sys.stderr)
        return 1

    # A production file must not accidentally inherit a developer database or
    # storage path from the shell that launched this command.
    for key in tuple(os.environ):
        if key.startswith("FORMFLOW_"):
            os.environ.pop(key, None)
    os.environ.pop("PYTHON_DOTENV_DISABLED", None)
    load_dotenv(resolved, override=True)
    # app.config normally discovers a local .env at import time. The explicit
    # file above is authoritative for this invocation, so disable discovery.
    os.environ["PYTHON_DOTENV_DISABLED"] = "1"
    return 0


def _read_passwords(from_stdin: bool) -> tuple[str, str]:
    if from_stdin:
        return (sys.stdin.readline().rstrip("\r\n"),
                sys.stdin.readline().rstrip("\r\n"))
    return (getpass.getpass("密码（至少 8 位）："),
            getpass.getpass("再次输入密码："))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="创建一个 FormFlow 组织者账号")
    parser.add_argument("--username", required=True, help="组织者登录名")
    parser.add_argument("--env-file", type=Path,
                        help="读取指定环境文件后创建账号，不修改当前 .env")
    parser.add_argument("--password-stdin", action="store_true",
                        help="从标准输入读取两行密码（自动化部署用）")
    args = parser.parse_args(argv)

    if _load_environment(args.env_file):
        return 1

    # Import after environment setup: app.db creates its engine at import time.
    from sqlalchemy import select

    from app.db import SessionLocal, init_db
    from app.models import Account
    from app.security import hash_password, new_salt

    username = args.username.strip()
    if not username:
        print("用户名不能为空。", file=sys.stderr)
        return 2
    if len(username) > 120:
        print("用户名不能超过 120 个字符。", file=sys.stderr)
        return 2
    password, confirmation = _read_passwords(args.password_stdin)
    if len(password) < 8:
        print("密码至少需要 8 位。", file=sys.stderr)
        return 2
    if password != confirmation:
        print("两次输入的密码不一致。", file=sys.stderr)
        return 2

    init_db()
    with SessionLocal() as db:
        if db.scalar(select(Account).where(Account.username == username)):
            print("用户名已存在。", file=sys.stderr)
            return 1
        salt = new_salt()
        db.add(Account(username=username, password_hash=hash_password(password, salt),
                       password_salt=salt))
        db.commit()
    print(f"组织者账号已创建：{username}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
