# FormFlow 体验走查记录 · 2026-10-27

本轮基于评审意见继续收口，使用 `python scripts/start_demo.py --reset --port 8027` 启动隔离演示服务，未配置 `FORMFLOW_LLM_API_KEY`。现有工作区未提交改动全部保留，未执行提交、推送或重置。

## 2026-10-27 交付快照状态带

- 固定快照卡新增“最近固定”状态带：没有快照时直接说明需要先固定才能导出；已有快照时显示最近快照的类型、编号和时间。
- 状态带明确说明再次固定会生成新快照，旧快照和已经生成的导出包不会被覆盖或静默改写；这与页面原有的不可变快照和 ZIP README 口径一致。
- 历史记录读取失败时，状态带会给出可行动的降级说明，不再让“正在读取最近快照…”永久停留。
- `tests/frontend_contracts.test.cjs` 新增无快照和已有快照两种状态断言；前端契约 204 项、Python 全量 448 项、`node --check app/static/app.js` 与 `git diff --check` 通过。
- 隔离端口 `8098` 使用空模型密钥和虚构种子在 390px 浏览器实测：交付页显示“还没有固定快照 / 先生成一份快照，之后才能导出 CSV 和 ZIP”，`scrollWidth` 为 390，控制台错误 0，失败请求 0；验证后已执行 `python scripts/start_demo.py --stop`。

本次追加迭代使用隔离端口 `8030` 复核展示模式，并继续保持空模型密钥与虚构种子数据。展示路线的 Agent Control Plane、Live Showcase、Run Stages 与 Run Evidence Pulse 归入“查看 Skill、Harness 与运行证据”折叠区；桌面端默认展开，窄屏默认收起，快速入口会先展开再定位。启动器停止输出也改为逐项报告 API / Worker 的已停止、已退出或停止失败状态。

## 已验证

- Agent runtime 新增“合同自测”：服务端根据真实工具注册表、Skill 白名单、工具输入/结果上限、运行预算与人工接手开关计算 `contract_self_test`；任务页和设计页会显示通过项数，并明确“只验证运行合同，不调用模型”。本轮自测 5/5 通过，未读取材料正文、未产生模型调用。
- `node --test tests/frontend_contracts.test.cjs`：198 项通过。
- `python -m pytest -q`：444 项通过。
- `node --check app/static/app.js` 与 `git diff --check`：通过。
- 端口启动器：`--port 8027` 实际监听 8027，健康检查通过；启动器检查和报错使用请求端口。
- `#/roster/9999`：404 被替换为中文失败态，提供“重试加载名册”和“回到收集工作台”，导入控件被禁用，不再停在加载态。
- `#/review/1/9999`：404 被替换为中文失败态，提供重试和返回工作台，不再与“正在读取检查结果”并排显示。
- 提交者端：1440px、390px、320px 登录和表单路径无控制台异常；320px 下“重新加载服务器草稿”文本保持单行，主提交按钮独占一行且可读；390/320 均无横向溢出。
- 交付页：历史快照行只保留“查看清单与导出”，导出主操作集中在快照详情卡，避免同屏重复主按钮。
- 复核页：统计卡使用“已满足”，并在人工决定计入时显示“含人工处理 N 项”；1440px 和 390px 无横向溢出、无页面异常。
- 无效路由的网络记录仅包含预期的 404，页面无 `pageerror`；正常复核、提交者、工作台与交付路径无 4xx/5xx。
- 展示模式证据折叠：1440px 默认展开，页面 `scrollWidth` 等于 viewport；320px 默认收起时页面高度约 2422px，手动展开约 4283px；“查看 Skill 与 Harness”“查看只读账本”和运行阶段入口会自动展开并把焦点带到目标区域。
- 启动器停止状态：登记进程逐项输出“API 已停止；Worker 已停止”或“API 已退出”等明确状态，不再用笼统的“进程已退出”覆盖混合结果。
- 视觉收口：交付页顶部两张卡在桌面端使用同高网格轨道；登录页最小高度改为 `min(620px, 100vh - 80px)`，避免较矮视口被固定高度撑开；设计页 Agent 对话仍保持独立滚动与 sticky 定位，不用长预览高度拉伸左栏。
- 在隔离端口 `8028` 复跑复核（李四、赵六）、交付和工作台路径，并验证 390px 复核页：控制台错误 0、失败请求 0、横向溢出 0；服务已停止。
- 本轮隔离端口 `8030` 浏览器复核：1440px 和 320px 展示首页无横向溢出、无控制台错误、无失败请求；折叠区展开与快捷定位正常。前端契约 191 项、启动器专项 24 项通过；`node --check app/static/app.js` 与 `git diff --check` 通过。
- 启动器 `--check` 现在会分别检查演示种子、API 健康与 Agent runtime 合同、Worker `ready` 标记、MCP 只读桥可加载状态，并输出“演示就绪：是/否”；任一关键项失败时返回非零，避免展示前只确认端口却漏掉后台能力。
- MCP 无交互现场验证：隔离端口 `8042` 启动后执行 `FORMFLOW_DEMO_PASSWORD=demo1234 python scripts/demo_mcp.py --api-url http://127.0.0.1:8042 --non-interactive --task-id 1`，未读取 stdin，发现 4 个只读工具并返回任务、收集进度、下一步和 Agent runtime；密码与会话 token 未输出。指定不在组织者权限范围内的任务编号会明确失败；`choose_task_id` 保留旧的位置参数兼容性。验证后已执行 `python scripts/start_demo.py --stop`，服务已停止。

## 本轮提交者口径收口

- 材料进度卡标题改为“提交后的状态与下一步”，不再暗示所有检查结果都需要提交者处理。
- 组织者专属的待确认、人工核对和检查未完成项统一归入“组织者待办”，明确说明提交者不需要为这些项目重复提交材料；提交者可操作的补正项仍单列在“需要一起处理”。
- `port_available` 改为必须显式传入端口，避免默认参数在模块加载时固定旧端口；启动器 `--port` 回归通过。

## 本轮任务首页收口

- 在隔离端口 `8029` 使用相同虚构种子和空模型密钥验证普通组织者任务页：统计卡与任务列表位于标题之后、展示路线之前；1440/390/320px 的任务列表首屏位置约为 `y=364/486/486`，页面 `scrollWidth` 与 viewport 一致。
- 展示视图仍隐藏任务列表和统计卡，保留当前任务、当前站入口与 Agent/MCP 证据；“查看我的任务”可以退出展示视图并回到任务列表。三档视口均无横向溢出。
- `scripts/ux_walkthrough.cjs` 走查登录、展示入口、工作台、设计、名册、复核、交付和 390px 登录：无控制台错误；请求无 4xx/5xx。`node --test tests/frontend_contracts.test.cjs` 191 项、`node --check app/static/app.js`、`git diff --check` 均通过。
- `scripts/ux_walkthrough_2026-10-25.cjs` 的缺失主体固定断言仍使用旧文案，因而不能作为本轮结果依据；产品页面的缺失主体走查由现有前端契约和专项脚本覆盖。服务已停止。

## 仍未覆盖

真实模型调用、真实评委试讲、真实 MCP sidecar 互操作、屏幕阅读器用户测试、生产鉴权与部署安全仍不在本轮范围内。演示数据为虚构种子，服务已在走查完成后停止。

## 2026-10-27 复核页行动入口

- 主体摘要首屏新增“下一步”状态带：按待人工核对、可验收和验收前置条件三种状态给出明确动作，并可直接跳转到对应区域；桌面端复核步骤导航在长页面滚动时保持可见，窄屏自动恢复普通流式布局。
- 隔离端口 `8044` 浏览器复核覆盖李四、赵六复核页、交付页、工作台和 390px 复核页：控制台错误 0、失败请求 0、横向溢出 0；截图确认行动入口位于复核摘要首屏。前端契约 `193` 项通过；`node --check app/static/app.js` 与 `git diff --check` 通过。验证后已执行 `python scripts/start_demo.py --stop`，服务已停止。

## 2026-10-27 失败后人工接手

- 复核运行失败现在由服务端投影为四类脱敏原因：预算用完、材料读取失败、模型服务不可用、其他运行失败。前端只显示中文原因、影响和下一步，不把异常原文、网关地址或内部错误串带到展示页。
- `review_signal.failure` 与复核详情 `run.failure` 同时提供结构化 `code/title/detail/action`；无运行或成功运行明确返回 `failure: null`，旧接口数据缺少该字段时前端仍按正常状态渲染。
- 单元测试覆盖模型不可用和预算耗尽分类，并断言异常原文不会泄露；`python -m pytest -q`：`444 passed`；`node --test tests/frontend_contracts.test.cjs`：`193 passed`；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 隔离端口 `8045` 先用干净虚构种子验证正常复核路径，再临时将李四的运行标为模型不可用：1440px 与 320px 展示首页展开“最近复核运行”后均显示“语义审核服务暂时不可用”“配置或恢复模型服务后重试，也可以由组织者人工核对”；复核页显示失败接手信息。两档视口均无横向溢出、控制台错误、页面异常或失败请求，且页面不出现 `gateway unavailable` 原文。
- 验证完成后已用 `--reset` 恢复干净种子，确认 3 个演示运行均为成功状态，并执行 `python scripts/start_demo.py --stop`；服务已停止。

## 2026-10-27 失败卡恢复动作可见性复核

- 隔离端口 `8047` 使用空 `FORMFLOW_LLM_API_KEY` 和虚构种子，将李四的历史运行临时置为模型服务不可用后，复核 `#/review/1/2` 的失败态。
- 1440px、390px、320px 三档视口下，失败运行卡均默认展开；“重新排队检查”和“进入人工复核”两个动作均可见，且不会被折叠区隐藏。
- 三档视口的 `scrollWidth` 分别为 `1440/390/320`，均与视口宽度一致；控制台错误 0、失败请求 0；页面不再显示“正在读取检查结果…”或 `gateway unavailable` 原文，只显示脱敏中文原因“语义审核服务暂时不可用”及人工接手建议。
- `python -m pytest -q`：`444 passed`；`node --test tests/frontend_contracts.test.cjs`：`194 passed`；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 复核后需用 `--reset` 恢复干净演示种子，并执行 `python scripts/start_demo.py --stop`，不保留临时失败运行。

## 2026-10-27 需求设计阶段摘要

- 需求设计页左栏新增 `CURRENT RUN` 阶段摘要，把“描述需求 / 核对与澄清 / 确认发布”与当前蓝图、待澄清项、阻塞项、离线状态和发布状态放在 Agent 对话下方；发布后会改为显示版本冻结提示。
- 摘要复用现有前端状态，不增加后端接口或新的操作路径；草案加载、输入暂存、Agent 请求忙碌态和发布状态变化都会触发刷新。
- 隔离端口 `8053` 浏览器复核：1440px 与 390px 均显示三步摘要，页面 `scrollWidth` 与 viewport 分别为 `1440/1440`、`390/390`；控制台错误 0、失败请求 0。截图为 `.tmp-design-progress-1440.png` 与 `.tmp-design-progress-390.png`。
- `node --test tests/frontend_contracts.test.cjs`：197 项通过；`node --check app/static/app.js`：通过。服务复核后执行 `python scripts/start_demo.py --stop`。

## 2026-10-27 最终闭环回归

- 隔离端口 `8061` 使用干净虚构种子和空 `FORMFLOW_LLM_API_KEY` 启动；`python scripts/start_demo.py --check --port 8061` 报告演示数据库、API、Worker、Agent runtime 合同和 MCP 只读桥均就绪，随后已执行 `python scripts/start_demo.py --stop`。
- 启动器、名单失败态、复核失败态和提交者待办口径均通过专项契约；当前全量结果为 `python -m pytest -q`：`444 passed`，`node --test tests/frontend_contracts.test.cjs`：`198 passed`，启动器/MCP/名单专项：`47 passed`，并通过 `node --check app/static/app.js` 与 `git diff --check`。
- 真实浏览器复核覆盖组织者主路线（登录、展示入口、设计、工作台、名单、复核、交付、390px 登录）、复核 3 个主体及缺失主体编号、提交者 8 步流程、错误凭证/错误密码/不存在任务路径；页面错误 0，关键路径无失败请求，提交者 390px 文档宽度等于视口宽度。
- 复核与提交者产物分别写入 `.tmp-round-final-review/`、`.tmp-round-final-submitter/`、`.tmp-round-final-organizer/`。本轮未执行提交、推送、合并或远程拉取。

## 2026-10-27 MCP 协议级就绪检查收口

- `scripts/start_demo.py` 的 `mcp_bridge_status()` 不再只做 Python import 检查；它会在 3 秒边界内启动真实 `python -m app.mcp_server` stdio 子进程，通过 MCP `list_tools()` 完成握手，校验四个组织者工具名称和 `readOnlyHint` 标记。探测使用 `http://127.0.0.1:1` 与临时 token，只做协议发现，不调用业务 API。
- 专项测试 `python -m pytest -q tests/test_start_demo.py tests/test_mcp_server.py tests/test_demo_mcp_script.py`：42 项通过；全量 `python -m pytest -q`：444 项通过；`node --test tests/frontend_contracts.test.cjs`：198 项通过；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 隔离端口 `8062` 实测 `--reset` 启动、`--check --port 8062` 和 `FORMFLOW_DEMO_PASSWORD=demo1234 python scripts/demo_mcp.py --api-url http://127.0.0.1:8062 --non-interactive --task-id 1`：发现并调用四个只读工具，返回任务列表、聚合收集进度、下一步和 Agent runtime；密码与会话 token 未输出。随后执行 `python scripts/start_demo.py --stop`，`8062` 已停止监听。
- 当前验证仍使用虚构种子和空模型密钥；本轮没有验证真实模型质量、真实外部 MCP sidecar 互操作、屏幕阅读器、生产部署或远程 Git 状态。

## 2026-10-27 评审问题现场复核

- 隔离端口 `8063` 使用 `python scripts/start_demo.py --reset --port 8063` 启动；`--check --port 8063` 返回演示数据库、API、Worker、Agent runtime 合同和 MCP 只读桥均就绪，服务随后已停止，端口不再监听。
- 正常复核路由 `#/review/1/1`、`#/review/1/2`、`#/review/1/3` 均完成渲染；浏览器 `pageerror` 为 0，正常路径无失败请求。
- 无效路由 `#/roster/9999` 和 `#/review/1/9999` 的接口仍返回预期 `404`，但页面不再保留“正在读取”占位；两者均显示中文失败说明、重试和回到工作台入口，名单页导入控件同时被禁用。
- 该轮浏览器检查记录的网络错误仅为上述两个预期 `404`，没有额外控制台错误；截图和临时产物写入 `.tmp-ux-round-next-20261027/`。
- 本轮未执行提交、推送、合并或远程拉取；仍使用虚构种子和空 `FORMFLOW_LLM_API_KEY`，不据此宣称真实模型质量已验证。

## 2026-10-27 合同自测展开回归

- 任务页、需求设计页和展示导览均复用服务端 `contract_self_test.checks`，新增默认收起的“查看 N 项合同检查”明细；展开后逐项显示通过状态、检查标签和服务端 detail，并保留“只验证运行合同，不调用模型”的边界说明。
- `node --test tests/frontend_contracts.test.cjs`：199 项通过；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 隔离端口 `8064` 真实浏览器复核：任务页与设计页均显示 5 项检查，默认收起；展开后 5 项逐条可读。320px 下任务页与设计页 `scrollWidth` 均等于视口宽度，未出现横向溢出。
- 服务端已停止；本轮仍使用虚构种子和空 `FORMFLOW_LLM_API_KEY`，合同自测只证明运行边界配置，不代表模型准确率或真实外部 MCP 互操作。

## 2026-10-27 离线 Agent 脚本回放闭环

- 演示任务的复核页新增“回放离线检查”入口。回放严格限制为 `demo` 账号、演示任务创建者和固定演示任务名；普通任务访问接口返回 404，不会把脚本桩伪装成真实模型。
- 回放复用正式检查 Worker、Skill、工具白名单、Harness 预算、人工接手和审计链，只在 Worker 内注入确定性的 `ScriptedLLM`；`check_runs.execution_mode` 持久化为 `offline_replay`，重试会继承原模式，tool trace 标记 `simulation=true`。
- 复核结果明确标注“离线脚本回放 · 不调用外部模型”，并说明结果用于展示 Agent、Skill、Harness 与人工接手边界，不代表真实模型质量；`unknown` / `failed` 仍交给组织者人工处理。
- 专项回归 `python -m pytest -q tests/test_offline_replay.py tests/test_demo_seed.py tests/test_worker_recovery.py`：12 项通过；前端契约 `node --test tests/frontend_contracts.test.cjs`：200 项通过；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 隔离端口 `8065` 真实浏览器点击回放：接受确认后由 Worker 生成 `offline_replay` 成功运行，复核页显示“离线脚本回放 · 不调用外部模型”；接口返回的 5 项 `tool_trace` 全部带 `simulation=true`。390px 下 `scrollWidth=390`、`innerWidth=390`，控制台错误 0、失败请求 0；随后已停止演示服务。
- 当前验证仍不覆盖真实模型质量、真实外部 MCP sidecar、屏幕阅读器、生产部署或远程 Git 状态。

## 2026-10-27 离线需求 Agent 持久化回归

- 需求设计页的“回放离线起草”沿正式持久队列、草案保存和发布前校验执行；结果明确标记 `offline_replay`、`simulation=true` 和“离线脚本回放 · 不调用外部模型”，生成的是 `draft`，不会自动发布。
- 修复队列结果持久化时直接序列化 Pydantic 枚举导致的 `TypeError`：统一使用 JSON 模式导出草案结果，避免离线回放被错误标成失败。
- 新增回归覆盖：演示任务离线需求回放完成且保持草案、重复请求仍由同一持久记录承接、普通任务/非起草 `revise` 不得使用离线模式；专项 `tests/test_offline_replay.py`、`tests/test_agent_requests.py`、`tests/test_start_demo.py` 共 36 项通过，全量 `python -m pytest -q` 为 448 项通过，前端契约 200 项通过。
- 本轮仍未执行提交、推送或远程拉取；当前验证使用虚构种子和空 `FORMFLOW_LLM_API_KEY`，不据此宣称真实模型质量已验证。

## 2026-10-27 离线需求回放后的发布门状态

- 修复需求设计页 `CURRENT RUN` 把已发布基线误当成当前版本已发布的问题：历史 `designPublished` 仍用于版本差异对照，但当前发布状态只由当前草案的 `status` 决定。
- 隔离端口 `8071` 重新打开已有离线回放生成的 v2 草案后，页面显示“等待确认”，第三阶段显示“组织者确认后才会生效”，底部操作仍为“核对并发布”；历史 v1 继续作为差异基线展示。
- 前端契约 `node --test tests/frontend_contracts.test.cjs`：201 项通过；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 本次只验证离线脚本回放的状态边界，不据此宣称真实模型质量、真实外部 MCP sidecar、屏幕阅读器或生产部署已覆盖。

## 2026-10-27 首屏运行边界回归

- 隔离端口 `8091` 使用空 `FORMFLOW_LLM_API_KEY` 和虚构种子登录展示模式；1440、390、320px 三个视口的 `FIRST LOOK` 均显示 `5/5 合同通过` 与“离线演示 · 不调用实时模型”，没有把离线脚本回放表述成模型质量。
- 三个视口的 `scrollWidth` 分别等于 `1440/390/320`，控制台错误为 0，失败请求为 0；页面首屏仍保留当前任务、当前站和下一步入口。
- 静态资源版本更新为 `20261027-1`，避免展示模式继续使用旧缓存的 `app.js`。
- 本轮验证后已停止隔离演示服务；仍未覆盖真实模型质量、真实外部 MCP sidecar、屏幕阅读器、生产安全或远程 Git 状态。

## 2026-10-27 交付包边界说明

- 导出的 ZIP 新增 UTF-8 `README.txt`，与 `manifest.json`、`original_names.json` 和材料原件一起来自同一份不可变快照。
- 说明文件直接写出任务与蓝图版本、任务时区、固定时间、纳入/排除数量，并明确 CSV 的时间口径、快照后的新提交不会静默改包，以及资格、检查和最终验收的边界。
- `tests/test_export.py` 导出专项 9 项通过；全量 `python -m pytest -q`：448 项通过；前端契约：202 项通过；`node --check app/static/app.js` 与 `git diff --check`：通过。
- 该增强只增加交付包内的可读说明，不改变快照纳入条件、原件 SHA-256 校验、CSV 字段或失败时不生成下载路径的行为。

## 2026-10-27 交付包 Agent 证据

- ZIP 新增 `agent_evidence.json`，按快照中每个主体的 `revision_id` 匹配最近一次未取代检查运行；不会把快照固定后的新运行混入旧包。
- 文件只包含运行状态、`execution_mode`、页数/语义调用预算、覆盖缺口汇总、规则结果计数和工具调用的名称、版本、序号、状态、耗时与 correlation id。
- 工具参数、工具结果、材料正文、提示词和隐藏推理均不写入交付包；README 同步说明该文件的用途和隐私边界。
- `tests/test_export.py`：9 项通过；测试还验证审计事件中的参数和结果不会出现在证据文件中。当前改动未改变快照纳入条件、原件校验或 CSV 字段。

## 2026-10-27 交付页 Agent 证据摘要

- 快照创建接口和历史快照详情接口现在同时返回脱敏 `agent_evidence`；交付页直接展示按快照版本绑定的运行数量、离线/实时来源、规则结论计数和工具步骤数。
- 运行失败、仍在排队/执行、或没有可绑定检查运行的主体会明确进入“仍需要人工接手”状态；完成运行仍保留“人工发布门仍然有效”提示。页面不展示材料正文、提示词、工具参数或隐藏推理，完整结构化数据继续通过 ZIP 的 `agent_evidence.json` 提供。
- `tests/test_authz.py`、`tests/test_export.py` 与前端契约覆盖接口授权、隐私边界、历史快照重开和失败接手文案；当前专项 API/导出回归 22 项通过，前端契约 203 项通过。
- 隔离端口 `8097` 使用虚构种子和空 `FORMFLOW_LLM_API_KEY` 实测新建/打开预览快照：1440/390/320px 均显示证据摘要，`scrollWidth` 分别等于 `1440/390/320`，控制台错误 0、失败请求 0；验证后已停止演示服务。
- 本轮仍未覆盖真实模型质量、真实外部 MCP sidecar、屏幕阅读器或生产部署；未执行远程拉取、提交或推送。
