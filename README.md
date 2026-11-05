<div align="center">

# FormFlow · 收齐啦

### 把零散通知变成可执行的收集任务，把多份材料变成有证据的审核结果

FormFlow 面向报名、征集、材料验收和归档场景。组织者提供通知、名单、模板与补充要求，系统整理出可确认的收集规则；提交者按清单完成填写和上传；审核 Agent 再把跨文件核验结果连回原文件和页码。

[开始体验](#开始体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档入口](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 作品体验

FormFlow 让一件常见的组织工作有一条清晰的路径：

1. **整理要求**：把通知、名单、模板和附件交给需求 Agent，得到字段、材料槽位、截止时间和核验规则。
2. **发布收集**：组织者确认蓝图后发布任务，提交者看到自己的清单、截止时间和补正入口。
3. **逐项审核**：审核 Agent 检查字段一致性、文件属性、跨材料关系和内容覆盖，并为每条结论保留证据位置。
4. **人工确认**：证据不足、材料未读或模型调用失败时，结果停在“需要人工处理”，不会被伪装成不合格。
5. **交付归档**：组织者确认通过的版本，固定快照并导出 CSV 与 ZIP，排除原因也会一并保留。

| 组织者看到什么 | 提交者看到什么 |
| --- | --- |
| 来源资料、可编辑蓝图和发布前核对 | 本人的字段、材料清单和截止时间 |
| 应交、免交、已提交、待验收和补正状态 | 服务器草稿、正式提交回执和更正入口 |
| 规则结论、文件位置、页码证据和人工接管点 | 哪些事项需要自己处理，哪些事项等待组织者确认 |
| 验收快照、CSV、ZIP 和排除明细 | 每次提交后的可追溯状态 |

## 两个 Agent

**需求 Agent** 把“收到一堆资料”变成“可以发布的收集蓝图”。它识别适用对象、身份字段、材料要求、格式约束、时间策略和跨文件规则；资料互相矛盾或无法确定时，会保留来源并提出澄清问题。蓝图必须由组织者确认后才会成为正式规则。

**审核 Agent** 以已发布规则为准检查一次提交中的多份材料。它可以比对姓名、学号等身份信息，检查文件格式、数量、大小和页数，判断内容是否覆盖要求，并把结果定位到文件和页码。每条规则都有明确状态：已满足、发现问题、证据不足或检查未完成。

## Agent 如何受控运行

- **Skill** 固化资料整理、规则编译、证据引用和结构化输出的工作方法。
- **Harness** 限制任务范围、工具白名单、调用预算、超时、重试和人工接管。
- **MCP** 提供受限的只读任务状态和运行摘要，不写入业务数据，也不绕过权限。
- **确定性检查** 处理文件类型、数量、大小、时间、版本和导出；模型负责理解、比对和解释。

支持文件或图片输入的 provider 会优先读取原始材料。只有 provider 不支持、文件超限或调用失败时，系统才进入文字解析或 OCR 降级路径；直传模式失败时会明确报告失败，不会悄悄改变审核方式。

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

推荐先走组织者路径：需求设计 → 名单与凭证 → 收集工作台 → 证据复核 → 交付归档；然后从提交者入口体验填写、上传、正式提交和更正。完整步骤见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

本地启动方式：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

provider、文件输入模式和部署方式见[部署与模型接入](docs/deployment.md)。API Key 只从部署者本机的 `.env`、进程环境或部署平台 Secret 读取，不写入数据库、浏览器响应、日志、审计事件或 MCP。启用外部 provider 后，材料可能离开本机，正式使用前应核对 provider 的留存、训练、跨境和计费政策。

## 证据边界

文件和页码是模型提供的定位线索，组织者仍可打开原文完成最终判断。演示种子用于展示流程、权限、降级和导出行为，不代表真实模型准确率。真实 provider 应使用获授权的脱敏材料单独验证文件输入、模型质量和数据处理政策。

截图、复现脚本和可重复的验证结果见[验证档案索引](docs/ux-review-index.md)。项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
