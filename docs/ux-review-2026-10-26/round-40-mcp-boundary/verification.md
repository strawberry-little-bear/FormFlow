# Round 40 · MCP 入口边界

日期：2026-10-26  
环境：Windows / Python 3.13 / `FORMFLOW_LLM_API_KEY` 为空 / 隔离演示服务 `127.0.0.1:8013`  
数据：已有虚构演示种子

## 本轮处理

展示路线的 Agent 架构栏补充 MCP 入口关系，明确两条独立路径：

- 网页展示的是服务端生成的脱敏只读投影；
- 外部 MCP sidecar 需在终端单独授权调用；
- 浏览器不持有 sidecar token，网页内置 Agent 也不调用外部 MCP。

MCP 节点同步标注为“终端单独调用，只读导航与聚合快照”。本轮只调整展示层文案与契约，不新增后端状态，不改变网页 bridge、sidecar、Skill 或 Harness 的调用边界。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：168 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check`：通过。
- `scripts/ux_walkthrough.cjs` 使用 `http://127.0.0.1:8013` 完成登录、展示任务、工作台、设计、名册、复核和交付路径；1440px 与 390px 截图已生成。
- 320px 独立浏览器复核确认边界文案可见，`scrollWidth=320`、`clientWidth=320`。
- 三档浏览器复核控制台错误为 0，失败响应为 0。

## 截图

- `login.png`
- `tasks.png`
- `showcase-320.png`
- 以及本轮走查生成的其他页面截图，均位于本目录。

## 未覆盖

本轮未覆盖真实模型供应商调用、真实评委试讲、屏幕阅读器、生产部署和公网安全配置；这些仍属于上线前门槛。