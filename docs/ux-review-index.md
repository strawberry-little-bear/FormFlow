# 验证档案索引

这里收录 FormFlow 的可复现产品证据。每份档案都从用户场景开始，说明访客能看到什么、如何复现以及结论的适用边界。目录日期和历史轮次只用于定位原始证据，不代表产品使用顺序，也不是开发日报。

## 推荐入口

| 想了解什么 | 从这里开始 |
| --- | --- |
| 一次完整的收集、审核和交付 | [收集、复核与交付](ux-review-2026-10-23/verification.md) |
| 通知、名单和模板如何进入需求 Agent | [来源资料到需求 Agent](ux-review-2026-11-06-requirements-agent/verification.md) |
| 第一次启动和空库闭环 | [空库首次启动](ux-review-2026-11-03-first-run/verification.md) |
| 启动参数、错误恢复和失败状态 | [启动参数与失败状态](ux-review-2026-10-26b/feedback.md) |
| 展示模式与提交者闭环 | [展示与提交者闭环](ux-review-2026-11-04/verification.md) |
| Agent、Skill、Harness 与 MCP 的边界 | [Agent 架构](ux-review-2026-10-26/round-16-agent-architecture/verification.md)、[MCP 只读桥接](ux-review-2026-10-26/round-17-mcp-agent-bridge/verification.md) |
| 键盘路径与可访问性 | [键盘路径](ux-review-2026-11-04-keyboard/verification.md)、[提交者无障碍](ux-review-2026-11-04b/verification.md) |

## 如何阅读档案

1. **场景**：使用的数据、设备、配置和入口。
2. **观察**：访客完成了什么，页面显示了什么。
3. **结论**：这次验证支持哪些产品判断。
4. **复现与边界**：如何重跑，以及哪些 provider、材料、设备或生产条件没有覆盖。

日期、端口、提交号和测试数量只用于复现定位。档案中的“通过”只代表指定环境下的行为已经核对，不代表真实模型质量、屏幕阅读器体验或公网部署已经验收。历史记录保留事实，并统一按“场景—结果—复现—边界”阅读；其中没有覆盖的能力仍应按档案中的限制单独验收。
