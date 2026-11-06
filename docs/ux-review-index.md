# 产品证据索引

这里收录 FormFlow 按用户场景整理的验证档案。每份档案都说明入口、配置、页面结果、复现方式和边界；日期与轮次只是版本定位，不代表开发进度。第一次了解作品时，从下面最接近目标的场景进入即可。

## 从这里开始

| 想了解什么 | 推荐档案 |
| --- | --- |
| 一次完整的收集、审核和交付 | [收集、复核与交付](ux-review-2026-10-23/verification.md) |
| 通知、名单和模板怎样进入需求 Agent | [来源资料到需求 Agent](ux-review-2026-11-06-requirements-agent/verification.md) |
| 模型如何接收 PDF 和图片，以及密钥如何隔离 | [模型直传契约](ux-review-2026-11-06-direct-model-transport/verification.md) |
| 第一次启动和空库闭环 | [空库首次启动](ux-review-2026-11-03-first-run/verification.md) |
| 错误入口、端口冲突和失败状态如何恢复 | [错误入口恢复](ux-review-2026-10-26/feedback.md) |
| 展示模式与提交者闭环 | [展示与提交者闭环](ux-review-2026-11-04/verification.md) |
| Agent、Skill、Harness 与 MCP 如何分工 | [Agent 架构](ux-review-2026-10-26/round-16-agent-architecture/verification.md)、[MCP 只读桥接](ux-review-2026-10-26/round-17-mcp-agent-bridge/verification.md) |
| 键盘路径与可访问性 | [键盘路径](ux-review-2026-11-04-keyboard/verification.md)、[提交者无障碍](ux-review-2026-11-04b/verification.md) |

## 档案统一结构

- **场景**：数据、设备、配置和入口。
- **结果**：用户完成了什么，页面展示了什么。
- **复现**：脚本、截图、测试命令和运行条件。
- **边界**：没有覆盖的 provider、材料、设备或生产条件。

这些档案用于帮助读者理解和复核产品行为。虚构种子和离线轨迹可以验证流程、权限、状态和导出行为；真实材料、模型质量、敏感数据处理、屏幕阅读器和公网部署需要在获准环境中单独验收。
