# 设计台对话区：可复现体验


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

## 页面表现

桌面端需求设计页会根据对话内容撑开助手面板；短对话不会在输入区和运行时说明之间留下大片空白，长对话在聊天记录区内部滚动。窄屏继续使用单列布局。

## 复现结果

- Isolated SQLite demo database, empty model key, API port 8024; `data/demo` was not reset and the temporary API was stopped after verification.
- Showcase Harness passed 7 organizer routes at each of 1440x950, 1366x768, 390px and 320px; the sticky assistant panel stays visible on desktop and short laptop viewports, with no narrow-screen horizontal overflow.
- All 4 viewports had no stuck loading states, console errors or unexpected HTTP failures. The 1440px screenshot confirms the large gap between composer and runtime note is gone.
- `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`: 221 passed. Python full suite was not rerun for this CSS-only change.
