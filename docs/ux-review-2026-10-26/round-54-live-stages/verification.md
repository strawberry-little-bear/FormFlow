# Round 54 · 展示首页运行阶段带

日期：2026-10-26  
环境：Windows / Chromium / 隔离演示 API `127.0.0.1:8014` / `FORMFLOW_LLM_API_KEY` 为空  
数据：`scripts/seed_demo.py` 生成的 5 人、1 任务虚构种子

## 本轮处理

任务首页的 `LIVE SHOWCASE STATE` 增加 `RUN STAGES` 运行阶段带，直接把最近一次服务端复核运行摘要压缩为四段：读取材料、程序核验、语义审核、人工接手。阶段值只来自已有的 `review_signal` 字段；离线演示结果明确标为“离线演示结果”，不根据模型配置猜测实时来源，也不把待人工规则说成已验收。

窄屏下阶段带从四列收为两列，320px 再收为单列；现有运行证据、复核入口和 Agent/MCP/人工边界继续保留。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：178 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check`：通过。
- 隔离服务浏览器走查：1440 / 390 / 320px 任务首页均渲染四段阶段带；`scrollWidth === clientWidth`，无横向溢出。
- 浏览器控制台错误：0；页面异常：0；隔离服务 4xx/5xx：0。
- `#/review/1` 仍显示“先选一位提交者”中文空态，并保留展示路线回链。

截图与结果：

- `tasks-desktop.png`
- `tasks-mobile.png`
- `tasks-narrow.png`
- `results.json`

## 覆盖边界

本轮验证的是展示页对离线种子运行摘要的表达和响应式布局，不代表真实模型质量、真实评委试讲、屏幕阅读器或生产部署已经完成验证。2026-10-26 短期反馈中的启动器、提交区、复核状态、凭证提示、ZIP 时间戳、年份和无密钥引导沿用此前专项记录与回归结论。
