<div align="center">

# FormFlow · 收齐啦

### 把一份通知，变成一条可追溯的材料收集与审核流程

FormFlow 面向报名、征集、评审和归档场景。组织者交给它通知、名单和模板，需求 Agent 整理出可确认的收集蓝图；提交者按蓝图填写和上传；审核 Agent 逐条比对材料并给出证据位置；组织者最后完成确认和交付。

[开始体验](#三分钟体验) · [体验指南](docs/demo-guide.md) · [部署说明](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 先看它解决什么

材料收集常常卡在三个地方：要求散落在通知和模板里，提交者不知道该交什么，组织者收到文件后还要手工核对姓名、学号、格式和跨文件内容。FormFlow 把这三个阶段连起来，同时保留每个判断的来源和下一步。

| 组织者 | 提交者 |
| --- | --- |
| 提供通知、名单、模板和补充要求 | 使用凭证进入指定任务 |
| 确认需求 Agent 生成的收集蓝图 | 按清单填写身份信息、上传材料、保存草稿 |
| 查看逐条证据，处理人工确认和补正 | 查看回执，只处理明确属于自己的补正事项 |
| 固定快照，导出 CSV 与 ZIP | 知道材料已收到、检查是否完成、下一步由谁负责 |

## 一条完整链路

1. **整理要求**：通知、名单、模板和自然语言补充说明进入需求 Agent，输出字段、材料槽位、时间策略和审核规则。
2. **确认发布**：组织者查看来源、处理冲突和澄清问题，确认后才发布任务。
3. **收件核验**：提交者填写并正式提交；审核 Agent 按规则检查身份一致性、文件属性、内容覆盖和跨文件一致性。
4. **人工接管与交付**：组织者打开原文核对证据，处理 `unknown` 和人工项，再固定快照导出交付包。

每条检查都使用清晰的状态：`satisfied` 表示已有证据支持，`issue` 表示发现问题，`unknown` 表示证据不足，`failed` 表示检查过程未完成。上传文件不等于正式提交，检查未完成也不会被包装成“不合格”。

## 两个 Agent，四道边界

| 能力 | 负责什么 |
| --- | --- |
| 需求 Agent | 从资料中提取适用人员、字段、材料、格式、数量、命名、时间和核验规则，并保留来源引用 |
| 审核 Agent | 结合表单和全部材料逐条比对，返回结论、解释、文件/页码位置以及组织者和提交者的下一步 |
| 确定性检查 | 处理扩展名、MIME、大小、数量、页数、哈希、字段格式和导出条件 |
| 人工确认 | 核对原文、判断证据不足的情况，并决定是否验收或要求补正 |

Skill 固化 Agent 的工作方法和输出格式，Harness 限制任务范围、工具白名单、预算、超时、重试和人工接管，MCP 只提供受限的只读状态查询。模型只能理解和比对材料，不能自行发布任务、改变权限或写入业务状态。

文件审核优先使用部署者选择的 provider 的 PDF 或图片输入。provider 不支持、文件超限或调用失败时，才进入文字解析或 OCR 降级；`direct` 模式会明确报告失败，不会偷偷切换。模型返回的文件和页码是定位线索，组织者仍可打开原文完成最终判断。

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

先从“需求设计”看资料如何变成蓝图，再进入“收集工作台 → 证据复核 → 交付与归档”。提交者入口可以完整体验“填写 → 上传 → 正式提交 → 查看回执”。完整路线和复现脚本见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

模型配置由部署者保存在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把 API Key 写入数据库、浏览器响应、日志、审计事件或 MCP 配置。材料是否发送给外部 provider，以及 provider 如何留存和处理材料，由部署者自行决定；具体配置和上线检查见[部署与模型接入](docs/deployment.md)。

## 继续阅读

[文档入口](docs/README.md)按访客、部署者和验证者组织说明；[验证档案索引](docs/ux-review-index.md)提供截图、脚本、运行条件和限制。验证档案用于说明可复现的产品行为，不替代真实 provider 的模型评估、敏感材料评估或公网部署验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
