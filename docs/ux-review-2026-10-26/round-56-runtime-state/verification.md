# Round 56 · 运行状态与 MCP 证据展示

日期：2026-10-26

本轮目标：让第一次打开任务首页的评委能看懂 Agent 当前处于排队、运行、重试、失败或已完成中的哪一阶段，并把 MCP 只读导览的等待、刷新和失败状态说清楚。

## 实现

- `RUN STAGES` 按真实运行状态显示“排队中”“等待运行结果”“等待重试”“未完成 / 先处理运行失败”或对应证据入口。
- 非成功运行不再伪装成“查看对应证据”，复核入口改为“查看运行状态”；成功运行仍可直接打开复核。
- MCP 快照增加“尚未读取”“正在读取”“正在刷新”“读取失败”状态；失败时说明不会阻塞任务路线，并提供重新读取入口。
- 静态资源版本更新为 `20261026-3`，避免展示浏览器继续使用旧缓存。
- 增加前端契约测试覆盖 queued / failed RUN STAGES 与 MCP pending / refresh / error 状态。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：181 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check -- app/static/app.js app/static/style.css app/static/index.html tests/frontend_contracts.test.cjs`：通过。
- 本地 `127.0.0.1:8000`、空 `FORMFLOW_LLM_API_KEY`、虚构演示种子下，Playwright 走查 1440 / 390 / 320px：
  - 展开 Agent 导览后，三档均显示 `LIVE MCP EVIDENCE`。
  - 三档均包含 `get_task_collection_progress`、`get_task_next_step`、`get_task_agent_runtime` 的已返回结果。
  - 点击“刷新快照”时显示“正在刷新只读快照”，随后恢复为已完成快照。
  - 三档 `scrollWidth === clientWidth`，无横向溢出。
  - 无控制台错误、无页面异常、无 4xx/5xx 请求。
  - 四个 RUN STAGES 均正常渲染，成功种子显示：读取材料 1 页已读、程序核验 3 项已记、语义审核 2 项已记、人工接手 3 项待处理。

## 边界

本轮验证的是离线演示数据下的状态表达、MCP 证据展示和响应式布局，不代表真实模型质量、真实 MCP 服务故障注入、屏幕阅读器体验或生产部署结果。
