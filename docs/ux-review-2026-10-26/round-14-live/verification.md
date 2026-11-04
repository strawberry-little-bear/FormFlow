# Round 14 · MCP 现场证据验证

日期：2026-10-26（Asia/Shanghai）

本轮目标是把 MCP 从静态架构说明变成可现场读取的、脱敏的只读证据。`feedback.md` 仍是历史评审记录，本文件只记录本轮实现后的验证结果。

## 自动化验证

- `python -m pytest -q tests/test_agent_runtime.py`：4 项通过。
- `node --test tests/frontend_contracts.test.cjs`：159 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check`：通过。

## 浏览器验证

环境：隔离演示服务 `http://127.0.0.1:11860/`，虚构种子数据，`FORMFLOW_LLM_API_KEY` 留空，组织者演示入口。

- 1440px：Agent 工作导览展示 MCP 现场快照，四个工具均为 `ok`，包含任务、收集汇总、下一步和 runtime contract；页面正文不包含组织者 session token。
- 390px：展开 Agent 工作导览后，四个工具摘要与脱敏边界正常显示；`scrollWidth === clientWidth === 390`。
- 320px：四个工具摘要与脱敏边界仍可读取；`scrollWidth === clientWidth === 320`。
- 页面刷新后 `/api/tasks/1/mcp-snapshot` 返回 200；本轮实际加载的任务、runtime、demo-route 和 config 请求均返回 200。
- 控制台无错误，网络无 4xx/5xx 请求。
- 快照明确标注 `source: server_projection` 的展示语义，并保留“不返回逐人名单、材料正文、审核证据或会话 token”的边界说明。

## 备注

第一次复核命中了旧的隔离服务进程，因此快照请求暂时返回 404；重启隔离服务加载当前代码后复核通过。演示服务已在本轮结束时停止。

尚未覆盖真实屏幕阅读器和真实用户试点；本轮覆盖的是自动化契约、可访问性树、三档视口和浏览器网络/控制台回归。
