<div align="center">

# FormFlow · 收齐啦

### 把一堆通知和材料，变成一条看得懂、查得清的收集流程

FormFlow 是面向报名、征集、材料验收和归档的 AI 工作台。组织者把通知、名单、模板和附件放在一起，系统整理出可确认的收集规则；提交者按清单填写和上传；审核 Agent 将每一条判断连回具体文件和位置。

[开始体验](#开始体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 它解决什么问题

报名和材料收集通常同时依赖通知、名单、表格、附件和聊天记录。FormFlow 把这些信息放进同一条可追溯的流程：要求有来源，提交有版本，结论有证据，无法判断的地方明确交给人工。

组织者可以看到：

- 来源资料和可编辑的收集蓝图；
- 适用人员、身份字段、材料槽位、格式和时间要求；
- 应交、免交、已提交、待验收和补正状态；
- 每条规则的结论、文件位置、页码证据和人工接管点；
- 验收快照、CSV、ZIP 以及排除原因。

提交者可以看到：

- 自己需要填写和上传的内容；
- 服务器草稿、正式提交回执和截止时间；
- 哪些事项需要自己补正，哪些事项正在等待组织者确认。

## 两个 Agent

**需求 Agent** 阅读通知、名单、模板和补充说明，把它们整理成一份可编辑蓝图。蓝图包含字段、材料、格式、数量、命名、页数、时间策略和跨材料核验规则；资料冲突或要求不清楚时，会保留来源并提出澄清问题。只有组织者确认后，蓝图才会成为正式任务规则。

**审核 Agent** 按已发布规则检查一次提交中的表单和多份文件。它可以比对姓名、学号等身份信息，检查文件属性和内容覆盖，并把结论定位到文件和页码。结果分为 `satisfied`、`issue`、`unknown` 和 `failed`，证据不足或模型不可用时不会被包装成“不合格”。

## AI 如何保持可追溯

- **Skill** 固化资料提取、规则编译、证据引用和结构化输出的方法。
- **Harness** 限制任务范围、工具白名单、预算、超时、重试和人工接管。
- **MCP** 提供受限的只读任务状态和运行摘要，不读取逐人材料正文，也不提供写入工具。
- **程序检查** 负责文件类型、数量、大小、时间、版本和导出条件；模型负责理解、比对和解释。

支持文件或图片输入的 provider 会优先读取原始材料。只有 provider 不支持、文件超限或调用失败时，系统才进入文字解析或 OCR 降级路径。模型返回的文件和页码是定位线索，组织者仍可打开原文完成最终判断。

## 开始体验

演示数据、人物和审核轨迹均为虚构，不需要模型密钥：

```bash
git clone https://github.com/strawberry-little-bear/FormFlow.git
cd FormFlow
python scripts/start_demo.py --reset
```

打开终端显示的地址，使用演示账号：

```text
账号：demo
密码：demo1234
```

推荐先从组织者入口查看需求设计、收集工作台、证据复核和交付归档，再从提交者入口完成填写、上传、正式提交和更正。完整路线见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

本地部署时，把 provider、模型名和 API Key 写在部署者自己的 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把 API Key 写入数据库、浏览器响应、日志、审计事件或 MCP 配置；材料是否发送到外部 provider，以及 provider 如何留存和处理材料，由部署者自行决定。具体配置见[部署与模型接入](docs/deployment.md)。

## 证据与文档

截图、复现脚本和验证条件见[验证档案索引](docs/ux-review-index.md)。验证档案描述指定版本、虚构数据和本地环境下的可见行为，不替代真实 provider 的模型评估、敏感材料评估或公网部署验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
