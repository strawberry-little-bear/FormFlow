#!/usr/bin/env python
"""Create one organizer account from the deployment environment.

The password is requested through getpass so it does not appear in shell
history, process arguments, or application logs.
"""
from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

# Windows runners and older PowerShell hosts can expose a legacy code page;
# help and validation messages should never make account setup crash.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(errors="replace")

from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, init_db
from app.models import Account
from app.security import hash_password, new_salt


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="创建一个 FormFlow 组织者账号")
    parser.add_argument("--username", required=True, help="组织者登录名")
    args = parser.parse_args(argv)

    username = args.username.strip()
    if not username:
        print("用户名不能为空。", file=sys.stderr)
        return 2
    password = getpass.getpass("密码（至少 8 位）：")
    confirmation = getpass.getpass("再次输入密码：")
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
