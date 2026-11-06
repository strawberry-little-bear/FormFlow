# FormFlow 产品场景

这里按用户目标整理 FormFlow 的可复现产品场景。每个场景都说明入口、配置、页面结果、复现方式和覆盖边界；日期与轮次只用于定位版本。

## 从一个场景开始

| 想了解什么 | 推荐场景 |
| --- | --- |
| 从通知、名单和模板生成收集蓝图 | [来源资料到需求 Agent](ux-review-2026-11-06-requirements-agent/verification.md) |
| 用表单和多份材料做一致性核验 | [收集、复核与交付](ux-review-2026-10-23/verification.md) |
| 模型如何接收 PDF、图片和密钥 | [模型直传与密钥边界](ux-review-2026-11-06-direct-model-transport/verification.md) |
| 第一次启动并完成最小闭环 | [空库首次启动](ux-review-2026-11-03-first-run/verification.md) |
| 端口、错误入口和失败状态如何恢复 | [恢复路径](ux-review-2026-10-26/feedback.md) |
| 组织者与提交者如何分别进入任务 | [双角色路径](ux-review-2026-10-25-role-lanes/review.md) |
| Agent、Skill、Harness 与 MCP 如何分工 | [Agent 架构](ux-review-2026-10-26/round-16-agent-architecture/verification.md)、[MCP 只读桥接](ux-review-2026-10-26/round-17-mcp-agent-bridge/verification.md) |
| 键盘路径与窄屏可操作性 | [键盘路径](ux-review-2026-11-04-keyboard/verification.md)、[提交者无障碍](ux-review-2026-11-04b/verification.md) |

## 每个场景包含什么

- **入口与条件**：使用的数据、设备、配置和登录方式。
- **用户结果**：页面展示的状态、证据和可执行动作。
- **复现方法**：脚本、截图、测试命令和运行条件。
- **覆盖边界**：没有覆盖的 provider、材料、设备或生产条件。

演示档案中的人物、材料和结论均为虚构。它们用于理解流程、权限、状态和导出行为，不能替代真实模型质量、敏感数据处理、屏幕阅读器或公网安全验收。
