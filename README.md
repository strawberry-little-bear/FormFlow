# FormFlow · 收齐啦

> 以「收集任务」为最小单元的报名与材料托管平台。两个 Agent 协同：**需求 Agent** 把自然语言整理成结构化蓝图草案，**审核 Agent** 依据蓝图逐条做证据化检查。

完整产品方案见 `docs/`（`收齐啦产品设计方案_v0.3.docx`，纯文本提取见 `docs/plan_extracted.txt`）。本仓库按方案分关卡（Gate）推进，当前 **G1-G4 主体功能已实现，持续修复交互和业务契约**；最新验证为 281 项 Python 测试、35 项前端契约测试通过。已知缺口、浏览器验证范围与后续优化见 `docs/interaction-optimization.md`。

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
├── parsing.py                 # PDF/DOCX/文本提取；扫描件/图片 OCR（RapidOCR 本地识别）
├── llm.py                     # OpenAI 兼容网关客户端 + 预算 + 降级异常
├── worker.py                  # 后台 worker：解析/审核/打包异步任务（进程内轮询，启动时恢复被中断的运行）
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
└── static/                    # 组织者前端 SPA（P01-P05，无需构建；P02 任务状态/生命周期操作/失败重试，P03 复核页重试入口，P04 只读态提示、槽位必交条件实时预览——镜像后端条件语法，不满足禁用上传、不受支持提示转人工；P03 复核页展示材料覆盖情况（提取方法/总页/已读/未读/失败），P04 提交者看到规则明细（哪里有问题/怎么改/引用证据/剩余待办），两端同源不出现两套说法）
scripts/seed_demo.py           # 演示数据 CLI
scripts/push_via_api.py        # git 协议被网络阻断时，经 GitHub REST API 推送提交
tests/                         # pytest（隔离临时 DB + StubLLM，不打真实网关）
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
# 检查执行全异步：正式提交/发起检查/重试都只入队即返回，由 worker 轮询执行
# （LLM 语义检查可能耗时数分钟，请求不挂起；worker 重启后自动接管排队与中断的运行）

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
| 蓝图 | `POST /tasks/{id}/draft/agent`（需求 Agent 草稿）、`POST /tasks/{id}/draft/template`（模板）、`POST /tasks/{id}/draft/revise`（澄清轮次：基于指定草案版本修订，返回新草案与修改影响）、`POST /tasks/{id}/blueprints/{bp_id}/publish` |
| 名册与授权 | `POST /tasks/{id}/roster`、`POST /tasks/{id}/grants` |
| 提交者 | `POST /me/draft`、`POST /me/files`、`POST /me/submit`、`GET /me/receipt`、`GET /me/results` |
| 组织者 | `GET /tasks`、`POST /tasks/{id}/subjects/{sid}/checks`（发起审核）、`POST /tasks/{id}/subjects/{sid}/checks/retry`（检查重试：模型/OCR 故障后重试生成新运行，旧运行标记被取代并保留历史）、`POST .../decisions`（决定）、`POST .../decisions/{did}/revoke`（撤销）、`GET .../findings`（证据复核：规则结论+证据 quote+决定历史）、`POST /tasks/{id}/snapshots`、`POST /snapshots/{sid}/export` |
| 导出下载 | `GET /exports/{job_id}/csv`、`GET /exports/{job_id}/zip`（均校验快照归属） |
| 通知（V24） | `GET /tasks/{id}/notifications`（催交视图每次重算 + 历史）、`POST /tasks/{id}/notifications`（生成意图，目标为创建时快照）、`POST /notifications/{nid}/copy`（标记已复制；无发送/送达状态） |
| 任务生命周期（V24 / 表 6） | `POST /tasks/{id}/close`（关闭：停止占用提交入口，历史保留）、`POST /tasks/{id}/reopen`（恢复收集，仅关闭可恢复）、`POST /tasks/{id}/archive`（归档：长期留存态，有未完成检查时拒绝）、`POST /tasks/{id}/cancel`（取消：中止收集，归档后不可取消） |

## 关卡路线（方案第 19 节）

| 关卡 | 目标 | 状态 |
| --- | --- | --- |
| G0 设计确认 | 蓝图、页面、虚构材料与人工答案；用户试走关键决策 | 进行中 |
| G1 无模型业务闭环 | 真实权限、上传、版本、名单、人工验收与导出；重启不丢 | **主体功能完成**：端到端冒烟 24 项通过 |
| G2 需求 Agent | 澄清与编辑同步，不暗加要求 | **主体功能完成（当前）**：澄清轮次闭环（回答/修改意见 → 修订为新草案版本，历史不篡改，返回修改影响） |
| G3 审核 Agent | 真实解析、证据、预算和人工转交；样本可重复检查 | **已完成**：PyMuPDF+RapidOCR 真实解析（扫描件/图片 OCR，失败记未读不臆造）、真实类型检测防扩展名伪装、OCR 噪声引用容忍、6 场景真实冒烟（V05/V06/V07/V12/预算） |
| G4 任务生命周期 | 关闭/恢复/归档/取消、只读拦截（V24 / 表 6） | **已验证**：关闭后草稿/上传/提交/检查/修订/发布全部 409 拦截，归档前校验无未完成检查，终态规则与操作全部落审计；检查重试（V20 / 表 6）——失败运行可重试生成新运行、旧运行标记 superseded 保留历史，execute_run 未预期异常标记 failed 不再卡 running；V15 版本回归（v1 验收不带到 v2、迟完成不回退当前指针、已提交者不误催）；worker 重启恢复（V20：排队运行重启后自动接管、中断在 running 的运行恢复重排且清半成品结果、成功/失败/被取代运行绝不触碰、批次中途崩溃逐个提交不丢已完成运行）；V21 越权回归（撤销/过期凭证在提交者全部路径 401、跨任务猜测主体 ID 统一 404、跨组织者下载导出作业 404）；V01-V04 发布校验加固——规则来源必须能在组织者原始输入中定位（暗加要求发布即拦截，来源跨修订轮次累积不丢；原始要求含时间/截止线索而蓝图无时间策略时给非阻塞提醒，先澄清不猜默认值）、态度类表述（认真/态度/用心/真情实感/原创性）必须标人工或需澄清不得宣称可自动鉴定、条件表达式仅支持 字段==值/!= 及 and/or 连接（不受支持的形式发布拦截且运行期判 failed 提示人工，不静默通过）、check 规格引用自洽（字段/槽位存在、kind 受支持、deterministic 必须有 check、depends_on 存在、交付命名字段存在、auto_scope 不含人工或未支持规则）；V09 条件槽位端到端（数字赛道不交照片→not_applicable 不制造待办且主摘要「规则通过（待人工验收）」、实物赛道缺照片→issue 且指明槽位、已交→satisfied、放错槽位不算数）；V10 成员一致性（申报 vs 登记逐项对照：一致→satisfied、不一致→issue 且双向差异明细、无登记名单→unknown 不猜一致、未申报→issue；同名主体只提示待核不自动合并、grants 支持登记团队成员、重发凭证告警）；V11 加密/损坏/伪装扩展名文件端到端（解析失败记技术原因并带证据、不算资格拒绝、失败文件不能再入快照、伪装按真实内容判定）；V12 模型/OCR 不可用端到端（回执仍有效、语义检查标记未完成不虚报全通过、预算耗尽留痕、恢复后重试出结论且历史留痕）；V06 期次不符端到端（差异定位准确、证据可定位、补正后转通过）；P03 复核页同名主体待核提示（只提示、不自动合并，以主体 ID 为准）；V05/V07/V08 端到端（正常 PDF 全要素逐条留证后经人工确认验收、姓名模糊导致 OCR 误识别别为 unknown——不判未填写、可申诉、申诉成立也不以姓名改动资格、一页为图片未读时不确认缺失且覆盖缺口（未读页数/提取方式）对组织者可见）；P03/P04 规则明细与覆盖缺口展示（提交者与组织者看到同一份明细：阻塞规则给出问题/下一步/原文证据，一页未读时 unknown 且提示补充清晰可读材料，不把“没读到”说成“确认缺失”）；P04 提交者申诉入口（第 10 节：解释/申请复核不改变机器结论、不替代组织者决定；空理由拒绝；幂等同键同内容返回同一记录、同键异内容 409；撤回只改状态历史保留；只读任务拒绝新解释；组织者对该规则做出决定后才标记已处理；解释与历史问题作为上下文进入下一轮语义检查但不作为结论）；全量 205 测试通过 |
| G5 外部试用 | 授权脱敏试点，记录收益与错误后再扩展 | 未开始 |

## 大模型网关与降级

- 网关：OpenAI 兼容 `/chat/completions`，默认模型 `glm-5.3`（`FORMFLOW_LLM_MODEL`）。
- **降级策略**：`FORMFLOW_LLM_FALLBACK_MODEL` 配置兜底模型（如 `step-3.7-flash`）后，主模型不可用（超时/限流/5xx）时自动用降级模型重试一次；主模型尝试时限收敛为 `min(FORMFLOW_LLM_TIMEOUT_SECONDS, 90)` 秒且不做内部重试，以尽快兜底。降级也失败则抛 `LLMUnavailable`，由上层按"检查未完成"转人工，**不影响收件**。
- 背景：glm-5.3 经当前网关单次调用约 6 分钟且延迟不稳定；推理模型的 `reasoning_content` 可能占满配额导致 `content` 为空，此时抛 `LLMError` 提示转人工，绝不把空响应当成结果。
- 每次审核有页数/OCR/调用预算（`FORMFLOW_MAX_LLM_CALLS_PER_RUN`），预算耗尽明确记录未完成项并转人工。

## 测试

- `tests/test_llm.py`：网关客户端、预算、降级异常、fallback 兜底与空内容拦截（StubLLM，无真实网络）。
- `tests/test_requirements_agent.py`：蓝图草稿生成与程序校验（重复 ID/日期顺序/依赖环/来源可定位/态度类必须人工/条件形式白名单/check 规格自洽）。
- `tests/test_v09_track_slots.py`：V09 条件槽位端到端（contest_signup：track 枚举 + photo 槽条件必交；数字队不交→not_applicable、实物队缺照片→issue 指明槽位、已交→satisfied、放错槽位不算数）。
- 	ests/test_v10_members.py：V10 成员一致性与同名主体待核提示（逐字段差异/无登记 unknown/未申报 issue/蓝图 ghost 字段定位/add_members 去重/grants 登记成员/重发告警/findings 与 decisions 同名提示）。
- `tests/test_v11_v12_faults.py`：V11/V12 故障文件与模型不可用端到端（损坏/加密/旧版 OLE2/伪装扩展名按技术原因处理且不算资格拒绝、失败文件拒绝再入快照；LLM 不可用回执仍有效且语义检查未完成、预算耗尽留痕、恢复后重试出结论旧运行留痕）。
- `tests/test_v06_term_mismatch.py`：V06 期次不符端到端（报告第 2 期 vs 登记第 1 期：差异定位准确、证据可在原文定位、补正路径可操作转 satisfied，旧版本与运行留痕）。
- `tests/test_v05_v07_v08_e2e.py`：V05/V07/V08 端到端——正常 PDF 材料约束/姓名/期次/内容要素逐条留证（证据可在原文定位）后经人工确认再验收；姓名区域模糊致 OCR 误识别别为 unknown，不判未填写、可申诉、申诉成立也不以姓名改动资格；一页为图片导致未读时不确认缺失，覆盖缺口（未读页数/提取方式）通过 API 对组织者可见。
- `tests/test_appeals.py`：提交者申诉路径（第 10 节）——解释对提交者与组织者双向可见、组织者对该规则做决定后才算已处理；校验与幂等（空理由/越权规则 422、同键同内容同一记录、同键异内容 409）；撤回只改状态且仅本人未撤回可撤、他人撤回 422；只读任务拒绝新解释 409 但历史仍可读；补正轮语义检查上下文含历史问题与提交者解释，结论仍由模型独立给出。
- `tests/test_v01_v04_publish_guard.py`：V01-V04 发布校验加固回归——来源不可定位/可定位/模板无来源三种发布情形与来源跨轮累积、态度类规则校验与发布拦截、受支持/不受支持条件形式的发布拦截与运行期 failed、check 引用不存在字段/槽位、未知 kind、deterministic 无 check、团队人数范围颠倒、交付命名与 auto_scope 悬空引用、依赖缺失规则、时间冲突不回归。
- `tests/test_draft_revision.py`：澄清轮次闭环（修订产生新版本/历史不篡改/修改影响/审计）、无变化与模型不可用不造新版本、`POST /draft/revise` 422/404/越权/happy path。
- `tests/test_parsing.py`：真实样本文件解析（文字层 PDF/扫描件 OCR/图片 OCR/DOCX/损坏/伪装/旧版），样本由 `scripts/make_samples.py` 可重复生成（另含姓名模糊样本 blur_name.pdf 与一页图片样本 partial.pdf，用于 OCR 误识与未读页场景）
- `tests/test_review_agent.py`：确定性规则 + 语义规则（quote 定位、覆盖不足→unknown、故障→failed）。
- `tests/test_submissions.py`：幂等收件、双截止、草稿冲突。
- `tests/test_decisions.py`：验收前检查、撤销、作用域。
- `tests/test_export.py`：快照固定性、CSV/ZIP 同快照、稳定 ID 命名、公式注入防护。
- `tests/test_authz.py`：会话持久化与过期、越权访问（他人任务/主体）统一 404/401；V21 越权回归（撤销/过期凭证在 /me 全路径 401、跨任务猜测主体 ID 在 checks/retry/findings/decisions 统一 404、跨组织者下载导出作业 CSV/ZIP 404）。
- `tests/test_demo_seed.py`：演示数据不变量（应交 4、张三已验收、李四待补正、王五待人工）与快照只纳入已验收。
- `tests/test_notifications.py`：催交名单重查、只标已复制（V24）。
- `tests/test_task_lifecycle.py`：任务生命周期（关闭/归档/取消规则、只读拦截、审计留痕）、API 409/404。
- `tests/test_check_retry.py`：检查重试（V20）——execute_run 异常标记 failed、重试生成新运行且旧运行 superseded、进行中/成功无失败规则/superseded 拒绝、只读任务拦截、API 200/409/404。
- `tests/test_v15_revision_regression.py`：V15 版本回归——v1 验收不带到 v2（验收回到待定）、v1 迟完成不回退当前指针、已正式提交者不在催交名单、v1 修订/运行/结果/事件仅入历史全部保留。
- `tests/test_worker_recovery.py`：V20 重启恢复——排队运行新会话自动接管、中断运行恢复重排+半成品清除+无重复结论、历史运行（成功/失败/被取代）不被触碰、批次崩溃后已完成运行保留。
- `tests/test_business_specs.py`：V16 同名新文件保留、V19 上传不算交、V22 材料注入防护与引用校验。
- `scripts/smoke_review.py`：审核链路真实冒烟（真实解析样本 + 确定性/语义规则 + 证据定位 + 预算 + V05/V06/V07/V12/预算耗尽场景；`--stub` 用本地桩不调网关）
- `scripts/smoke_llm.py`：真实网关冒烟（起草 → 澄清/修改意见修订），验证主模型与降级兜底链路；不写数据库，仅打印耗时/降级触发/程序校验/修改影响。

## 安全说明

- `.env` 已被 `.gitignore` 忽略，**绝不提交**；密钥只从环境变量读取。
- `data/`（SQLite 数据库与私有文件存储）不提交。
- 上传文件以稳定 ID 存放、原名映射保留；文件名净化防路径穿越。
- 文件内容只作为数据发送给模型，不作为指令（prompt 由程序构造）。
- 审核有页数/调用/重试预算，预算耗尽明确记录未完成项并转人工。

## 许可证

暂定，待定。
