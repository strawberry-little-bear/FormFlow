# 走查证据索引

`docs/ux-review-*` 是 FormFlow 的验证存档。每份记录对应一个明确的场景、版本、种子数据和浏览器环境，用来回答“当时验证了什么、结果是什么、哪些边界还没有覆盖”。

这些记录面向复现和评审，不是开发日报，也不是产品承诺。产品能力以根目录 [README](../README.md)、当前代码和[部署文档](deployment.md)为准。

## 从这里开始

| 想了解的内容 | 推荐记录 |
| --- | --- |
| 第一次打开作品后的完整体验 | [2026-10-23 收集与审核闭环](ux-review-2026-10-23/verification.md) |
| 启动器、无效路由和失败状态 | [2026-10-26 启动与失败状态](ux-review-2026-10-26b/feedback.md) |
| 组织者与提交者主要路径 | [2026-10-26 启动、收件与复核体验](ux-review-2026-10-26/feedback.md) |
| 当前版本展示与提交者闭环 | [2026-11-04 展示与提交者闭环](ux-review-2026-11-04/verification.md) |
| 从空库创建任务 | `docs/ux-review-2026-11-03-first-run/verification.md` |
| 需求 Agent、审核 Agent、Skill、Harness 和 MCP | `docs/ux-review-2026-10-26/round-16-agent-architecture/verification.md`、`docs/ux-review-2026-10-26/round-17-mcp-agent-bridge/verification.md` |
| 键盘与访问性 | `docs/ux-review-2026-11-04-keyboard/verification.md`、`docs/ux-review-2026-11-04b/verification.md` |

## 证据怎么读

先看记录顶部的日期、环境和范围，再看结论与限制。截图、JSON 报告和脚本是证据附件；测试数量、提交号、端口和临时目录只用于复现，不代表产品能力等级。

记录中的“通过”只表示指定场景在当时的条件下完成了验证。真实 provider、真实材料、实体移动设备、屏幕阅读器和公网安全需要单独验收。

## 新记录格式

新增记录保持四个部分：

1. **验证对象**：场景、日期、版本和数据边界。
2. **结论**：用户能完成什么，哪些状态仍需人工处理。
3. **证据**：脚本、截图、自动化结果或复现入口。
4. **限制**：没有验证的环境、数据和能力。

不要把实现过程、个人汇报、未验证的推测或未来计划混进验证结论。
