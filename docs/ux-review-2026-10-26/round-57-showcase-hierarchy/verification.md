# Round 57 · 首屏快速读条

日期：2026-10-26

本轮目标：把第一次打开任务首页时最需要知道的三件事集中到首屏：当前正在看什么、Agent runtime 是否可用、MCP 回放是否完成，以及下一步应该进入哪里。完整的 Agent 控制面板和运行证据仍保留在下方，供评委继续深入。

## 实现

- 在任务首页 `DEMO ROUTE` 标题下增加 `FIRST LOOK` 快速读条。
- 快速读条复用现有 `agentShowcaseState()`，展示当前焦点、Agent runtime、MCP 回放和下一步动作；模型配置或 MCP 快照异步返回后会同步刷新。
- 桌面端使用一行紧凑布局；390px 下使用两列；320px 下自动切换为单列，保持文本和入口可读。
- 静态资源版本从 `20261026-3` 更新为 `20261026-4`，避免浏览器继续使用旧缓存。
- 增加 `agentQuickReadHtml()` 的前端契约测试，并保留 `quick-runtime` / `quick-mcp` 动态类名，确保异步 repaint 能定位状态节点。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：182 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check -- app/static/app.js app/static/style.css app/static/index.html tests/frontend_contracts.test.cjs`：通过。
- 本地 `127.0.0.1:8000`、空 `FORMFLOW_LLM_API_KEY`、虚构演示种子下，Playwright 走查 1440 / 390 / 320px：
  - 三档均显示 `FIRST LOOK`，当前焦点为“检查并接手”。
  - Agent runtime 显示“离线可演示”，MCP 回放显示“已完成”，下一步入口为“进入检查并接手”。
  - 1440px 保持单行读条；390px 为两列布局；320px 为单列布局。
  - 三档 `scrollWidth === clientWidth`，无横向溢出。
  - 三档无控制台错误、无页面异常、无 4xx/5xx 请求。
- 截图：`.tmp-ux-next-round-showcase/tasks-1440.png`、`.tmp-ux-next-round-showcase/tasks-390.png`、`.tmp-ux-next-round-showcase/tasks-320.png`。

## 边界

本轮验证的是离线演示数据下的首屏信息层级、Agent/MCP 状态表达和响应式布局，不代表真实模型质量、真实 MCP sidecar、屏幕阅读器体验或生产部署结果。
