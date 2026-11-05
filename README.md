<div align="center">

# FormFlow · 收齐啦

### 把一堆通知和附件，变成可执行、可核对的材料流程

FormFlow 是一个面向组织者的材料收集与审核工作台。它先把通知、名单和模板整理成收集任务，再把提交者交来的表单与附件逐条核验，保留规则来源、证据位置和人工确认入口。

[立即体验](#立即体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档导航](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 你可以用它做什么

FormFlow 适合报名、征集、材料归档、项目验收等场景：组织者面对一份通知、一张名单和几份模板，提交者面对一张收集表和多个材料槽位，最后的审核结果能回到具体文件、页码或字段。

完整流程分成四步：

1. **整理要求**：上传通知、名单、模板和附件，补充自然语言说明。
2. **发布收集任务**：需求 Agent 生成可编辑蓝图，组织者确认后发布字段、材料槽位、时间和审核规则。
3. **逐项核验材料**：提交者填写身份信息并上传文件，审核 Agent 检查跨文件一致性、格式、数量、内容覆盖和排版问题。
4. **确认与交付**：组织者处理补正和人工判断，生成固定快照，再导出 CSV 与 ZIP。

## 两条 Agent 路径

### 需求 Agent：从资料得到收集蓝图

需求 Agent 读取通知、名单、模板、附件和组织者的补充要求，整理出适用对象、字段、材料要求、截止时间、补正策略和跨材料核验规则。每条要求都尽量带回来源资料；资料之间有冲突或信息不足时，结果会列出需要确认的问题。

蓝图可以编辑。只有组织者确认并发布后，草案才会变成正式规则，Agent 不会替组织者自动发布任务。

### 审核 Agent：从材料得到有依据的结论

审核 Agent 以表单、名单、已发布规则和提交材料为上下文，逐项回答三个问题：是否满足、证据在哪里、下一步由谁处理。

- 表单和不同文件里的姓名、学号等身份信息是否一致；
- 文件类型、数量、大小、页数和命名是否符合规则；
- 材料内容是否覆盖要求，格式或排版是否存在可说明的问题；
- 哪些事项需要提交者补正，哪些事项只能由组织者确认。

结果区分 `satisfied`、`issue`、`unknown` 和 `failed`。模型给出的文件定位是可复核的线索，程序会检查引用格式，组织者仍可以打开原文作最终判断。

## AI 能力的边界

FormFlow 把模型放在明确的工作边界内：

- **Skill** 描述资料提取、规则编译、证据引用和结构化输出的步骤；
- **Harness** 限定任务范围、工具白名单、预算、超时、重试和人工接管；
- **确定性检查** 处理文件类型、数量、大小、版本、权限和导出等程序可判断的事项；
- **MCP** 提供受限的只读任务状态、收集汇总和运行合同，不提供写入业务数据的入口；
- **组织者确认** 保留规则发布、补正裁决和最终验收权。

原始 PDF 或图片优先交给部署者配置的模型 provider 直读。provider 不支持、文件超限或调用失败时，才使用文字解析或 OCR 降级。直传证据仍属于模型定位线索，不能替代人工打开原文件核对。

## 模型配置与隐私

部署者自行选择兼容的模型 provider，并把 API Key 放在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把密钥写入数据库、浏览器、日志、审计事件或 MCP。

启用外部 provider 后，原始材料或解析文本可能离开本机。正式使用前，请根据 provider 的留存、训练、跨境和计费政策配置合适的材料范围。

## 立即体验

仓库里的演示数据、人物和审核轨迹都是虚构内容，不需要模型密钥：

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

指定端口或检查本地服务：

```bash
python scripts/start_demo.py --port 8010
python scripts/start_demo.py --check --port 8010
```

组织者和提交者的完整操作顺序见[体验指南](docs/demo-guide.md)。

## 自行部署

项目使用 Python 3.12、FastAPI、原生 HTML/CSS/JavaScript 和 SQLite，前端不需要构建步骤。API 与 Worker 需要共享配置、数据库和附件目录；正式部署时请为 SQLite 与附件配置持久化存储，并在反向代理层启用 HTTPS。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

详细的部署、模型输入模式和数据边界见[部署与模型接入](docs/deployment.md)。

## 项目结构

```text
app/agents/       需求 Agent、审核 Agent、Skill 与工具合同
app/api/           组织者与提交者 API、权限和路由
app/services/      队列、规则检查、快照和交付服务
app/static/        工作区、表单、复核和展示视图
app/parsing.py     PDF、DOCX、图片和文字解析/OCR 降级
app/llm.py         OpenAI-compatible 模型客户端和文件输入
scripts/           演示启动器、种子和浏览器 Harness
tests/             业务不变量、权限、恢复和前端契约
docs/              体验、部署、设计与验证档案
```

演示种子和离线轨迹用于展示流程、权限、状态和导出行为，不代表真实模型准确率。真实 provider 应使用获授权的脱敏材料重新验证文件输入兼容性、模型质量、数据处理政策和部署可靠性。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `traceability` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
