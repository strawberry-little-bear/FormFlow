# Round 58 · 首屏证据入口收尾

日期：2026-10-26

本轮目标：让第一次打开任务首页的评委能从 `FIRST LOOK` 快速读条直接进入 Agent runtime 的 Skill/Harness 边界和 MCP 只读账本，减少首屏理解后的二次寻找。

## 实现

- Agent runtime 卡新增“查看 Skill 与 Harness”入口，调用现有 `jumpToAgentTour()`，打开并聚焦 `.agent-tour`。
- MCP 回放卡新增“查看只读账本”入口，调用现有 `jumpToMcpSnapshot()`，打开并聚焦 `.mcp-snapshot`。
- 新增 `.demo-route-quick-link` 的轻量链接样式，保持首屏卡片的层级，不增加额外面板。
- 静态资源版本更新为 `20261026-5`，避免展示浏览器继续使用旧 CSS/JS 缓存。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：通过。
- `node --check app/static/app.js`：通过。
- `git diff --check -- app/static/app.js app/static/style.css app/static/index.html tests/frontend_contracts.test.cjs`：通过。
- 本地空 `FORMFLOW_LLM_API_KEY`、虚构演示种子下，Playwright 走查 1440 / 390 / 320px：
  - `FIRST LOOK`、Agent runtime 和 MCP 回放入口均可见。
  - 点击 Agent 入口后打开 Agent 导览并聚焦 `.agent-tour`。
  - 点击 MCP 入口后打开 MCP 面板并聚焦 `.mcp-snapshot`。
  - 三档 `scrollWidth === clientWidth`，无整页横向溢出。
  - 无控制台错误、页面异常或失败 API 请求。
- 截图：`.tmp-ux-next-round-showcase/tasks-links-1440.png`、`.tmp-ux-next-round-showcase/tasks-links-390.png`。

## 边界

本轮验证的是离线展示数据下的首屏信息层级、入口跳转和响应式布局，不代表真实模型质量、真实 MCP sidecar、屏幕阅读器或生产部署结果。
