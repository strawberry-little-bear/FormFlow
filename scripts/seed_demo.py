"""命令行入口：写入 BP-C-001 演示数据（全部虚构）。

用法：
    python scripts/seed_demo.py
然后在浏览器打开 http://127.0.0.1:8000/ 用打印出的账号与凭证登录。
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db import SessionLocal, init_db  # noqa: E402
from app.services.demo_seed import seed_demo  # noqa: E402


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        summary = seed_demo(db)
    finally:
        db.close()
    print("=" * 56)
    print("演示数据已写入（BP-C-001 团课报告，全部虚构）")
    print(f"组织者账号：{summary['account']['username']} / {summary['account']['password']}")
    print(f"任务 ID：{summary['task_id']}")
    print("提交者凭证（仅显示这一次）：")
    for name, cred in summary["credentials"].items():
        print(f"  {name}: {cred}")
    print("启动服务：uvicorn app.main:app --reload")
    print("=" * 56)


if __name__ == "__main__":
    main()
