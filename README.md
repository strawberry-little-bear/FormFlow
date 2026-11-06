<div align="center">

# FormFlow · 收齐啦

### 从一份通知，到一份有证据的材料交付

FormFlow 是面向报名、征集和评审场景的材料工作台。组织者提供通知、名单和模板，系统将它们整理成可确认的收集蓝图；提交者在线填写并提交材料；审核 Agent 按发布后的规则逐项核验多份文件，并把结论、证据位置和下一步动作放在同一条流程里。

作品打开后可以直接从任务和进度开始，沿着组织者、提交者两条路径走到证据复核和交付归档。Agent、Skill、Harness 与 MCP 的职责也在流程中可见。

[开始体验](#开始体验) · [产品文档](docs/README.md) · [部署与模型接入](docs/deployment.md) · [产品证据](docs/ux-review-index.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 为什么需要它

一条通知往往同时包含人员范围、字段要求、附件格式、截止时间和审核标准。实际执行时，这些信息分散在通知、名单、模板和聊天记录里；提交后，又要在表单和多份附件之间反复找姓名、学号、格式和正文内容。

FormFlow 把这两段工作连接起来，让每一条要求都能回到来源，每一条结论都有证据和责任归属：

1. 组织者导入通知、名单、模板和其他参考资料。
2. 需求 Agent 提取字段、材料槽位、时间策略和审核规则，并保留来源与冲突。
3. 组织者编辑并确认蓝图，确认后才发布任务。
4. 提交者填写信息、上传材料、保存草稿并正式提交。
5. 审核 Agent 按已发布规则逐项检查，展示结论、证据和责任归属。
6. 组织者处理人工确认，生成可交付的 CSV 与 ZIP 快照。

## 两个 Agent

### 需求 Agent

它把通知、名单、模板和补充说明整理成一份可编辑的收集蓝图。字段、材料槽位、格式、数量、截止时间和跨文件检查规则都保留来源定位；资料冲突或描述不清时，先显示澄清问题，组织者确认后才会进入正式任务。

组织者可以在发布前编辑字段、材料槽位和规则。蓝图需要明确确认后才会成为任务约束。

### 审核 Agent

它同时查看表单字段、名单和多份提交材料，逐条输出以下四种状态之一：

- `satisfied`：已有证据支持要求；
- `issue`：发现需要处理的问题；
- `unknown`：证据不足，需要人工判断；
- `failed`：检查过程没有完成。

每条结果都带有文件、页码或位置等证据线索，并区分“提交者需要修改”和“组织者需要确认”。证据定位由程序检查格式和范围，原文仍由组织者最终核对。

## Agent 如何受控运行

文件审核优先使用部署者选择的 provider 的 PDF 或图片输入能力。provider 不支持、文件超限或请求失败时，才进入文字解析或 OCR 降级；未读页面会保留为覆盖缺口，不会被当成通过。

确定性检查负责文件扩展名、大小、数量、页数、字段格式、时间和导出条件；模型负责理解、比对和解释。Skill 固化 Agent 的步骤和输出格式，Harness 限制任务范围、工具、预算、超时、重试和人工接管，MCP 只提供受限的只读运行上下文。

FormFlow 不托管模型密钥。API Key 只由部署者保存在本机 `.env`、进程环境或部署平台 Secret 中，不写入数据库、浏览器响应、日志、审计事件或 MCP。启用真实 provider 后，材料是否发送到外部服务由部署者自行决定。

## 开始体验

演示数据、人物和材料均为虚构。留空模型密钥也能体验组织者和提交者的完整路径，包括草稿、正式提交、失败恢复、人工接管和交付归档。

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

进入后可沿“需求设计 → 收集工作台 → 提交者端 → 证据复核 → 交付与归档”体验完整闭环。详细操作见[体验指南](docs/demo-guide.md)。

## 文档与验证

- [产品文档](docs/README.md)：按体验、部署和验证场景查找资料。
- [体验指南](docs/demo-guide.md)：从组织者和提交者两条路径走完一次任务。
- [部署与模型接入](docs/deployment.md)：配置本地环境、provider 和生产边界。
- [审核 Agent 评估集](docs/review-agent-evaluation.md)：用获准脱敏数据评估结论和证据覆盖。
- [产品证据索引](docs/ux-review-index.md)：按场景查看页面结果、复现脚本和边界。

`docs/ux-review-*` 是按用户场景整理的产品证据档案，不是开发日志。档案使用虚构种子、离线轨迹或指定 provider 配置时，会明确标注覆盖范围；真实模型质量、敏感材料处理、屏幕阅读器、移动设备和公网安全需要在授权环境中单独验收。

演示验证不等于真实模型或生产环境验收。真实材料、provider 文件输入、敏感数据处理、屏幕阅读器、移动设备和公网安全，需要在获得授权的环境中单独验证。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
