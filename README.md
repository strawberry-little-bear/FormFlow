<div align="center">

# FormFlow · 收齐啦

### 从一条通知，到一份有证据的交付包

FormFlow 把报名、征集、验收和归档中分散的通知、名单、模板与附件，整理成一条可追溯的材料流程。

[开始体验](#开始体验) · [体验指南](docs/demo-guide.md) · [部署与模型接入](docs/deployment.md) · [文档](docs/README.md)

</div>

![FormFlow 展示视图](docs/ux-review-2026-10-30/showcase-home-current.png)

## 你能用它做什么

组织者提供通知、名单、模板和补充要求，FormFlow 生成一份可编辑的收集蓝图。蓝图确认后，提交者按清单填写、上传并正式提交；审核结果回到具体规则、文件和页码，组织者确认后再生成 CSV 与 ZIP 归档包。

| 组织者 | 提交者 |
| --- | --- |
| 导入资料，整理字段和材料槽位 | 查看清单，填写信息并上传材料 |
| 设定截止时间、格式和核验规则 | 保存服务器草稿并正式提交 |
| 跟进提交、查看证据、处理补正 | 查看回执，知道哪些事项需要自己处理 |
| 验收并固定交付快照 | 在更正入口补交或替换材料 |

## 两个 Agent

**需求 Agent** 把通知、名单、模板和附件变成收集蓝图：适用对象、字段、材料、格式、截止时间、补正方式和跨文件核验规则都会进入草案。资料之间有冲突时，先列出来源和待确认问题；未经组织者确认，规则不会发布。

**审核 Agent** 按已发布规则检查一次提交中的多个文件。它会比对姓名、学号等身份信息，检查格式和数量，寻找内容覆盖关系，并把每条结论连到文件和页码。结果分为“已满足”“发现问题”“证据不足”和“检查未完成”，模型不能读到的内容不会被自动判成不合格。

## AI 运行方式

- **Skill** 固化资料整理、规则编译、证据引用和结构化输出。
- **Harness** 限制 Agent 的任务范围、工具、预算、超时和人工接管点。
- **MCP** 提供受限只读的任务状态和运行摘要，不绕过业务权限。
- **确定性检查** 负责文件类型、数量、大小、时间、版本和导出；语义理解与跨文件比对交给模型。

支持文件或图片输入的模型会优先读取原始材料。模型不支持、文件超限或调用失败时，才使用文字解析或 OCR 降级，并在审核结果中保留来源页码和未读范围。

## 先看演示

演示数据和审核轨迹都是虚构的，不需要模型密钥：

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

建议顺序：组织者登录 → 需求设计 → 名单与凭证 → 收集工作台 → 证据复核 → 交付归档；再从提交者入口走一遍填写、上传、正式提交和更正。完整路线见[体验指南](docs/demo-guide.md)。

## 接入自己的模型

本地开发环境：

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --require-hashes -r requirements.lock
cp .env.example .env
uvicorn app.main:app --host 127.0.0.1 --port 8000
python -m app.worker
```

模型 provider、输入模式和密钥配置见[部署与模型接入](docs/deployment.md)。API Key 只从本机 `.env`、进程环境或部署平台 Secret 读取，不写入数据库、浏览器响应、日志、审计事件或 MCP。启用外部 provider 后，原始材料或解析文本可能离开本机，正式使用前请核对 provider 的留存、训练、跨境和计费政策。

## 证据与边界

文件和页码是模型给出的定位线索，组织者可以打开原文完成最终判断。演示种子用于展示流程、权限、降级和导出行为，不代表真实模型准确率。真实 provider 应使用获授权的脱敏材料单独验证文件输入、模型质量和数据处理政策。

截图、复现脚本和每轮验证条件见[验证档案索引](docs/ux-review-index.md)。

项目使用 MIT License，详见 [LICENSE](LICENSE)。

**GitHub Topics**：`ai-agents` · `agentic-workflows` · `agent-skills` · `agent-harness` · `document-ai` · `document-review` · `cross-document-validation` · `evidence-based` · `human-in-the-loop` · `form-management` · `workflow-automation` · `mcp` · `openai-compatible` · `fastapi`
