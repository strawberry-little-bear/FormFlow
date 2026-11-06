<div align="center">

# FormFlow · 收齐啦

### 从要求到收齐，再到有证据地交付

FormFlow 是一个面向报名、征集和评审场景的材料工作台。它把通知、名单、模板和附件要求整理成可发布的收集任务，再把提交者的表单与多份材料变成逐条、可回看的审核结果。

[开始体验](#开始体验) · [产品文档](docs/README.md) · [部署与模型接入](docs/deployment.md) · [产品证据](docs/ux-review-index.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 一次任务会经历什么

FormFlow 适合这样的工作：一份通知里同时写着人员范围、表单字段、附件格式、截止时间和验收标准，提交之后还要确认不同文件里的姓名、学号和正文内容彼此一致。

从组织者的资料到最终交付，主流程只有几步：

1. **整理要求**：上传通知、名单、模板和补充材料。
2. **确认蓝图**：需求 Agent 提取字段、材料槽位、时间策略和审核规则，并标出来源与冲突。
3. **发布收集**：组织者确认蓝图后发布任务，提交者填写信息、上传文件、保存草稿并正式提交。
4. **逐条核验**：审核 Agent 对照已发布规则检查表单和多份材料，返回 `satisfied`、`issue`、`unknown` 或 `failed`。
5. **处理结果**：提交者看到自己能处理的事项，组织者看到需要人工确认的事项，并可导出 CSV 与 ZIP 交付快照。

## 两个 Agent，各自负责一段工作

需求 Agent 读取通知、名单、模板和补充说明，生成可编辑的收集蓝图。字段、材料槽位和审核规则都带有来源；资料冲突或要求不清时，先留下待确认的问题，组织者确认后才会发布。

审核 Agent 读取已发布规则、提交表单、组织者名单和多份上传材料，把每条规则拆成结论、解释、证据位置和下一步动作。证据不足时输出 `unknown`，检查中断时输出 `failed`，不会把“暂时无法判断”写成“不合格”。

## 能力边界清楚可见

确定性程序负责文件类型、大小、数量、页数、字段格式、截止时间和导出条件；模型负责理解、比较和解释。Skill 固定 Agent 的步骤与输出格式，Harness 限制任务范围、工具、预算、超时和人工接管，MCP 只提供受限的只读运行上下文。

文件审核默认优先使用部署者选择的模型的 PDF 或图片输入能力。模型或接口不支持原始文件、文件超限或调用失败时，`auto` 模式才会回退到服务器文字解析；扫描件和无文字图片只有在允许时才使用 OCR。任何未读页面都会保留为覆盖缺口，并转为 `unknown` 或人工复核。

FormFlow 不托管模型密钥。部署者把 API Key 放在本机 `.env`、进程环境或部署平台 Secret 中；应用不会把它写入数据库、浏览器响应、日志、审计事件或 MCP。启用真实模型后，材料是否发送给所选 provider 由部署者决定。

## 开始体验

演示人物、材料和结论均为虚构数据。即使不配置模型密钥，也可以体验需求草案、提交、失败恢复、人工接管和交付归档这些产品路径。

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

进入后依次查看“需求设计”“收集工作台”“提交者端”“证据复核”和“交付与归档”。完整操作顺序见[体验指南](docs/demo-guide.md)。

## 配置自己的模型

复制 `.env.example` 为 `.env`，填写兼容的 provider 地址、模型名称和 API Key：

```dotenv
FORMFLOW_LLM_BASE_URL=https://your-provider.example/v1
FORMFLOW_LLM_API_KEY=由部署者自行填写
FORMFLOW_LLM_MODEL=your-model
FORMFLOW_LLM_INPUT_MODE=auto
```

`auto` 会优先尝试文件或图片直传；`direct` 只允许直传；`text` 只使用已有文字层；`ocr` 只走服务器解析和 OCR。不同 provider 的文件格式、留存和计费政策可能不同，第一次接入请使用获准的脱敏材料验证。

## 文档入口

- [产品文档](docs/README.md)：按体验、架构、部署和验证场景查找资料。
- [体验指南](docs/demo-guide.md)：沿组织者和提交者两条路径走完一次任务。
- [部署与模型接入](docs/deployment.md)：配置本地环境、provider、密钥和生产边界。
- [审核 Agent 评估集](docs/review-agent-evaluation.md)：在获准脱敏数据上评估结论和证据覆盖。
- [产品证据索引](docs/ux-review-index.md)：查看具体场景的页面结果、复现入口和限制。

产品证据档案使用虚构种子、离线轨迹或指定 provider 配置时，会明确标注覆盖范围。它们可以说明流程、权限、状态和导出行为，不能替代真实模型质量、敏感材料处理、屏幕阅读器、移动设备或公网安全验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
