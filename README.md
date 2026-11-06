<div align="center">

# FormFlow · 收齐啦

### 把通知、名单和附件变成一条可追溯的收集与审核流程

FormFlow 是一个面向报名、征集、材料验收和归档的 AI 工作台。组织者把资料交给需求 Agent，提交者按清单完成填报，审核 Agent 将每条判断连回具体文件和位置。

[开始体验](#开始体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 先看一条完整路径

FormFlow 把一次材料收集拆成四个连续动作：

1. **整理要求**：上传通知、名单、模板和补充说明。需求 Agent 生成可编辑蓝图，保留来源、冲突和待确认问题。
2. **发布清单**：组织者确认字段、材料槽位、格式、数量、时间和跨材料核验规则，再发布任务。
3. **提交与核验**：提交者填写身份信息、上传多份材料并正式提交。审核 Agent 逐条比较字段和文件内容，输出 `satisfied`、`issue`、`unknown` 或 `failed`。
4. **人工确认与交付**：组织者打开证据原文，处理需要人工判断的项目，固定验收快照并导出 CSV 与 ZIP。

这条路径同时服务两类人。组织者看到规则、进度、证据和下一步；提交者只看到自己的清单、回执和需要自己处理的补正事项。

## 两个 Agent，清楚的边界

**需求 Agent** 负责把资料变成规则。它识别适用人员、字段、材料、格式、命名、时间和跨文件检查项；发现资料冲突或要求不清时，保留来源并提出问题。蓝图必须经过组织者确认，才会成为正式规则。

**审核 Agent** 负责按正式规则检查一次提交。它可以比对姓名、学号等身份信息，检查文件属性和内容覆盖，并把结论定位到文件、页码或字段。证据是可追溯的定位线索，组织者仍可打开原文完成最终判断。

Agent 运行在固定的 Skill、Harness 和工具边界内：Skill 规定输入与输出方法，Harness 限制任务范围、工具白名单、预算、超时和人工接管，MCP 只提供受限的只读任务状态。文件类型、数量、大小、时间和导出条件由程序确定性检查；需要理解和比较的部分才交给模型。

支持文件或图片输入的 provider 会优先读取原始材料。provider 不支持、文件超限或调用失败时，系统才进入文字解析或 OCR 降级；模型密钥只由部署者保存在自己的本地配置中。

## 开始体验

演示数据、人物、文件和审核轨迹都是虚构的，不需要模型密钥：

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

建议先从组织者入口看“需求设计 → 收集工作台 → 证据复核 → 交付与归档”，再从提交者入口完成“填写 → 上传 → 正式提交 → 查看回执”。完整操作顺序和复现脚本见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

部署者可以在本机 `.env`、进程环境或部署平台 Secret 中配置 provider、模型名和 API Key。FormFlow 不把 API Key 写入数据库、浏览器响应、日志、审计事件或 MCP 配置；材料是否发送给外部 provider，以及 provider 如何留存和处理材料，由部署者自行决定。配置示例和输入模式见[部署与模型接入](docs/deployment.md)。

## 证据与许可

截图、浏览器脚本、运行条件和已知边界收录在[验证档案索引](docs/ux-review-index.md)。这些档案帮助访客复现产品行为，不把虚构种子或离线结果包装成真实模型准确率。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`