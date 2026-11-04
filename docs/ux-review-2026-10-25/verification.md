# 2026-10-25 展示入口复核

## 环境与范围

- 服务：`http://127.0.0.1:8000`，GET 返回 200；使用当前本地演示状态，不执行重置种子，不覆盖旧走查资料。
- 组织者：登录页及任务、设计、名册、工作台、复核、交付六条路由。
- 提交者：390px 下切换到提交凭证入口；本轮没有使用或读取一次性凭证，没有重新提交材料。
- 视口：登录页 1440 / 390 / 320px；组织者六条路由 1440px；任务、设计、工作台、复核 390 / 320px。
- 脚本：`node scripts/ux_walkthrough_2026-10-25.cjs`。截图和尺寸、请求、控制台结果保存在本目录。

## 结果

所有被测页面 `documentElement.scrollWidth` 等于 `clientWidth`；控制台错误、页面异常、4xx/5xx 请求均为 0。截图目视检查未发现新的首屏遮挡、文字裁切或明显的信息层级问题。本轮是现有演示状态的只读走查，不证明真实模型输出质量，也不替代使用授权脱敏材料的试点。

对 2026-10-23 记录的七项问题做了代码复核，当前实现均有对应处理：

1. 缺失提交者编号先进入中文空态；框架参数校验话术单独翻译，业务报错保留。
2. 未配置模型密钥由服务端明确返回；前端提示模板/手动编辑及配置后重发，不展示必然失败的重试按钮，也不重复堆叠提示。
3. favicon 使用 `index.html` 内联 SVG。
4. 登录功能图标使用全站 SVG 图标集。
5. `fmtTimeShort` 避免每条日期重复显示时区。
6. 提交回执使用“提交时间”。
7. CSV 导出按任务时区格式化收件时间；非法时区退回 UTC 并保留导出。

## 自动回归

- Python：361 passed。
- 前端契约：129 passed。
- `node --check app/static/app.js`、走查脚本语法检查及 `git diff --check` 通过。

## 截图索引

- `login-desktop.png`、`login-mobile.png`、`login-320.png`
- `tasks-desktop.png`、`design-desktop.png`、`roster-desktop.png`、`workbench-desktop.png`、`review-desktop.png`、`delivery-desktop.png`
- `tasks-390.png`、`tasks-320.png`、`design-390.png`、`design-320.png`、`workbench-390.png`、`workbench-320.png`、`review-390.png`、`review-320.png`
- `submitter-entry-390.png`

下一轮建议先用获准的脱敏材料定义并运行审核 Agent 评估：逐规则引用定位、误报/漏报、注入样本、人工修正成本和预算耗尽行为；完成指标与人工接手审查后，再据结果决定是否调整 skill 或展示信息。公网安全、备份恢复与真实试点仍是独立上线门槛。

### 提交者完整闭环与测试资源告警

- 在独立 SQLite 种子库和 `127.0.0.1:8001` 上使用赵六的一次性演示凭证，完整执行凭证登录、填写字段、上传材料、保存服务器草稿、正式提交并查看 v1 回执。上传、草稿和提交均为 HTTP 200。
- 390px 回执页 `scrollWidth` 与视口宽度均为 390；控制台错误、页面异常和 4xx/5xx 请求均为 0。截图与脱敏结果 JSON 留存在 `docs/ux-review-2026-10-25/submitter-full/formal-20261025/`。
- 全量 Python 回归此前通过 368 项，但发现导出测试有两条未关闭 CSV 文件的 `ResourceWarning`。改为上下文管理器后，以 warnings-as-errors 重跑，确认无警告。

## 展示入口细节迭代

任务路线下方的 Agent runtime 原先默认完整展示五张架构卡片，拉长首页并分散当前流程焦点。现改为默认收起的原生折叠区：标题保留离线/接入状态和「助手负责整理与取证，关键决定留给人」；展开后可查看 Skill、工具白名单、Harness 预算、MCP 边界和人工决定职责。

- 桌面 1440px：折叠高度 108px，展开高度 264px。
- 窄屏 390px：折叠高度 148px；320px：折叠高度 173px。三个视口均无横向溢出。
- 浏览器控制台错误为 0；前端契约 129 项、Python 365 项通过。
- 截图：tasks-runtime-collapsed.png、tasks-runtime-expanded.png、tasks-runtime-320.png。

### 普通工作模式字号复核

对任务首页默认工作模式下展开后的 Agent runtime 说明做可读性调整：说明文字由 10px 提至 12px，标题由 11px 提至 13px，工具标识由 9px 提至 10px。桌面保持五列，390px 使用两列，320px 收为单列；本轮实测均无整页横向溢出，未观察到卡片文字重叠。

- 浏览器：1440 / 390 / 320px；控制台错误及 4xx/5xx 请求为 0。
- 截图：`tasks-runtime-readable-desktop.png`、`tasks-runtime-readable-390.png`、`tasks-runtime-readable-320.png`。
- 本轮改动后自动回归：前端契约 129 项通过；`git diff --check` 通过。该 CSS 调整未重跑 Python 回归。

### 窄屏工具标识复核

检查 390px 双列卡片时发现，长工具名虽然没有造成整页溢出，却被横向滚动容器截成半个标识。窄屏现在按工具命名空间分隔符提供自然断行点，代码标识使用 9px；桌面维持原字号和单行布局。目视确认 390px 工具名完整显示，320px 单列内容紧凑，三个视口均没有页面横向溢出。

- 浏览器：1440 / 390 / 320px；runtime 代码标识均无内部横向滚动，控制台错误为 0。
- 局部截图：`tasks-runtime-wrap-final-1440.png`、`tasks-runtime-wrap-final-390.png`、`tasks-runtime-wrap-final-320.png`。
- JavaScript 语法检查、前端契约与 `git diff --check` 在本轮修正后通过；未重跑 Python 回归。

### 展示模式信息密度复核

演示入口此前会同时展开复核运行摘要、完整运行过程和工具回放。默认展示虽完整，但会把路线页拉长；路线已显示当前步骤和运行状态，全部过程更适合观众主动查看。现在展示模式只自动展开 Agent 工作导览，运行摘要保持收起；查看运行详情后，工具回放仍是独立的第二层展开。

- 浏览器：1440 / 390 / 320px；页面高度分别为 1514 / 2612 / 2783px，均无横向溢出；默认复核运行摘要收起、Agent 导览展开。
- 1440px 默认路线高度从约 1237px 降至 740px；页面总高从约 2012px 降至 1514px。数字来自同一演示环境前后浏览器测量。
- 手动展开运行摘要及工具回放后，5 条工具轨迹可见；展开过程没有横向溢出。控制台错误和 4xx/5xx 请求均为 0。
- 自动回归：前端契约 129 项通过；`node --check app/static/app.js` 与 `git diff --check` 通过。本轮 UI 默认状态调整未重跑 Python 测试。
- 截图：`showcase-density-1440.png`、`showcase-density-390.png`、`showcase-density-expanded.png`、`showcase-density-trace.png`。

### 展示路线文字对比度复核

展示首页里路线序号、工具轨迹序号和步骤状态使用了偏浅的小字号文字，实测对比度约为 2.3:1 至 4.1:1。将序号、状态、角色提示、流程来源和路线脚注调深，保留状态色的紫绿区分；未开放步骤不再整体降透明度，改以虚线边框和浅底表达。逐个可见文字节点按实际背景色复测，并临时模拟一个未开放步骤后，低于 4.5:1 的项为 0。

- 浏览器：1440 / 390 / 320px；三种宽度均无横向溢出。
- 截图：`demo-route-contrast-1440.png`、`demo-route-contrast-390.png`、`demo-route-contrast-320.png`。

### MCP 本机服务实连

2026-10-25 在 `127.0.0.1:8000` 使用演示组织者账号运行 `python scripts/demo_mcp.py`。脚本登录后启动独立 stdio sidecar，成功发现并调用 `list_my_tasks`、`get_task_next_step` 和 `get_task_agent_runtime`；返回任务路线、`review_one_submission` / `requirements_draft` Skill、审核工具白名单、Harness 上限（128 步 / 5 次调用）和 3 项人工控制点。会话 token 未打印；工具结果未包含名单、材料正文、prompt 或审核结果。API 健康检查和演示库只读检查均正常，未重置或修改演示数据。

这是当前本机 API 与 sidecar 的实连证据；它不表示网页内 Agent 已连接 MCP，也不证明模型审核质量或 GitHub Actions runner 已运行。

## 2026-10-25 提交者凭证失效回退

复核 2026-10-23 的七项问题后，当前实现均有对应处理；此前走查记录的浏览器实测仍是原始验证证据，本轮以代码路径和自动回归确认这些实现没有被后续修改覆盖。

另发现提交者凭证撤销或过期时，提交页虽会清除本地凭证并返回提交者登录页，却没有说明回退原因。现在登录路由只接受固定的 `credential-expired` 提示码，并展示“凭证已失效，请联系组织者重新发放”，不直接渲染 URL 参数；自动化契约覆盖 401 清除凭证、保留提交者页签和展示提示的完整路径。

- 前端契约：131 passed。
- Python：382 passed。
- `python scripts/start_demo.py --check` 只读检查通过，保留现有演示库；390px Chromium 实测无效 token 只请求 `/api/me` 一次，随后清除 token、保留提交者页签并显示提示，页面无横向溢出。该无效 token 请求预期返回 401，因此 Chromium 会记录一条资源状态提示；没有 JS 控制台异常或页面异常。
- 本轮未重跑完整双角色浏览器走查，也未使用数据库中真实撤销的凭证单独验证。

## 2026-10-25 登录 Agent 流程可读性

首次入口的 Agent 流程卡在 320px 下说明文字和责任边界脚注偏小。将步骤辅助说明统一为 12px、步骤编号为 11px、脚注为 11px，并提高行距；不改变登录字段、流程含义或功能行为。

- Chromium 实测 1440/390/320px，页面宽度分别与视口一致；步骤说明 12px、脚注 11px，控制台错误和页面异常为 0。
- 320px 流程卡高度为 452px；长文本自然折行，卡片未遮挡登录区。该宽度下完整页面高度为 1436px。
- 自动回归：前端契约 131 passed；Python 382 passed（`ResourceWarning` 视为错误）；JS 语法检查及 `git diff --check` 通过。
- 截图：`login-flow-readable-1440.png`、`login-flow-readable-390.png`、`login-flow-readable-320.png`。

这次验证覆盖排版与页面溢出，不代表目标用户理解速度已经通过试点验证。


## 2026-10-25 隔离种子双角色复走

为避免触碰已有演示数据，本轮使用新的临时 SQLite 库与 `127.0.0.1:8001`，由 `scripts/seed_demo.py` 生成虚构种子；`FORMFLOW_LLM_API_KEY` 为空，API 与 Worker 均使用同一隔离配置。完整截图和 JSON 结果写入本目录的 `round-2-clean-seed/`。

- 组织者：登录后依次走任务、设计、名单、工作台、复核、交付路由；覆盖 1440/390/320px，共 19 个路由/视口样本。直接访问 `#/review/1` 显示“先选一位提交者”。横向溢出 0、控制台错误 0、页面异常 0、4xx/5xx 0。
- 提交者：使用赵六未提交主体的凭证，完成凭证登录、填写、上传、保存草稿、正式提交 v1 和回执；上传/草稿/提交均 HTTP 200，390px 页面无横向溢出，控制台错误、页面异常与 4xx/5xx 均为 0。
- 首次误用张三凭证时上传返回 422。种子中的张三已有正式提交，而脚本编辑的是赵六，凭证与主体不匹配；以赵六凭证重测后完整流程通过。这是走查主体选择错误，不是产品缺陷。提交者脚本现支持 `FORMFLOW_WALKTHROUGH_SUBJECT` 配置主体，并在接口失败时带出响应正文，方便定位类似的测试配置错误。
- 前端契约 131 项通过；两个走查脚本 `node --check` 通过；`git diff --check` 通过。本轮未重跑 Python 回归，因为产品 Python 代码未改动。

这轮确认 10 月 23 日七项处理在浏览器流程里仍有效，并补足此前缺少的完整提交者正式提交实测。它不替代授权脱敏材料上的 Agent 质量评估、真实用户试点、备份恢复演练、公网安全验收或 GitHub Actions runner 实际结果。

## 2026-10-25 MCP 异常响应边界

只读 MCP sidecar 现在会在投影字段前检查 API JSON 根对象，以及任务列表、流程站点、Agent runtime 和 MCP adapters 的结构。HTTP 200 但返回非 JSON 或错误结构时，工具返回明确的上游响应类型错误，不透传响应正文或字段异常；原有只读字段白名单和授权行为不变。

- Python 定向回归：MCP、MCP 演示脚本、Agent runtime 与 Agent harness 共 29 项通过，覆盖无效 JSON、错误数组/对象结构、私有响应正文不外泄及正常 stdio 调用。
- 前端契约：140 项通过；node --check app/static/app.js、python -m py_compile app/mcp_server.py 与 git diff --check 通过。
- 本轮没有触碰演示数据库，也没有运行浏览器视觉回归；网页 Agent 与 MCP sidecar 仍是两个独立执行路径。

## 2026-10-25 登录首屏窄屏收紧

以首次打开登录页的视角实测发现，320px 与 390px 下身份选择和登录动作被 Agent 介绍推到首屏以下。窄屏下将四步流程压缩为编号与步骤名，保留流程顺序和人工确认提示（320px 下隐藏脚注说明），并收紧登录面板留白；桌面布局与登录功能不变。

- Chromium 首屏：320×740 的登录按钮底部位于 726px；390×844 位于 829px。两种视口均能看到身份选择、用户名、密码与登录按钮。
- 320px、390px 与 195px（约 200% 窄屏检查）均无横向溢出；HTTP 200，浏览器控制台错误 0。195px 下页面继续纵向滚动，布局和控件仍可访问。
- 前端契约 142 项通过，目标文件 `git diff --check` 通过。截图位于 `round-13-current-baseline/login-320-verified-viewport.png` 与 `login-390-verified-viewport.png`。
