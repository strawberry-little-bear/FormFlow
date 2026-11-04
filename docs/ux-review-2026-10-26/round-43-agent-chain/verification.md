# Round 43 · 展示页 Agent 运行链

更新：2026-10-26。

## 这轮处理

第一次打开展示视图时，当前路线、Agent runtime、MCP 只读回放和人工接管原本以四张并列状态卡出现，信息本身完整，但先后关系需要讲解者额外补充。本轮将状态带收敛为带 `01` 到 `04` 编号的“一条运行链”，保留每一项已有的直接入口：进入当前站、查看运行边界、查看 MCP 回放和查看接管边界。编号在桌面、390px 和 320px 下都保持稳定；窄屏沿用现有两列/单列断点，不改变任务状态、权限或 MCP 调用边界。

## 验证

- `node --check app/static/app.js` 通过。
- `node --test tests/frontend_contracts.test.cjs`：169 项通过。
- `git diff --check` 通过。
- 隔离服务：`127.0.0.1:8016`，空 `FORMFLOW_LLM_API_KEY`，使用 `data/demo` 虚构种子。
- Playwright 真实登录组织者并进入展示视图：
  - 1440px：显示 `01 当前路线`、`02 Agent runtime`、`03 MCP 只读回放`、`04 人工接管`；`scrollWidth === clientWidth`。
  - 390px：同一组编号保留为两列；`scrollWidth === clientWidth`。
  - 320px：同一组编号自动改单列；`scrollWidth === clientWidth`。
  - 三档均无控制台错误、页面异常或 4xx/5xx 请求。
- 截图：`presentation-1440.png`、`presentation-390.png`、`presentation-320.png`。

## 边界

这轮只调整展示层的阅读顺序和视觉提示，没有把离线演示描述成真实模型能力，也没有改变网页 bridge、外部 MCP sidecar、Agent harness 或人工验收的授权边界。真实模型质量、目标用户试讲、屏幕阅读器和生产部署仍未覆盖。
