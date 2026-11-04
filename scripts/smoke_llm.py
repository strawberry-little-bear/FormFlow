# -*- coding: utf-8 -*-
"""真实网关冒烟：用 .env 真实配置跑通「需求 Agent 起草 → 澄清/修改意见修订」全链路。

用法: python scripts/smoke_llm.py
- 不写数据库、不污染演示数据，仅打印耗时/是否降级/程序校验/修改影响；
- 用于在真实模型（如 glm-5.3，慢且不稳定）下验证网关连通性与降级兜底链路。
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.agents.requirements_agent import (  # noqa: E402
    blueprint_diff,
    draft_blueprint,
    validate_blueprint,
)
from app.config import settings  # noqa: E402
from app.llm import LLMClient  # noqa: E402

# 方案附录 BP-C-001 虚构样例（docs/plan_extracted.txt 第 13 节）
REQUIREMENT = (
    "收名单内同学的“2026 秋季第 1 期”团课报告，包含本人姓名、期次、活动内容和个人收获，"
    "按班级整理。接受一份 PDF 或 DOCX，最大 10 MiB、20 页，组织者最终人工验收。"
    "不加字数、签到、签名、思想评价或 AI 写作判断。"
    "任务时区 Asia/Shanghai。2026 年 11 月 1 日开放；须在 11 月 8 日 18:00 前完成首次正式提交；"
    "已有正式提交者可在 11 月 10 日 18:00 前补正。"
)


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)
    if not settings.llm_configured:
        print("未配置 FORMFLOW_LLM_API_KEY（.env），终止")
        return 2
    client = LLMClient(
        base_url=settings.llm_base_url,
        api_key=settings.llm_api_key,
        model=settings.llm_model,
        fallback_model=settings.llm_fallback_model,
    )
    print(f"网关: {client.base_url}  主模型: {client.model}  "
          f"降级模型: {client.fallback_model or '(无)'}  "
          f"主模型时限: {client.primary_timeout:.0f}s  超时上限: {client.timeout:.0f}s")

    print("\n== 1) 首次起草 ==")
    t0 = time.time()
    draft = draft_blueprint(REQUIREMENT, client=client)
    t1 = time.time()
    print(f"耗时 {t1 - t0:.1f}s，降级触发: {client.fallback_used}")
    print(f"澄清 {len(draft.clarifications)} 个: "
          + "; ".join(c.question for c in draft.clarifications))
    tp = draft.blueprint.time_policy
    print(f"草案时间策略: 开放 {tp.open_at} / 首次截止 {tp.first_deadline} / 补正截止 {tp.correction_deadline}")
    if draft.warnings:
        print(f"草案警告: {draft.warnings}")
    errs = validate_blueprint(draft.blueprint, REQUIREMENT)
    print(f"程序校验: {'通过' if not errs else errs}")

    print("\n== 2) 澄清回答 + 修改意见修订 ==")
    answered = {c.question: "不接受手写扫描件，仅电子版" for c in draft.clarifications} or \
               {"材料是否接受手写扫描件": "不接受，仅电子版"}
    instruction = "首次提交截止调整为 2026-11-09 18:00；材料格式在 PDF/DOCX 之外也接受 Markdown（md）。"
    t2 = time.time()
    revised = draft_blueprint(
        REQUIREMENT, answered=answered, current_draft=draft.blueprint,
        instruction=instruction, client=client,
    )
    t3 = time.time()
    print(f"耗时 {t3 - t2:.1f}s，降级触发: {client.fallback_used}")
    impact = blueprint_diff(draft.blueprint, revised.blueprint)
    print(f"修改影响: {impact['summary']}")
    print(f"修订后截止: {revised.blueprint.time_policy.first_deadline}  "
          f"槽位格式: {[s.formats for s in revised.blueprint.slots]}")
    if revised.warnings:
        print(f"修订警告: {revised.warnings}")
    errs2 = validate_blueprint(revised.blueprint, REQUIREMENT)
    print(f"修订后程序校验: {'通过' if not errs2 else errs2}")
    print("\n冒烟完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
