# 验证档案：条件材料动态状态播报


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

## 发现

条件材料的适用状态会随提交者填写字段而变化，并同步启用或禁用上传控件。原状态文字只在重新聚焦文件控件时通过 `aria-describedby` 可读；正在填写字段的屏幕阅读器用户不会立即获知上传要求已经改变。

## 结果与验证

- 将条件状态说明设为 `role="status"`、`aria-live="polite"`、`aria-atomic="true"`，在需要提交、不适用或转人工判断的状态变化时播报。
- 状态文本不变时不重写 live region，避免用户输入过程中重复播报相同内容。
- 前端契约检查条件材料控件的 live region 标记，并覆盖状态变化、重复状态抑制及上传控件启用/禁用。
- `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`：248 项通过。
- `node --check app/static/app.js`、`git diff --check`：通过。
- `python -m pytest -q`：452 项通过。
- 隔离虚构种子库的 Showcase 浏览器走查：1440/1366/390/320px 共 32 个页面场景通过；无横向溢出、卡住的加载态、未命名控件、控制台错误或失败请求。截图与机器报告位于系统临时目录 `formflow-followup-showcase-20261104`。
- Axe Core 对登录组织者、任务、设计、名册、工作台、复核、交付及提交者入口 8 个视图扫描：明确违规 0；仅单字装饰标记留有自动工具无法判断的 `incomplete` 对比度项。提交者认证后的表单未纳入本次 Axe 范围。
- GitHub Actions run `41782800563`：Ubuntu 24.04 与 Windows 两个 job 均通过。

## 限制

读屏播报细节仍需 NVDA/Firefox 或 NVDA/Chrome 实机确认；Axe 自动扫描不能代替人工键盘与屏幕阅读器验收。
