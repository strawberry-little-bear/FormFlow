# Round 46 · Agent 控制面真实状态

日期：2026-10-26

本轮目标：让展示页 `AGENT CONTROL PLANE` 的四个节点投影当前服务端运行状态，避免架构栏只呈现静态说明。

## 实施

- 需求 Skill、审核 Skill、Harness 和 MCP 节点新增状态徽章与状态来源说明。
- 需求 Skill 只根据服务端 runtime 的 `requirements_draft` 登记结果显示“已登记”。
- 审核 Skill 只在当前展示路线返回真实 `review_href` 时显示“证据已授权”；没有授权提交时仍显示“等待提交”，并回到工作台入口。
- Harness 直接显示服务端 `max_invocations` 上限，不根据模型配置推断预算。
- MCP 节点根据服务端快照显示“读取中”“已读取”“已回放”或“需重试”。
- runtime、MCP 快照和展示路线异步刷新后都会重新绘制架构状态；状态徽章使用紧凑的成功、信息和等待语义色。

## 验证

- 前端契约：172 项通过。
- Python 全量回归：439 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check`（本轮文件）：通过。
- 隔离服务：`127.0.0.1:8019`，空 `FORMFLOW_LLM_API_KEY`，虚构种子数据。
- 1440px 浏览器读取到：需求 Skill“已登记”、审核 Skill“证据已授权”、Harness“5 次上限”、MCP“已回放”。
- 点击“查看只读回放”后，MCP 面板展开并获得键盘焦点；控制面状态保持与服务端投影一致。
- 390px：`scrollWidth=390`、`clientWidth=390`；320px：`scrollWidth=320`、`clientWidth=320`。两档均保留四个状态节点。
- 完整浏览器走查结果见同目录 `results.json`；控制台错误、页面异常和失败请求均为 0。

## 边界

本轮只投影已有服务端 runtime、MCP 快照和主体级授权入口，不新增业务状态，也不把模型配置当作运行结果。MCP 仍是服务端脱敏投影；外部 sidecar 需要终端单独授权，浏览器不持有 sidecar token，网页 Agent 不直接调用外部 MCP。真实模型质量、提示注入、真实屏幕阅读器和公网生产部署仍未覆盖。
