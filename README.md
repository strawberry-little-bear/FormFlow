<div align="center">

# FormFlow · 收齐啦

### 从一份通知，到一份有证据的交付

FormFlow 是一个面向报名、征集和评审场景的材料收集与核验工具。它把组织者手里的通知、名单和模板整理成收集任务，再把提交者填写的字段和上传的材料逐项对照，最后输出带证据位置的审核结果。

[立即体验](#立即体验) · [产品文档](docs/README.md) · [部署与模型接入](docs/deployment.md) · [验证档案](docs/ux-review-index.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 它解决什么问题

真实的材料收集通常从一条通知开始：名单在一个文件里，字段要求在另一个文件里，模板和补充说明又散落在聊天记录中。提交后，姓名、学号、格式和正文还要在多份材料之间反复核对。

FormFlow 将这段工作串成一条清晰的流程：

1. 组织者提供通知、名单、模板和补充要求。
2. 需求 Agent 整理出字段、材料、时间和审核规则，标注来源并提示冲突。
3. 组织者确认蓝图后发布收集任务。
4. 提交者填写信息、上传材料、保存草稿并正式提交。
5. 审核 Agent 按规则逐条检查跨文件一致性，给出结论、证据和下一步。
6. 组织者完成必要的人工确认，生成 CSV 和 ZIP 快照归档。

## 两个 Agent

**需求 Agent** 把非结构化资料变成可编辑的收集蓝图。它识别适用人员、字段、材料槽位、格式数量、截止时间和后续核验规则；遇到资料冲突或描述不清时，保留来源并提出澄清问题。蓝图由组织者确认后才会生效。

**审核 Agent** 以已发布的蓝图为准，联合查看表单、名单和多份材料。它可以核对姓名和学号是否一致、文件是否符合格式与数量要求、内容是否覆盖规则，以及不同文件之间是否相互矛盾。每条规则返回 `satisfied`、`issue`、`unknown` 或 `failed`，并附文件、页码、区域和引用片段。

## AI 与确定性检查如何配合

文件审核优先使用部署者配置的模型的 PDF 或图片输入能力。模型或接口不支持、文件超限或调用失败时，才会进入文字解析或 OCR 降级；系统会保留读取覆盖状态，不把未读内容伪装成通过。

文件扩展名、大小、数量、页数、字段格式、截止时间和导出条件由程序检查。模型负责理解、比对和解释。模型提供的页码和区域是定位线索，组织者可以打开原件完成最终确认。

Skill 规定 Agent 的工作步骤，Harness 约束工具、范围、预算和人工接管，MCP 提供任务状态等只读信息。API Key 只保存在部署者自己的环境变量、`.env` 或部署平台 Secret 中，不会写入数据库、浏览器响应、日志或 MCP。

## 立即体验

演示数据、文件和人物均为虚构，留空模型密钥也能体验完整的收集、提交、失败恢复和归档流程：

```bash
git clone https://github.com/strawberry-little-bear/FormFlow.git
cd FormFlow
python scripts/start_demo.py --reset
```

打开启动器显示的地址，使用演示账号：

```text
账号：demo
密码：demo1234
```

推荐路径是“需求设计 → 收集工作台 → 提交者端 → 证据复核 → 交付与归档”。更多截图、浏览器脚本和移动端入口见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

部署者可以在本机配置 OpenAI 兼容或其他受支持的 provider。配置方法、文件直读能力、降级规则和上线检查见[部署与模型接入](docs/deployment.md)。FormFlow 不代为托管密钥，材料是否发送给外部 provider 由部署者自行决定。

## 继续阅读

- [产品文档](docs/README.md)：按体验、部署和验证场景导航。
- [体验指南](docs/demo-guide.md)：三分钟走完组织者和提交者两条路径。
- [Agent 评估集](docs/review-agent-evaluation.md)：了解审核结论和证据覆盖如何评估。
- [验证档案索引](docs/ux-review-index.md)：查看可复现的页面结果、脚本和边界。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
