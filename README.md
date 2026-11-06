<div align="center">

# FormFlow · 收齐啦

### 从通知和名单开始，到有证据的材料验收结束

FormFlow 是一个面向报名、征集和材料归档的 AI 工作台。组织者把通知、名单、模板和附件放进任务，系统整理出可确认的收集规则；提交者按清单填写和上传；审核 Agent 将每条结论连回具体文件和位置。

[开始体验](#开始体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 一次任务如何完成

1. **整理要求**：上传通知、名单、模板和补充说明，需求 Agent 生成带来源的可编辑蓝图。
2. **确认发布**：组织者确认适用人员、字段、材料槽位、格式、时间和跨材料核验规则。
3. **提交材料**：提交者填写身份信息、上传多份文件、保存草稿并正式提交，系统生成版本和回执。
4. **逐项核验**：审核 Agent 比较表单与材料，给出 `satisfied`、`issue`、`unknown` 或 `failed`，并标出文件、页码或字段位置。
5. **人工交付**：组织者处理需要确认的项目，固定验收快照，再导出 CSV 和 ZIP。

组织者看到任务进度、证据和下一步动作；提交者只看到自己的清单、回执和需要自己处理的补正事项。上传文件不等于正式提交，`unknown` 或 `failed` 也不会被包装成“不合格”。

## 两个 Agent

**需求 Agent** 把来源资料变成规则。它识别适用人员、身份字段、材料、格式、数量、命名、页数、时间和跨材料检查项；资料冲突或要求含糊时保留来源并提出澄清问题。蓝图必须经过组织者确认，才会成为正式任务规则。

**审核 Agent** 按正式规则检查一次提交。它可以核对姓名、学号等身份信息，检查文件属性和内容覆盖，并把每条判断定位到相关材料。证据是可追溯的定位线索，组织者仍可打开原文完成最终判断。

## Agent 如何受约束

- **Skill** 固化资料提取、规则编译、证据引用和结构化输出的方法。
- **Harness** 限制任务范围、工具白名单、预算、超时、重试和人工接管。
- **MCP** 提供受限的只读任务状态和运行摘要，不读取逐人材料正文，也不提供写入工具。
- **确定性检查** 负责文件类型、数量、大小、时间、版本和导出条件；模型负责理解、比对和解释。

材料审核优先使用部署者配置的 provider 的 PDF 或图片输入。provider 不支持、文件超限或调用失败时，才进入文字解析或 OCR 降级；`direct` 模式会明确报告失败，不会偷偷切换。模型返回的文件和页码是定位线索，组织者仍需核对原文。

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

先从组织者入口查看“需求设计 → 收集工作台 → 证据复核 → 交付与归档”，再从提交者入口完成“填写 → 上传 → 正式提交 → 查看回执”。完整操作顺序和复现脚本见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

部署者可以在本机 `.env`、进程环境或部署平台 Secret 中配置 provider、模型名和 API Key。FormFlow 不把 API Key 写入数据库、浏览器响应、日志、审计事件或 MCP 配置；材料是否发送给外部 provider，以及 provider 如何留存和处理材料，由部署者自行决定。配置示例和输入模式见[部署与模型接入](docs/deployment.md)。

## 文档与边界

[文档入口](docs/README.md)按“先体验、再部署、后复现”组织全部说明。截图、浏览器脚本、运行条件和已知限制见[验证档案索引](docs/ux-review-index.md)。这些档案描述指定版本、虚构数据和本地环境下的可见行为，不替代真实 provider 的模型评估、敏感材料评估或公网部署验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
