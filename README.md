# FormFlow · 收齐啦

> 以「收集任务」为最小单元的报名与材料托管平台。两个 Agent 协同：**需求 Agent** 把自然语言整理成结构化蓝图草案，**审核 Agent** 依据蓝图逐条做证据化检查。

完整产品方案见 `docs/`（`收齐啦产品设计方案_v0.3.docx`，纯文本提取见 `docs/plan_extracted.txt`）。本仓库按方案分关卡（Gate）推进，当前处于 **G1 收尾阶段**。

## 核心概念

- **收集任务（Task）**：一次报名/材料收集。含开放时间、首次截止、补正截止（双截止）。
- **蓝图（Blueprint）**：任务的结构化定义 = 字段 + 材料槽位 + 规则 + 时间策略。发布后冻结，修改产生新版本，**已产生的提交与决定永远引用各自版本，不回溯改写**。
- **主体（Subject）/ 正式版本（Revision）**：每个提交者有唯一主体；正式提交形成带回执的不可变版本。
- **两个 Agent**：
  - **需求 Agent**：自然语言 → 蓝图草案。只做澄清与整理，**不暗加规则**；发布的每条自动规则必须可程序化执行。
  - **审核 Agent**：逐规则证据化检查。每条结论必须附带能在原文定位的 quote，证据不足判 `unknown`，绝不臆造"通过"。
- **规则五态**：`satisfied` / `issue` / `unknown` / `not_applicable` / `failed`；`human_only` 规则不产出机器结论，转人工。

## 关键不变量（方案红线）

1. **幂等收件**：同一幂等键同内容返回同一回执；同键不同内容按冲突拒绝，绝不静默覆盖。
2. **双截止**：首次提交须落在 `[开放时刻, 首次截止)`，恰等于截止不接收；已有正式提交者在补正截止前可更新版本。
3. **验收前检查**：存在 `unknown` / `failed` / 未处置人工项时阻止验收。
4. **决定带作用域**：验收/驳回只对具体蓝图版本 + 具体提交版本生效，不扩大到未来版本。
5. **撤销追加记录**：撤销决定只追加撤销记录，历史不删除、不可篡改。
6. **CSV 与 ZIP 同快照**：汇总表与材料包引用同一交付快照，不错位；生成期间的新提交不静默改变原包。
7. **文件名含稳定 ID**：材料按 `主体ID_文件ID前8位_安全原名` 命名，防同名覆盖；保留原名映射。
8. **CSV 防公式注入**：以 `= + - @` 等开头的字段自动转义。
9. **模型降级不丢件**：LLM 不可用时收件照常，语义检查标记未完成并转人工。

## 架构

```
app/
├── config.py                  # 环境变量配置（密钥仅从 .env/环境读取，绝不入库）
├── db.py                      # SQLAlchemy 引擎与会话
├── models.py                  # 全部逻辑实体与状态常量
├── schemas.py                 # Pydantic 模型（蓝图/字段/槽位/规则/时间策略）
├── security.py                # 凭证哈希
├── storage.py                 # 私有文件存储：安全文件名、稳定 ID、sha256
├── parsing.py                 # PDF/DOCX/文本提取（图片=未读，不 OCR 臆测）
├── llm.py                     # OpenAI 兼容网关客户端 + 预算 + 降级异常
├── worker.py                  # 后台 worker：解析/审核/打包异步任务（进程内轮询）
├── agents/
│   ├── requirements_agent.py  # 需求 Agent：草稿生成 + 蓝图程序校验
│   └── review_agent.py        # 审核 Agent：确定性规则 + 语义规则（证据化）
├── services/
│   ├── tasks.py               # 任务创建 / 蓝图发布冻结
│   ├── submissions.py         # 幂等收件 / 双截止 / 草稿版本冲突
│   ├── checks.py              # 检查运行创建/执行/汇总（含验收态）
│   ├── decisions.py           # 人工决定记录/撤销/验收前检查
│   ├── export.py              # 交付快照 / CSV / ZIP 导出
│   └── demo_seed.py           # BP-C-001 演示种子（可重复执行）
├── api/routes.py              # REST API
├── static/                    # 组织者前端 SPA（P01-P05，无需构建）
└── worker.py                  # 后台 worker（见上）
scripts/seed_demo.py           # 演示数据 CLI
tests/                         # pytest（隔离临时 DB + StubLLM，不打真实网关）
tests/                         # pytest 测试套件（隔离临时 DB + StubLLM，不打真实网关）
```

## 快速开始

```bash
# 1. 安装依赖（Python >= 3.11）
pip install -r requirements.txt

# 2. 配置本地环境（.env 永不提交；密钥只放这里）
cp .env.example .env
# 编辑 .env 填入 FORMFLOW_LLM_API_KEY 等

# 3. 启动 API（默认 http://127.0.0.1:8000）
uvicorn app.main:app --reload

# 4. （可选）启动后台 worker 处理排队中的检查
python -m app.worker

# 5. （可选）写入演示数据：账号 demo/demo1234，任务 id=1，打印提交者一次性凭证
python scripts/seed_demo.py

# 6. 运行测试
python -m pytest tests/ -q
```

启动后访问 `http://127.0.0.1:8000/` 即为组织者前端（P01 登录 → P02 任务/蓝图 → P03 工作台 → P04 证据复核 → P05 快照导出）；API 文档在 `/docs`。

## API 概览

| 分组 | 端点 |
| --- | --- |
| 账号 | `POST /accounts`、`POST /auth/login`、`GET /me` |
| 任务 | `POST /tasks`、`GET /tasks/{id}/blueprint`、`GET /tasks/{id}/workbench` |
| 蓝图 | `POST /tasks/{id}/draft/agent`（需求 Agent 草稿）、`POST /tasks/{id}/draft/template`（模板）、`POST /tasks/{id}/blueprints/{bp_id}/publish` |
| 名册与授权 | `POST /tasks/{id}/roster`、`POST /tasks/{id}/grants` |
| 提交者 | `POST /me/draft`、`POST /me/files`、`POST /me/submit`、`GET /me/receipt`、`GET /me/results` |
| 组织者 | `GET /tasks`、`POST /tasks/{id}/subjects/{sid}/checks`（发起审核）、`POST .../decisions`（决定）、`POST .../decisions/{did}/revoke`（撤销）、`GET .../findings`（证据复核：规则结论+证据 quote+决定历史）、`POST /tasks/{id}/snapshots`、`POST /snapshots/{sid}/export` |
| 导出下载 | `GET /exports/{job_id}/csv`、`GET /exports/{job_id}/zip`（均校验快照归属） |
| 通知（V24） | `GET /tasks/{id}/notifications`（催交视图每次重算 + 历史）、`POST /tasks/{id}/notifications`（生成意图，目标为创建时快照）、`POST /notifications/{nid}/copy`（标记已复制；无发送/送达状态） |

## 关卡路线（方案第 19 节）

| 关卡 | 目标 | 状态 |
| --- | --- | --- |
| G0 设计确认 | 蓝图、页面、虚构材料与人工答案；用户试走关键决策 | 进行中 |
| G1 无模型业务闭环 | 真实权限、上传、版本、名单、人工验收与导出；重启不丢 | **主体功能完成（当前）**：端到端冒烟 24 项通过 |
| G2 需求 Agent | 澄清与编辑同步，不暗加要求 | 未开始 |
| G3 审核 Agent | 真实解析、证据、预算、人工转交；样本可重复检查 | 部分（确定性规则+语义规则骨架已完成） |
| G4 鲁棒性 | 补交、申诉、晚作业、并发、快照、降级与恢复 | 未开始 |
| G5 外部试用 | 授权脱敏试点，记录收益与错误后再扩展 | 未开始 |

## 测试

- `tests/test_llm.py`：网关客户端、预算、降级异常（StubLLM，无真实网络）。
- `tests/test_requirements_agent.py`：蓝图草稿生成与程序校验（重复 ID/日期顺序/依赖环/来源可定位）。
- `tests/test_review_agent.py`：确定性规则 + 语义规则（quote 定位、覆盖不足→unknown、故障→failed）。
- `tests/test_submissions.py`：幂等收件、双截止、草稿冲突。
- `tests/test_decisions.py`：验收前检查、撤销、作用域。
- `tests/test_export.py`：快照固定性、CSV/ZIP 同快照、稳定 ID 命名、公式注入防护。
- `tests/test_authz.py`：会话持久化与过期、越权访问（他人任务/主体）统一 404/401。
- `tests/test_demo_seed.py`：演示数据不变量（应交 4、张三已验收、李四待补正、王五待人工）与快照只纳入已验收。
- `tests/test_notifications.py`：催交名单重查、只标已复制（V24）。
- `tests/test_business_specs.py`：V16 同名新文件保留、V19 上传不算交、V22 材料注入防护与引用校验。

## 安全说明

- `.env` 已被 `.gitignore` 忽略，**绝不提交**；密钥只从环境变量读取。
- `data/`（SQLite 数据库与私有文件存储）不提交。
- 上传文件以稳定 ID 存放、原名映射保留；文件名净化防路径穿越。
- 文件内容只作为数据发送给模型，不作为指令（prompt 由程序构造）。
- 审核有页数/调用/重试预算，预算耗尽明确记录未完成项并转人工。

## 许可证

暂定，待定。
