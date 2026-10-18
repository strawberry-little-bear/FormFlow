"""后台 Worker：解析、审核、打包等异步任务。

方案第 15 节：正式版本与检查意图可靠记录，避免数据库成功但队列任务丢失；
重试不重复建报名、验收或通知。当前阶段为进程内轮询，接口与队列实现解耦。
"""
from __future__ import annotations

import time

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import RUN_QUEUED, CheckRun
from .services.checks import execute_run


def run_pending_once(db: Session) -> int:
    """执行所有排队中的检查运行。返回处理数量。"""
    runs = db.scalars(select(CheckRun).where(CheckRun.status == RUN_QUEUED)).all()
    for run in runs:
        execute_run(db, run)
    db.commit()
    return len(runs)


def main(poll_interval: float = 2.0) -> None:
    print("[worker] 启动，轮询检查队列…")
    while True:
        db = SessionLocal()
        try:
            n = run_pending_once(db)
            if n:
                print(f"[worker] 完成 {n} 个检查运行")
        except Exception as e:  # 故障不致命：保留任务，下轮重试
            print(f"[worker] 运行出错（将重试）: {e}")
        finally:
            db.close()
        time.sleep(poll_interval)


if __name__ == "__main__":
    main()
