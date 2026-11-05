<div align="center">

# FormFlow · 收齐啦

### 从一份通知，到一份有证据的交付结果

FormFlow 是面向组织者的材料收集与审核工作台。它把通知、名单和模板变成可确认的收集任务，再把提交者交来的表单和附件变成逐条、有依据、可人工接手的核验结果。

[立即体验](#立即体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档导航](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 适合什么场景

报名、征集、材料归档、项目验收和其他“多人提交、多份附件、最后需要交付”的工作，都可以用 FormFlow 串起来。组织者不必在聊天记录、表格和文件夹之间来回核对；提交者也能看到自己要交什么、当前缺什么、下一步由谁处理。

## 一条完整流程

1. **整理要求**：提供通知、名单、模板、附件和补充说明。
2. **确认收集任务**：需求 Agent 生成可编辑蓝图，列出字段、材料槽位、时间和核验规则；组织者确认后才发布。
3. **收集并核验**：提交者填写身份信息、上传多个文件并正式提交；审核 Agent 检查跨文件一致性、格式、数量、内容覆盖和排版问题。
4. **处理并交付**：组织者处理补正和人工判断，固定验收快照，导出 CSV 与 ZIP。

## 两个 Agent

### 需求 Agent

需求 Agent 从通知、名单、模板和补充材料中整理出适用对象、字段、文件要求、截止时间、补正策略和跨材料核验规则。每条要求尽量带回来源；资料冲突或信息不足时，会列出需要确认的问题。

生成的蓝图可以编辑。只有组织者确认并发布后，草案才会成为正式规则，Agent 不会替组织者发布任务。

### 审核 Agent

审核 Agent 按已发布规则检查提交者的表单和附件，逐条回答“结果是什么、证据在哪里、下一步由谁处理”。它可以发现姓名或学号不一致、文件格式和数量错误、内容缺项以及需要人工判断的情况。

审核结果区分四种状态：

- `satisfied`：已有证据支持规则；
- `issue`：发现需要处理的问题；
- `unknown`：证据不足，交给人工判断；
- `failed`：检查过程没有完成。

模型提供的文件和页码是定位线索，程序会检查引用格式和可定位性，组织者仍可以打开原文完成最终判断。

## Agent 如何受控运行

- **Skill** 固化资料提取、规则编译、证据引用和结构化输出的步骤。
- **Harness** 限制任务范围、工具白名单、预算、超时、重试和人工接管。
- **确定性检查** 负责文件类型、数量、大小、版本、权限和导出等程序可以可靠判断的事项。
- **MCP** 提供任务状态、收集汇总、下一步路线和运行合同等受限只读信息，不提供业务写入入口。
- **人工确认** 保留规则发布、补正裁决和最终验收权。

文件审核优先使用部署者配置的 provider 的 PDF 或图片输入。provider 不支持、文件超限或调用失败时，才进入文字解析或 OCR 降级；直传模式失败会明确报告失败，不会悄悄把不完整材料当成合格结论。

## 模型配置与隐私

部署者自行选择兼容的模型 provider，并把 API Key 保存在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把密钥写入数据库、浏览器、日志、审计事件或 MCP。

启用外部 provider 后，原始材料或解析文本可能离开本机。正式使用前，应根据 provider 的留存、训练、跨境和计费政策决定哪些材料可以发送。

## 立即体验

演示数据、人物和审核轨迹均为虚构内容，不需要模型密钥：

```bash
git clone https://github.com/strawberry-little-bear/FormFlow.git
cd FormFlow
python scripts/start_demo.py --reset
```

打开终端输出的地址，使用演示账号登录：

```text
账号：demo
密码：demo1234
```

需要指定端口或只检查本地服务时：

```bash
python scripts/start_demo.py --port 8010
python scripts/start_demo.py --check --port 8010
```

组织者和提交者的操作路径见[体验指南](docs/demo-guide.md)。

## 自行部署

项目使用 Python 3.12、FastAPI、原生 HTML/CSS/JavaScript 和 SQLite，前端不需要构建步骤。API 与 Worker 需要共享配置、数据库和附件目录；正式部署时请使用持久化存储、HTTPS、备份和访问控制。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

Windows PowerShell 使用 `.venv\Scripts\Activate.ps1`。部署细节、模型输入模式和数据边界见[部署与模型接入](docs/deployment.md)。

## 项目结构

```text
app/agents/       需求 Agent、审核 Agent、Skill 与工具合同
app/api/          组织者与提交者 API、权限和路由
app/services/     队列、规则检查、快照和交付服务
app/static/       工作区、表单、复核和展示视图
app/parsing.py    PDF、DOCX、图片和文字解析/OCR 降级
app/llm.py        OpenAI-compatible 模型客户端和文件输入
scripts/          演示启动器、种子和浏览器 Harness
tests/            业务不变量、权限、恢复和前端契约
docs/             体验、部署、设计与验证档案
```

虚构种子和离线轨迹用于展示流程、权限、状态和导出行为，不代表真实模型准确率。真实 provider 应使用获授权的脱敏材料重新验证文件输入兼容性、模型质量、数据处理政策和部署可靠性。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `traceability` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
