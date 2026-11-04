# 2026-11-04 条件材料动态状态播报

## 发现

条件材料的适用状态会随提交者填写字段而变化，并同步启用或禁用上传控件。原状态文字只在重新聚焦文件控件时通过 `aria-describedby` 可读；正在填写字段的屏幕阅读器用户不会立即获知上传要求已经改变。

## 处理与验证

- 将条件状态说明设为 `role="status"`、`aria-live="polite"`、`aria-atomic="true"`，在需要提交、不适用或转人工判断的状态变化时播报。
- 状态文本不变时不重写 live region，避免用户输入过程中重复播报相同内容。
- 前端契约检查条件材料控件的 live region 标记，并覆盖状态变化、重复状态抑制及上传控件启用/禁用。
- `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`：248 项通过。
- `node --check app/static/app.js`、`git diff --check`：通过。
- `python -m pytest -q`：452 项通过。
- 推送后的 GitHub Actions：待完成。

## 限制

本轮运行环境未安装 Playwright；契约测试可运行，但没有真实浏览器或屏幕阅读器实测。读屏播报细节仍需 NVDA/Firefox 或 NVDA/Chrome 实机确认。
