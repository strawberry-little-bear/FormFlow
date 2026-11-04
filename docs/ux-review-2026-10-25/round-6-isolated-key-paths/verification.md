# 2026-10-25 隔离种子关键路径复验

## 环境与范围

- 使用 `scripts/seed_demo.py` 在系统临时目录创建独立 SQLite 数据库和附件目录；演示库 `data/demo/` 未读取或修改。
- 临时 API 与 Worker 运行于本机随机可用端口，`FORMFLOW_LLM_API_KEY` 为空。
- 使用 Chromium 实际打开新建任务弹窗、需求设计的无密钥请求降级和收集工作台催交页。
- `scripts/ux_key_paths.cjs` 现在支持 `FORMFLOW_WALKTHROUGH_BASE` 与 `FORMFLOW_WALKTHROUGH_OUT`，可指定隔离实例和证据目录；未设置时沿用原默认值。

## 结果

- 新建任务弹窗正常打开。
- 需求请求明确说明未接入模型、原文仍保留，可先用模板或手动编辑，并说明配置密钥后可继续；页面没有“用原请求重试”按钮。
- 催交工作台正常打开。浏览器控制台错误、页面异常、HTTP 4xx/5xx 均为 0。
- `design-no-llm.png` 是本轮无密钥降级实拍截图。

本轮没有触碰演示数据库。该结果验证的是确定性降级与页面交互，不代表实时模型质量。
