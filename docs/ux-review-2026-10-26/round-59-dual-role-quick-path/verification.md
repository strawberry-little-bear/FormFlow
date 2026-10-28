# Round 59 · 首屏双角色快速路径

日期：2026-10-26

本轮目标：让第一次打开任务首页的评委在读完 `FIRST LOOK` 后，立即知道组织者和提交者分别从哪里开始，以及两条路径会走到什么结果。

## 实现

- 在展示路线标题后、`FIRST LOOK` 之前增加紧凑的“双角色快速路径”摘要，让移动端首屏先看到两个入口。
- 组织者入口指向当前任务工作台，路径显示“设计 → 发凭证 → 复核 → 交付”。
- 提交者入口指向 `#/login?role=sub`，路径显示“登录 → 填写 → 正式提交 → 核对”。
- 使用现有 SVG 图标和真实路由；底部完整“双角色体验”卡保留，用于展开说明和再次进入入口。
- 桌面双列，600px 以下自动单列；静态资源版本更新为 `20261026-6`。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：183 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check -- app/static/app.js app/static/style.css app/static/index.html tests/frontend_contracts.test.cjs docs/product-roadmap.md docs/ux-review-2026-10-26/round-59-dual-role-quick-path/verification.md`：通过。
- 本地空 `FORMFLOW_LLM_API_KEY`、虚构演示种子下，Playwright 走查 1440 / 390 / 320px：
  - 展示路线标题后立即可见双角色摘要，两个入口均可点击。
  - 1440px 为双列；390px 与 320px 为单列，路径文字和入口不溢出。
  - 三档 `scrollWidth === clientWidth`，无整页横向溢出。
  - 无控制台错误、页面异常或失败 API 请求。
  - 页面引用 `/static/style.css?v=20261026-6` 与 `/static/app.js?v=20261026-6`。
- 截图：`.tmp-ux-round-59/tasks-final-1440.png`、`.tmp-ux-round-59/tasks-final-390.png`、`.tmp-ux-round-59/tasks-final-320.png`。

## 边界

本轮验证的是离线展示数据下的首屏信息层级、真实入口和响应式布局，不代表真实模型质量、真实 MCP sidecar、屏幕阅读器或生产部署结果。
