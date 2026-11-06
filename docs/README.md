# FormFlow 文档入口

这里按阅读目的组织公开文档。第一次了解作品先看体验指南；准备部署或接入模型时查看运行说明；需要确认某个产品行为时进入验证档案。验证档案保留复现证据，不把开发过程写成产品介绍。

## 先看作品

| 入口 | 用途 |
| --- | --- |
| [体验指南](demo-guide.md) | 从组织者和提交者两条路径体验一个虚构任务 |
| [交互设计说明](interaction-optimization.md) | 了解清单、状态、证据和责任边界 |
| [验证档案索引](ux-review-index.md) | 按用户场景查看截图、脚本、运行条件和限制 |

## 按角色阅读

| 读者 | 推荐入口 |
| --- | --- |
| 评审者 | [体验指南](demo-guide.md) → [完整收集、复核与交付](ux-review-2026-10-23/verification.md) |
| 部署者 | [部署与模型接入](deployment.md) → [审核 Agent 评估集](review-agent-evaluation.md) |
| 维护者 | [交互设计说明](interaction-optimization.md) → [产品状态与方向](product-roadmap.md) |

## 部署与评估

| 入口 | 用途 |
| --- | --- |
| [部署与模型接入](deployment.md) | 启动服务、配置 provider、设置 API Key 和输入模式 |
| [审核 Agent 评估集](review-agent-evaluation.md) | 在获准的脱敏材料上评估规则结论和证据覆盖 |
| [产品状态与方向](product-roadmap.md) | 当前可展示能力、边界和后续方向 |

## 代表性验证场景

- [完整收集、复核与交付](ux-review-2026-10-23/verification.md)：组织者和提交者各走一遍主路径。
- [来源资料到需求 Agent](ux-review-2026-11-06-requirements-agent/verification.md)：通知、名单和模板如何进入蓝图。
- [启动参数与失败状态](ux-review-2026-10-26b/feedback.md)：自定义端口、无效路由和责任分工如何恢复。
- [展示与提交者闭环](ux-review-2026-11-04/verification.md)：展示模式和提交者补正路径。

验证档案优先说明用户场景和可见结果，再给出复现入口与限制。日期、端口、提交号和测试数量只用于定位环境；“通过”只表示指定环境下的行为已经核对，不代表真实模型质量、屏幕阅读器体验或公网部署已经验收。其余历史档案仍可从[验证档案索引](ux-review-index.md)按场景进入。

完整产品说明以根目录 [README](../README.md) 为准。
