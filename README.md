<div align="center">

# FormFlow · 收齐啦

### 把零散通知变成可核对、可交付的材料流程

FormFlow 面向需要收材料的人：组织者把通知、名单、模板和附件交给系统，得到一份可确认的收集任务；提交者按清单填写并上传；审核结果回到具体规则、文件和证据位置。

[立即体验](#立即体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档导航](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 这是什么

报名、征集、项目验收和材料归档通常把通知、名单、表格、附件和催交消息分散在多个地方。FormFlow 把这些内容放进同一条可追溯流程：先把“谁要交什么、什么时候交、按什么标准核验”整理清楚，再把收到的材料逐项核对，最后固定快照并导出交付包。

你可以从两个角色看到完整体验：

| 角色 | 主要路径 |
| --- | --- |
| 组织者 | 导入资料 → 确认收集蓝图 → 跟进提交 → 复核证据 → 归档交付 |
| 提交者 | 查看清单 → 填写身份信息 → 上传材料 → 正式提交 → 查看回执与补正项 |

## 两个 Agent

### 需求 Agent

把通知、名单、模板、附件和补充说明整理成可编辑的收集蓝图。蓝图包含适用对象、字段、材料槽位、格式与数量、截止时间、补正方式，以及需要跨材料核验的规则。每条要求尽量带回来源；资料互相矛盾或信息不足时，先列出澄清问题。

组织者确认后才能发布。Agent 负责整理和提示，不替组织者发布未经确认的规则。

### 审核 Agent

以已发布规则、提交表单和多份材料为输入，逐条检查身份信息是否一致、文件是否符合格式和数量要求、内容是否覆盖要求，以及哪些地方需要人工判断。每条结果都带结论、证据位置和后续动作，并区分“已满足”“发现问题”“证据不足”和“检查未完成”。

模型给出的文件和页码是可定位的线索，组织者可以打开原文完成最终判断；系统不会把读不全或模型失败的材料自动判成不合格。

## AI 如何参与

- **Skill** 固化资料分类、规则编译、证据引用和结构化输出，让两类 Agent 遵循同一套可复用流程。
- **Harness** 约束任务范围、工具白名单、预算、超时、重试和人工接管，避免 Agent 越权或无限运行。
- **确定性检查** 处理文件类型、数量、大小、时间、版本和导出等程序可以可靠判断的事项。
- **MCP** 提供受限只读的任务状态、收集汇总和运行合同，不提供业务写入口，也不绕过权限。

文件审核优先使用部署者配置的 provider 的 PDF 或图片输入。provider 不支持、文件超限或调用失败时，再进入文字解析或 OCR 降级，并在结果中保留降级原因。

## 密钥与材料边界

部署者自行选择兼容的模型 provider，把 API Key 放在本机 `.env`、进程环境或部署平台 Secret 中。FormFlow 不把密钥写入数据库、浏览器、日志、审计事件或 MCP。启用外部 provider 后，原始材料或解析文本可能离开本机，正式使用前应核对 provider 的留存、训练、跨境和计费政策。

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

体验顺序、组织者与提交者入口，以及跨材料复核示例见[体验指南](docs/demo-guide.md)。需要指定端口时，可运行 `python scripts/start_demo.py --port 8010`。

## 部署与深入阅读

项目使用 Python 3.12、FastAPI、原生 HTML/CSS/JavaScript 和 SQLite，前端不需要构建步骤。API 与 Worker 需要共享配置、数据库和附件目录；生产环境应使用持久化存储、HTTPS、备份和访问控制。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

部署、模型输入模式和数据边界见[部署与模型接入](docs/deployment.md)；截图、脚本和运行条件见[验证档案索引](docs/ux-review-index.md)。

虚构种子和离线轨迹用于展示流程、权限、状态和导出行为，不代表真实模型准确率。真实 provider 应使用获授权的脱敏材料重新验证文件输入兼容性、模型质量和数据处理政策。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `traceability` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
