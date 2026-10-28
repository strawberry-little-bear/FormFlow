# Round 33 · MCP 回放快捷入口与窄屏状态轨

日期：2026-10-26

本轮承接短期评审意见，在展示首页继续收口第一次打开时的讲解路径。评审记录中的已知问题保持已修复状态，本轮只增加一个可直接到达 MCP 证据的入口，并压缩窄屏首屏的状态轨高度。

## 处理

- `app/static/app.js` 新增 `jumpToMcpSnapshot()`：展开包含 MCP 面板的 Agent walkthrough，更新 `aria-expanded`，滚动到 `.mcp-snapshot` 并移动键盘焦点；用户开启减少动效时改用即时滚动。
- `agentShowcaseHtml()` 只在“MCP 只读回放”卡内增加“查看回放”按钮，其他状态卡结构保持不变。
- `app/static/style.css` 增加快捷按钮的紧凑样式；600px 以下状态卡使用双列，360px 以下恢复单列，避免 320px 文本挤压。
- `tests/frontend_contracts.test.cjs` 增加快捷入口的 DOM、焦点、原生 details 展开和减少动效契约，并锁定 390/320px 布局断点。

## 验证

- `node --check app/static/app.js`：通过
- `node --test tests/frontend_contracts.test.cjs`：167 passed
- `git diff --check -- app/static/app.js app/static/style.css tests/frontend_contracts.test.cjs`：通过
- 隔离演示服务 `http://127.0.0.1:8011` 浏览器走查：
  - 1440px：状态轨四列，`scrollWidth=1440`、`clientWidth=1440`
  - 390px：状态轨双列（计算列宽约 `154.5px 154.5px`），`scrollWidth=390`、`clientWidth=390`
  - 320px：状态轨单列（计算列宽 `252px`），`scrollWidth=320`、`clientWidth=320`
  - 三档均显示“查看回放”；点击后 `details.open=true`，焦点位于 `.mcp-snapshot`
  - 控制台错误 0，页面异常 0，失败请求 0

## 未覆盖

- 本轮仍使用空模型密钥和虚构演示数据，未覆盖真实模型质量、授权脱敏数据集评估、真实目标用户试讲和生产部署边界。
- 自动化焦点检查不替代真实屏幕阅读器与辅助技术用户走查。
