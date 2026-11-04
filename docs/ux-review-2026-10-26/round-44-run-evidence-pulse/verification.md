# Round 44 · 运行证据脉冲

日期：2026-10-26

## 目标

把展示页的真实复核运行摘要从折叠区前移到 Agent 运行链下方，降低第一次讲解时需要额外点击或滚动的成本。展示层只读取服务端脱敏聚合，不把原文、参数、材料正文或 MCP 会话 token 暴露到状态带。

## 处理

- `app/static/app.js` 在 `agentShowcaseHtml()` 中新增 `RUN EVIDENCE PULSE`。
- 有 `review_signal` 时显示当前运行编号、运行状态、主体、来源、工具记录步数、程序/语义/待人工聚合和真实 `review_href`。
- 没有运行摘要时显示“尚未形成运行”和“等待服务端提供最近运行摘要”，不根据模型配置猜测运行结果。
- 没有主体级授权链接时不生成复核入口，只说明入口将在有授权提交后出现。
- `app/static/style.css` 为桌面、390px 和 320px 提供稳定的网格降级：桌面五列、390px 两列、320px 单列。

## 验证

- `node --check app/static/app.js`：通过。
- `node --test tests/frontend_contracts.test.cjs`：169 项通过。
- `git diff --check`：通过。
- 隔离服务：`127.0.0.1:8017`，空 `FORMFLOW_LLM_API_KEY`，`data/demo` 虚构种子。
- `scripts/ux_walkthrough_2026-10-25.cjs` 真实浏览器走查：1440 / 390 / 320px 任务展示页、设计、名册、工作台、复核、交付和登录路径均无横向溢出；控制台错误、页面异常和失败请求均为 0；缺失提交者编号空态仍正确显示。
- 实拍：`tasks-desktop.png`、`tasks-390.png`、`tasks-320.png`。

## 仍未覆盖

真实模型质量、真实评委试讲、真实屏幕阅读器、生产部署和授权脱敏材料评估仍未覆盖。运行证据脉冲是服务端聚合投影，不代表模型结论已经通过人工验收。
