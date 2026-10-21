# 复核页范围隔离与交互验收记录

更新：2026-10-21。本文记录复核范围与复核页实现的自动化验证和隔离浏览器试走，不代表真实业务库、真实材料或公网部署已经验收。后续已补充工作台下一步建议及 Agent 分工卡的真实浏览器走查截图；Agent harness 自动化测试在下方新进展小节追加。

## 验收目标

本轮围绕三个问题验收：

1. 刷新复核页后，规则理由、资格依据和验收依据是否仍在正确位置。
2. 切换主体、正式版本、登记成员或检查运行后，旧理由是否会被误用。
3. 长复核页是否能让组织者按材料、资格、验收的顺序找到下一步，并在窄屏使用。

## 复核范围不变量

后端为每个复核页面计算不透明的 `review_context`。它包含账号、任务、主体 ID 与身份字段、当前发布蓝图、当前正式修订、最新未取代检查运行，以及按 ID 排序的登记成员 ID、姓名和附加信息。它只用于绑定当前复核范围，不把资格提交状态本身放进范围，避免资格提交后同一范围的未提交理由失效。

公开人工决定请求必须携带页面看到的 `expected_review_context`，并同时携带当前正式修订和资格决定所需的成员哈希。写入前在数据库写锁内重新读取并核对范围。主体、版本、成员或检查运行变化时返回 409，决定不落库；缺少范围时返回 422。前端保留旧范围理由，但新范围不会自动恢复它。

## 自动化验证

```bash
.venv/bin/python -m pytest -q --disable-warnings
/Users/xjx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test tests/frontend_contracts.test.cjs
/Users/xjx/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check app/static/app.js
git diff --check
```

本轮复核基线结果为 311 项 Python 测试和 64 项 Node 前端契约测试通过。此后补入 4 项工作台/Agent UI 契约，之后又新增 10 项受限 Agent tool/skill/harness 运行时及接线测试和 2 项提交者友好文案契约；最新完整 `pytest` 结果为 321 项 Python 通过，Node 前端契约 71 项通过。前端契约测试使用 Node VM、Mock DOM 和 Mock fetch；浏览器视口试走见本页补充记录。离线 `smoke_review.py --stub` 未调用真实模型网关。

覆盖的关键情形包括：

- 三类理由刷新恢复，且空理由不会把旧内容重新写回页面。
- 不同主体、账号和复核范围不会串用理由；缓存中伪造规则 ID 或决定类型不会被信任。
- 缓存 JSON 损坏、过期、存储不可用时的提示和内存兜底。
- 成功提交只清理实际发送的规则 / 资格 / 验收依据；晚响应不能清掉同范围的新输入。
- 主体改名、成员新增 / 删除 / 改名 / 附加信息变化、正式蓝图、正式修订和检查运行变化都会使旧范围失效。
- 缺少 `expected_review_context` 的公开请求被拒绝；过期范围返回冲突且没有新增人工决定。
- 材料、资格、验收导航、下一待处理和无规则复核页的禁用入口。

## 隔离浏览器试走

试走使用独立的 8016 服务和临时 SQLite / 存储目录：

- 数据库：`/tmp/formflow-review-20261021/demo.db`
- 存储：`/tmp/formflow-review-20261021/storage`
- 账号：虚构演示账号 `demo/demo1234`
- 模型密钥为空；未调用真实 LLM，也没有操作原 8010 业务服务或业务数据库。

实际完成：

- 王五复核页填写规则理由、资格依据和验收依据，刷新后三类内容均恢复。
- 使用“下一待处理”跳转到验收区时保留已有输入；切回原规则后规则理由仍在。
- 从王五切到李四再切回，旧理由按范围恢复，李四不会看到王五的理由。
- 390×844 和 320×740 窄屏检查 `documentElement.scrollWidth === clientWidth`，没有整页横向溢出。
- 03 验收快捷入口会定位到 `review-acceptance`；前置待办存在时按钮保持禁用。
- 将演示主体改成团队并新增登记成员后，旧个人范围理由不恢复；在旧页面提交得到 409，数据库人工决定数量保持 0。
- 在当前团队范围中新增三类理由，再创建正式 v2 并生成新检查运行；刷新后 v2 页面不恢复 v1 的理由，且页面显示当前成员与正式 v2。

对应截图均使用虚构演示材料：

- [桌面复核页](review-desktop.png)：默认 1280×720 视口。
- [理由刷新恢复](reasons-restored.png)：规则、资格和验收三类依据均恢复。
- [390px 复核页](review-mobile.png)：窄屏布局。
- [成员变化冲突](member-conflict-mobile.png)：旧范围提交被阻止并提示重新核对。

## 2026-10-21 追加：下一步建议、Agent 分工卡与工具运行时

### 桌面 / 手机浏览器走查

使用独立数据库 `/tmp/formflow-work-20261021/formflow.db`、私有附件目录 `/tmp/formflow-work-20261021/storage` 和本机 `127.0.0.1:8162`。虚构演示账号 `demo`，没有接入原有 8010 服务、真实业务库或真实模型。

- 工作台下一步卡展示“先看看李四的材料”，说明有 1 项问题尚未处理，入口直达对应复核范围。
- 复核分工卡展示 1 份材料/1 页、程序核验 3 项、语义规则 2 项/预算使用 2、人工规则 1 项，且明确不自动发布/验收。该数据是演示种子的预生成 stub 结果，不代表模型现场调用。
- 桌面 1440px、手机 390×844 实际检查；手机 documentElement.clientWidth 与 scrollWidth 均为 **390px**。卡片在手机端按单列纵向展开，不发生整页横向溢出。
- 浏览器 errors 与 console 输出均为空。

截图：

- [工作台下一步建议 · 1440px](workbench-next-step-desktop.png)
- [工作台下一步建议 · 390px](workbench-next-step-mobile.png)
- [Agent 分工说明 · 1440px](agent-run-desktop.png)
- [Agent 分工说明 · 390px](agent-run-mobile.png)

### 提交者结果文案的人性化走查

继续使用隔离虚构数据服务 `127.0.0.1:8164` 与临时数据库 `/tmp/formflow-human-20261021/demo.db`，登录虚构提交者李四，只查看预置的演示检查记录。将页面解释改为不责备的日常语言：问题只针对当前要求；证据不足不等于缺失；技术检查未完成不等于不合格；人工项由组织者处理；隐藏内部规则 ID 和 `llm/program` 字样；已满足规则不附加模型生成的“继续提交其他材料”建议。顶部待办改成按人可理解的数量摘要，解释入口允许用规则标题定位。

桌面 / 390×844 手机两种视口检查；手机整页 `clientWidth === scrollWidth === 390`，console/errors 为空。

- [提交者核对说明 · 1440px](submitter-human-results-desktop.png)
- [提交者核对说明 · 390px](submitter-human-results-mobile.png)

### 真实模型接入冒烟

网关 base URL、模型名与 API key 由用户提供。`.env` 在本机按示例配置并由 `.gitignore` 排除；没有把凭证纳入提交或文档。最小 API ping 成功。随后用一条虚构的“活动日期”规则通过现有 `run_semantic_rule` 做真实调用：模型结论为 `satisfied`，其引用内容经本地精确核验后保留，`next_step` 为“这一项已核对完成”。该单例只验证端到端可连及引用门槛，不是质量评估。

对较长的完整需求 Agent 蓝图起草请求（仅合成的活动说明）曾遇一次 HTTP 读超时、一次上游断开；应用保留草案并返回清晰暂不可用提示，没有将失败伪装成成功。尚需核对网关对长响应/超时的支持，再决定是否使用降级模型。真实材料未发送给网关。

### Agent 工具运行时的本轮增量

`app/agent_tools.py` 建立显式工具 registry、Pydantic 输入/输出、scope 授权、调用/成本预算、单次执行幂等回放、幂等键 payload 冲突保护、参数/结果大小限制、协作 deadline、fail-closed 错误码，以及不记录原始数据的 `AuditEvent`。`app/agents/tooling.py` 定义 `review_one_submission` skill；`app/services/checks.py` 已将当前逐规则审核接入该 harness。模型不能选择任意路径、SQL、网络动作或蓝图外规则。

本次测试覆盖 scope/schema、预算、错误隔离、最大输出、idempotency 防重复副作用、replay 时重新校验授权、审计脱敏、skill 工具和步数上限及真实 review Agent 接线。幂等缓存当前仅为单次运行内存态；deadline 是协作式而非 Python 强制取消。MCP 暂未接入：项目仍是单体内本地规则与审核能力，尚无跨应用互操作需求。

## 未覆盖范围

本轮没有完成全站逐页键盘 / 读屏验收、断网和弱网体验、200% 缩放、真实用户试走、真实材料模型质量评估、恶意文件扫描、公网鉴权限流、备份恢复演练和隐私留存政策审查。旧有 SQLAlchemy 外键环、datetime 和 TestClient 弃用警告仍存在。上述事项进入产品路线，不把本轮演示当作生产就绪证明。
