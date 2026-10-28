# 2026-10-26 Agent 导览回放收口

## 本轮目标

让任务首页的 Agent 展示从静态说明变成可现场回放的受限运行：评委能看到调用顺序、当前阶段、预算摘要和人工接手边界，同时不接触 MCP 会话 token、工具参数、材料正文或隐藏推理。

## 实现范围

- `/api/tasks/{task_id}/mcp-snapshot` 与 `/mcp-demo` 的 `execution` 增加四步 `replay` 和 `replay_budget`，来源仍是服务端 runtime 合同与受限聚合投影。
- 前端“运行 Agent 导览”按 4 个只读调用逐步显现：`0/4` 等待首步、逐项显示 `1/4` 至 `4/4`，随后恢复完整调用账本。
- 回放中保留“下一步”说明；回放完成后明确写出最终验收、补正处理和发布仍由组织者确认。
- 预算摘要展示工具调用、语义模型调用和材料页数上限，未增加新的 Agent 框架或写入路径。

## 回归证据

```text
python -m pytest -q tests/test_agent_runtime.py tests/test_mcp_server.py tests/test_demo_mcp_script.py
19 passed

node --test tests/frontend_contracts.test.cjs
162 passed

node --check app/static/app.js
通过

git diff --check -- app/api/routes.py app/static/app.js app/static/style.css tests/test_agent_runtime.py tests/frontend_contracts.test.cjs
通过
```

真实浏览器：

- 桌面 1440px：演示入口进入任务首页后，点击“运行 Agent 导览”，回放显示 `回放中 · 0/4`、`1/4`，随后完成并恢复四张调用卡片；截图保存在 `.tmp-ux-mcp-replay-20261026/mcp-replay-complete.png`。
- 移动端 390px：回放中显示“下一步：读取收集汇总”，`scrollWidth=390`、`clientWidth=390`。
- 本轮浏览器采样：控制台错误 0，4xx/5xx 请求 0。

## 边界

本轮只增强展示回放和脱敏合同，不代表外部 MCP sidecar 自动接入网页 Agent，也不代表 Agent 可以发布蓝图、认定资格、处理补正或完成最终验收。
