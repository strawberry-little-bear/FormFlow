"""后台 Worker：解析、审核、打包等异步任务。

方案第 15 节：正式版本与检查意图可靠记录，避免数据库成功但队列任务丢失；
重试不重复建报名、验收或通知。当前阶段为进程内轮询，接口与队列实现解耦。

V20（队列失败、服务重启）恢复语义：
- 排队中的运行重启后由轮询自动接管，正式提交意图不丢失；
- 崩溃时停留在 running / retry_wait 的运行，启动时恢复为排队并清掉半成品结果，
  由后续轮询重新执行——不重复报名、不篡改已成功/已失败的历史运行；
- 每个运行完成后立即提交：批次中途崩溃不丢掉已完成运行。
"""
from __future__ import annotations

import time

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .db import SessionLocal
from .models import (
    RUN_QUEUED,
    RUN_RETRY_WAIT,
    RUN_RUNNING,
    Evidence,
    CheckRun,
    RuleResult,
)
from .services import tasks as task_service
from .services.checks import execute_run

# 中断未完成态：重启后需要恢复接管的运行状态（成功/失败/被取代都是历史，绝不动）
_INTERRUPTED_STATUSES = (RUN_RUNNING, RUN_RETRY_WAIT)


def _clear_partial_results(db: Session, run_id: int) -> None:
    """清除某次运行的中断半成品结果。

    运行未到达成功态即被中断，其结果与证据不属于历史，重新执行前必须清掉，
    避免同一规则出现重复结论。
    """
    rr_ids = [r.id for r in db.scalars(
        select(RuleResult).where(RuleResult.run_id == run_id)).all()]
    if rr_ids:
        db.execute(delete(Evidence).where(Evidence.rule_result_id.in_(rr_ids)))
        db.execute(delete(RuleResult).where(RuleResult.run_id == run_id))


def recover_interrupted_runs(db: Session) -> int:
    """启动恢复（V20 服务重启）：被中断的运行放回排队，返回恢复数量。"""
    stuck = db.scalars(select(CheckRun).where(
        CheckRun.status.in_(_INTERRUPTED_STATUSES))).all()
    for run in stuck:
        from_status = run.status
        _clear_partial_results(db, run.id)
        run.status = RUN_QUEUED
        db.flush()
        task_service.audit(db, "check.recovered", "check_run",
                           {"run_id": run.id, "from_status": from_status},
                           task_id=run.task_id, actor="worker")
    return len(stuck)


def run_pending_once(db: Session) -> int:
    """执行所有排队中的检查运行，返回处理数量。

    逐个提交：批次中途崩溃时，已完成的运行保持成功，未完成的留在队列下一轮重来。
    """
    runs = db.scalars(select(CheckRun).where(CheckRun.status == RUN_QUEUED)).all()
    n = 0
    for run in runs:
        execute_run(db, run)
        db.commit()
        n += 1
    return n


def main(poll_interval: float = 2.0) -> None:
    print("[worker] 启动，轮询检查队列…")
    db = SessionLocal()
    try:
        recovered = recover_interrupted_runs(db)
        db.commit()
        if recovered:
            print(f"[worker] 恢复 {recovered} 个被中断的检查运行（重新排队）")
    finally:
        db.close()
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
