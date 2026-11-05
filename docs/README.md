# FormFlow 文档

这组文档帮助访客快速理解、运行和评估 FormFlow。第一次了解作品时看根目录 [README](../README.md)；想运行演示、接入自己的模型或核对验证证据时，从下面的入口进入。

## 先体验

- [体验指南](demo-guide.md)：用虚构演示数据走完组织者和提交者的完整路径。
- [交互设计说明](interaction-optimization.md)：了解工作台、提交页和证据复核页如何表达状态、证据与下一步动作。

## 接入与评估

- [部署与模型接入](deployment.md)：本地启动、生产部署、文件输入优先级、密钥位置和数据边界。
- [审核 Agent 评估集](review-agent-evaluation.md)：在获准的脱敏案例上比较结论、证据覆盖和人工修正。
- [产品状态与方向](product-roadmap.md)：查看产品边界、已有能力和后续建设方向。

## 产品证据

- [验证档案索引](ux-review-index.md)：按场景查找截图、脚本、自动化结果和限制条件。
- `ux-review-*` 目录：保存指定版本、演示数据、浏览器视口和运行配置下的历史验证档案。

需要快速复现主要展示路径时，可运行 `scripts/showcase_check.cjs` 验证首屏与响应式布局，运行 `scripts/ux_review_check.cjs` 验证复核页失败态，运行 `scripts/ux_cross_material_walkthrough.cjs` 验证任务 2 的跨材料证据和提交者责任边界。

体验档案用于回答“在什么条件下看到了什么结果”。它们展示产品边界和可复现证据，不要求读者阅读开发过程，也不替代真实模型评估或生产验收。
