<div align="center">

# FormFlow · 收齐啦

### 从一份通知，到一份有证据的交付包

FormFlow 是一个面向组织者的材料收集与审核工作台。它把通知、名单和模板整理成可确认的收集任务，再把提交者填写的表单与多份材料放在同一条证据链上核验。

[五分钟了解](docs/demo-guide.md) · [本地运行](#本地运行) · [部署与模型接入](docs/deployment.md) · [文档目录](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

第一次打开 FormFlow，可以先看组织者路径：把通知、名单和模板整理成一份收集任务；再切到提交者路径，填写身份、上传材料并正式提交；最后进入复核页，查看跨文件一致性检查、证据位置和需要人工确认的事项。这个顺序就是作品的主要展示路径。

## FormFlow 解决什么问题

收集工作通常不是“发出一张表”就结束了。组织者还要确认谁需要提交、追踪补交、比对不同文件里的身份信息、判断材料是否满足要求，并保证交付包里放的是已经验收的版本。

FormFlow 把这些动作放在一个工作区中：

- 组织者看到任务、名单、截止时间和下一步动作；
- 提交者清楚地区分填写、上传、保存草稿和正式提交；
- 审核结果按规则逐条展示结论、证据位置和处理建议；
- 组织者保留发布、补正、验收和交付的最终决定权。

## 两条 Agent 路径

### 需求 Agent：把资料整理成收集蓝图

组织者可以提供通知、名单、模板、附件和补充说明。需求 Agent 从这些资料中整理出：

- 适用的提交者范围和身份字段；
- 需要填写的字段与材料槽位；
- 文件格式、数量、命名、大小和页数要求；
- 截止时间、补正时间和跨材料核验规则；
- 资料之间的冲突、缺失和需要组织者确认的问题。

结果是一份带来源引用的可编辑草案。Agent 不会自行发布任务，组织者确认后才会成为正式规则。

### 审核 Agent：把材料变成逐条证据

提交者填写姓名、学号等信息并上传多份材料后，审核 Agent 依据已发布规则检查：

- 表单和文件中的身份信息是否一致；
- 文件真实类型、数量、大小、页数和命名是否符合要求；
- 材料内容是否覆盖要求；
- 结构、格式和排版是否存在明确问题；
- 哪些事项需要提交者补正，哪些事项需要组织者确认。

每条结果都包含结论、解释、文件和位置。`unknown` 表示证据不足，`failed` 表示检查过程未完成；它们不会被伪装成“不合格”。

## AI 工具边界

FormFlow 将 Skill、Harness 和 MCP 放在清晰的职责边界内：

- **Skill** 固化资料提取、规则编译、证据引用和输出格式；
- **Harness** 限制任务范围、工具、预算、超时、恢复和人工接管；
- **MCP** 只提供受限的只读运行状态，不能绕过权限修改业务数据；
- **确定性检查** 由程序完成，模型负责理解、比对和解释。

文件审核优先使用用户配置的模型原始 PDF 或图片输入。provider 不支持、文件超限或调用失败时，系统才进入文字解析或允许的 OCR 降级路径；`direct` 模式会明确报告失败，不会偷偷换成 OCR。

模型密钥由部署者保存在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不保存、不展示、不写入日志、审计事件或浏览器响应。启用外部模型后，材料会按照所选 provider 的规则离开本机，部署前应确认其留存、训练、跨境和计费政策。

## 本地运行

演示数据、人物和材料均为虚构，不需要模型密钥：

```bash
git clone https://github.com/strawberry-little-bear/FormFlow.git
cd FormFlow
python scripts/start_demo.py
```

启动后打开终端输出的地址，使用演示账号：

```text
账号：demo
密码：demo1234
```

常用命令：

```bash
# 指定端口
python scripts/start_demo.py --port 8010

# 恢复虚构演示数据
python scripts/start_demo.py --reset

# 只做本地依赖、API、Worker、Agent runtime 和 MCP 只读检查
python scripts/start_demo.py --check
```

想看完整展示顺序，请阅读[五分钟演示指南](docs/demo-guide.md)。

## 开发与部署

项目使用 Python 3.12、FastAPI、原生 HTML/CSS/JavaScript 和 SQLite 开发环境；前端不需要构建步骤。正式部署时，API 与 Worker 必须共享同一份配置、数据库和附件目录，并把 SQLite 与附件放在持久化存储上。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

模型、附件、反向代理、备份和公网边界见[部署与模型接入](docs/deployment.md)。

## 项目结构

```text
app/agents/       需求 Agent、审核 Agent、Skill 与工具合同
app/api/           组织者与提交者 API、权限和路由
app/services/      队列、规则检查、快照和交付服务
app/static/        工作区、表单、复核和展示视图
app/parsing.py     PDF、DOCX、图片和文本解析/OCR 降级
app/llm.py         OpenAI-compatible 模型客户端和文件输入
scripts/           演示启动器、种子和浏览器 Harness
tests/             业务不变量、权限、恢复和前端契约
docs/              演示、部署、设计与验证证据
```

## 当前边界

FormFlow 是一个可直接运行和展示的黑客松作品。收集、提交、逐项审核、人工验收和快照交付已经在隔离演示环境中打通；真实 provider 的文件输入兼容性、模型质量、真实业务数据合规、多实例部署和灾难恢复仍需在授权环境中单独验收。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `traceability` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
