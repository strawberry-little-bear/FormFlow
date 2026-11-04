# Round 27 · 展示状态带回归

日期：2026-10-26

## 目标

验证任务首页新增的「现场状态」带是否把展示路线、Agent runtime、MCP 只读回放和人工接管边界说清楚，并确认它在桌面与窄屏上不会破坏既有走查路径。

## 环境

- 地址：`http://127.0.0.1:8010/`
- 数据：已有 `data/demo` 虚构种子，未重置
- `FORMFLOW_LLM_API_KEY`：留空
- 浏览器：无头 Chromium，1440、390、320 三档宽度
- 脚本：`scripts/ux_walkthrough_2026-10-25.cjs`
- 原始结果：[`results.json`](./results.json)

## 现场确认

- 任务首页桌面端展示四格状态：当前焦点、Agent runtime、MCP 只读回放、人工接管。
- 任务首页 390px、320px 改为单列状态卡，文字和入口均保持在可视宽度内。
- 「展开 Agent 导览」在 320px 可用：点击后详情展开，页面滚动到导览区，导览区获得焦点；测得 `tourTop=191`。
- 展示路线、四个主页面和提交者入口均可加载；`#/review/1` 仍显示「先选一位提交者」空态。
- 本轮浏览器结果无 `console error`、无 `pageerror`、无 4xx/5xx 响应。
- 全部 20 个采样点的 `document.scrollWidth` 等于 viewport 宽度，没有横向溢出。

## 截图

- 桌面任务首页：[`tasks-desktop.png`](./tasks-desktop.png)
- 320px 任务首页：[`tasks-320.png`](./tasks-320.png)
- 桌面复核页：[`review-desktop.png`](./review-desktop.png)
- 390px 提交者入口：[`submitter-entry-390.png`](./submitter-entry-390.png)

## 自动化回归

- 前端契约测试：上一轮已通过 `163 passed`
- Agent / MCP Python 测试：上一轮已通过 `19 passed`
- `node --check app/static/app.js`：通过
- `git diff --check`：通过
- 本轮浏览器走查：通过，结果见 `results.json`

## 未覆盖范围

本轮仍未覆盖真实读屏器、真实模型密钥下的在线语义调用、多人并发以及公网部署后的代理/缓存行为。这些属于下一轮展示前的环境验证，不影响本地演示闭环。
