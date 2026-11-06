<div align="center">

# FormFlow · 收齐啦

### 把通知、名单和材料变成一条可追溯的收集流程

FormFlow 面向报名、征集、评审和归档。组织者把手里的资料交给需求 Agent，得到一份可以编辑和确认的收集蓝图；提交者按蓝图填写并上传；审核 Agent 再把跨文件核验结果连同证据位置交回组织者。

[三分钟体验](#三分钟体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 从一份通知开始

现实中的收件任务通常同时包含一份通知、一张名单、几个模板和一些临时补充说明。FormFlow 把这些资料放在同一个任务里，由需求 Agent 整理出适用人员、字段、材料槽位、格式数量、时间策略和后续核验规则。每条要求都带着来源，遇到冲突或不完整的地方会先留下澄清问题，组织者确认后才会发布。

提交者进入任务后，可以先保存草稿，再正式提交。上传文件只表示材料已经收到；正式提交才会生成可审核版本。提交回执会告诉提交者材料是否齐全、检查是否完成，以及下一步是自己补正还是等待组织者确认。

## 把材料变成可核对的结果

审核 Agent 以已经发布的规则为准，同时查看表单字段和提交的多份材料。它可以检查姓名、学号等身份信息是否一致，文件类型和数量是否符合要求，内容是否覆盖规则，以及不同文件之间有没有矛盾。每条规则都会返回结论、解释、文件和位置，并明确区分：

- `satisfied`：现有证据支持这条规则；
- `issue`：发现需要处理的问题；
- `unknown`：证据不足，需要人工判断；
- `failed`：检查过程没有完成。

组织者可以打开原件核对证据，再决定验收、要求补正或保留人工结论。提交者只会看到确实属于自己的补正事项，不会把等待人工确认误解成自己的任务。

## AI 能做什么，系统负责什么

FormFlow 把模型放在可检查的边界内。Skill 规定 Agent 如何读取资料、编译规则和组织证据；Harness 限制任务范围、工具白名单、预算、超时、重试和人工接管；MCP 只提供任务状态、收集进度和运行时合同等只读信息。扩展名、大小、数量、页数、字段格式和导出条件由确定性程序检查，模型负责理解、比对和解释。

材料审核优先使用部署者配置的 provider 的 PDF 或图片输入。provider 不支持、文件超限或调用失败时，才会进入文字解析或 OCR 降级；`direct` 模式会明确报告失败，不会悄悄改用另一条路径。文件和页码是模型给出的定位线索，最终判断仍由组织者打开原文完成。

## 三分钟体验

演示数据、人物、文件和审核轨迹都是虚构的，不需要模型密钥：

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

先从“需求设计”看资料怎样变成蓝图，再进入“收集工作台 → 证据复核 → 交付与归档”。提交者入口可以完整体验“填写 → 上传 → 正式提交 → 查看回执”。移动端和失败状态也有对应的复现脚本，入口集中在[体验指南](docs/demo-guide.md)和[验证档案索引](docs/ux-review-index.md)。

## 自己选择模型

模型配置由部署者保存在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把 API Key 写入数据库、浏览器响应、日志、审计事件或 MCP 配置。材料是否发送给外部 provider，以及 provider 如何留存和处理材料，由部署者自行决定；配置步骤和上线检查见[部署与模型接入](docs/deployment.md)。

## 继续了解

[文档入口](docs/README.md)按体验、部署和验证三条路线组织内容；[验证档案](docs/ux-review-index.md)提供截图、脚本、运行条件和边界。档案用于说明可复现的产品行为，不替代真实 provider 的模型评估、敏感材料评估或公网部署验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
