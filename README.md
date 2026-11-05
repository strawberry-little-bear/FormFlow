<div align="center">

# FormFlow · 收齐啦

### 让材料收集、核验和交付都有据可查

FormFlow 面向需要收齐一批表单和附件的组织者。它把通知、名单和模板变成一份可确认的收集任务，再把提交者交来的多份材料变成逐条、有证据、可人工复核的检查结果。

[立即体验](#立即体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档导航](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 这是什么

材料收集真正困难的部分，往往发生在“发出表格”之后：谁需要提交、每个人要交什么、不同文件里的姓名和学号是否一致、哪些规则已经满足、哪些问题仍需要人判断，以及最后交付包里到底应该放哪些版本。

FormFlow 把这些动作放在同一个工作区中，并让每个结果都回到原始资料、提交版本和审核证据上。组织者确认规则，提交者按清单准备材料，审核 Agent 逐条检查，组织者保留最终的补正、验收和交付决定权。

## 一条完整路径

1. **整理要求**：上传通知、名单、模板和附件，或补充自然语言要求。需求 Agent 生成带来源引用的收集蓝图，标出冲突和需要确认的地方。
2. **收集材料**：提交者填写身份信息、上传多个文件、保存草稿并正式提交。上传和正式提交是两个明确的状态。
3. **逐项核验**：审核 Agent 对照已发布规则检查身份一致性、文件属性、内容覆盖和排版问题，并把结论定位到文件和页码或区域。
4. **确认交付**：组织者处理提交者补正和人工判断，固定验收快照，再导出 CSV 与 ZIP。快照生成后不会被后续补交悄悄改写。

## 两个 Agent

### 需求 Agent

需求 Agent 读取组织者提供的通知、名单、模板、附件和补充说明，整理出：

- 适用的提交者和身份字段；
- 字段、材料槽位、格式、数量、命名和页数要求；
- 截止时间、补正时间和跨材料核验规则；
- 资料之间的冲突、缺失和需要确认的问题。

结果是一份可编辑草案。组织者确认并发布之后，它才会成为正式规则；Agent 不会替组织者自动发布要求。

### 审核 Agent

审核 Agent 以表单、名单、已发布规则和提交材料为上下文，逐条回答“是否满足、证据在哪里、谁需要处理”：

- 表单和不同文件中的姓名、学号等身份是否一致；
- 文件类型、数量、大小、页数和命名是否符合要求；
- 材料内容是否覆盖规则；
- 格式或排版是否存在可说明的问题；
- 哪些事项应由提交者补正，哪些事项只能由组织者确认。

结果使用 `satisfied`、`issue`、`unknown` 和 `failed` 区分“通过、发现问题、证据不足、检查未完成”。证据引用是模型提供的定位线索，程序会校验引用格式，组织者仍可以打开原文复核。

## Agent 如何被约束

FormFlow 把模型能力放在可检查的边界内：

- **Skill** 固化资料提取、规则编译、证据引用和输出格式；
- **Harness** 限制任务范围、工具白名单、预算、超时、重试和人工接管；
- **确定性检查** 负责文件类型、数量、权限、版本和导出等可程序化判断；
- **MCP** 只提供受限的只读任务状态、收集汇总和运行合同，不提供写入业务数据的入口；
- **组织者确认** 是发布规则和最终验收的必要环节。

文件输入优先使用部署者配置的 provider 的 PDF 或图片能力。provider 不支持、文件超限或调用失败时，才进入文字解析或 OCR 降级；`direct` 模式会明确报告失败，不会偷偷改用 OCR。

## 模型与隐私边界

模型 API Key 由部署者保存在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把它写入数据库、浏览器、日志、审计事件或 MCP 配置。启用外部 provider 后，原始材料或解析文本可能离开本机，部署者应在使用前确认 provider 的留存、训练、跨境和计费政策。

## 立即体验

演示数据、人物和审核轨迹均为虚构，不需要模型密钥：

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

常用命令：

```bash
# 指定端口
python scripts/start_demo.py --port 8010

# 检查本地依赖、API、Worker、Agent runtime 和只读 MCP
python scripts/start_demo.py --check --port 8010
```

完整的组织者和提交者路径见[体验指南](docs/demo-guide.md)。

## 开发与部署

项目使用 Python 3.12、FastAPI、原生 HTML/CSS/JavaScript 和 SQLite，前端不需要构建步骤。正式部署时，API 与 Worker 应共享同一份配置、数据库和附件目录，并把 SQLite 与附件放在持久化存储上。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

生产环境的 HTTPS、备份、附件访问控制、共享数据库和模型配置见[部署与模型接入](docs/deployment.md)。

## 仓库结构

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

## 评审边界

仓库内置的虚构种子和离线轨迹用于展示流程、权限、状态和导出行为，不代表真实模型准确率。接入真实 provider 时，请使用获授权的脱敏材料重新验证文件输入兼容性、模型质量、数据处理政策和部署可靠性。证据不足或检查失败会保留为人工处理状态，不会被伪装成业务不合格。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `traceability` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
