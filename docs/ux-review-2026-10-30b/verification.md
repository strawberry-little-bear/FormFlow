# 2026-10-30 设计台留白收口

## 发现与处理

桌面端需求设计页为助手面板和聊天区设置了较大的固定最小高度。只有一条欢迎消息时，聊天记录与输入区之间留下大片空白，运行时边界说明也被推到面板底部。

将桌面聊天区调整为 360px 高、320px 最小高度和 460px 最大高度；长对话仍由聊天记录区内部滚动。助手面板改为随内容自然撑开。980px 以下既有单列布局不变，并更新静态资源版本。

## 验收

- Isolated SQLite demo database, empty model key, API port 8024; `data/demo` was not reset and the temporary API was stopped after verification.
- Showcase Harness passed 7 organizer routes at each of 1440x950, 1366x768, 390px and 320px; the sticky assistant panel stays visible on desktop and short laptop viewports, with no narrow-screen horizontal overflow.
- All 4 viewports had no stuck loading states, console errors or unexpected HTTP failures. The 1440px screenshot confirms the large gap between composer and runtime note is gone.
- `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`: 221 passed. Python full suite was not rerun for this CSS-only change.
