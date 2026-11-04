# Round 45 · Agent 控制面入口

日期：2026-10-26

本轮目标：把展示页 `AGENT CONTROL PLANE` 的四个架构节点变成可操作、可解释且不越过授权边界的入口。

## 实施

- 需求 Skill：链接到当前任务 `#/design/<taskId>`。
- 审核 Skill：服务端有真实 `review_href` 时进入主体级证据复核；没有运行摘要或授权提交时只回到 `#/workbench/<taskId>`，显示“等待授权提交后进入主体复核”。
- Harness：调用现有 `jumpToAgentTour()`，展开 Agent 运行边界并把焦点移动到导览区域。
- MCP sidecar：调用现有 `jumpToMcpSnapshot()`，打开只读回放并把焦点移动到回放区域。
- 四个入口均补充可访问名称和可见焦点；桌面保持四列，390px 两列，320px 单列。

## 验证

- 前端契约：171 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check`（本轮文件）：通过。
- 隔离服务：`127.0.0.1:8018`，空 `FORMFLOW_LLM_API_KEY`。
- 浏览器走查：1440 / 390 / 320px 的 `scrollWidth` 与 `clientWidth` 分别为 1440/1440、390/390、320/320。
- 浏览器读取到的真实入口：`#/design/1`、`#/review/1/2`、Harness 运行边界按钮、MCP 只读回放按钮。
- 点击 Harness 与 MCP 后，目标折叠区均展开，键盘焦点落在对应区域。
- 控制台错误：0；页面异常：0；服务端 4xx/5xx：0。

## 边界

本轮没有验证真实模型质量、授权脱敏材料上的提示注入、真实屏幕阅读器和公网生产部署。MCP 仍是服务端脱敏投影；外部 sidecar 需要终端单独授权，浏览器不持有 sidecar token，网页 Agent 不直接调用外部 MCP。
