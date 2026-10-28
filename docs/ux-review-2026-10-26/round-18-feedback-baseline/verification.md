# 2026-10-26 短期评审反馈闭环后的基线

本轮只整理已完成修复的当前基线，避免把历史评审记录误读成未处理待办。原始问题仍保留在 `../feedback.md`，处理证据见 `../round-12-feedback-fixes/verification.md` 与 `../round-15-feedback-close/verification.md`。

## 当前边界

- 网页任务首页的 MCP 展示是服务端 MCP-compatible read-only bridge：返回脱敏的 Agent 意图、四个调用序号、scope、状态、correlation id 和人工接手边界。
- `scripts/demo_mcp.py` 与 `app.mcp_server` 是独立 stdio sidecar，供外部 MCP 客户端演示；网页不会接触 sidecar token，也不会直接启动 sidecar。
- 浏览器与 sidecar 都不能通过这些只读入口读取逐人名单、材料正文、审核证据或写入业务状态。

## 本轮回归

在停止旧的 `127.0.0.1:8000` 演示进程后执行：

```text
python -m pytest -q tests/test_start_demo.py tests/test_export.py tests/test_agent_runtime.py tests/test_mcp_server.py tests/test_demo_mcp_script.py
node --check app/static/app.js
node --test tests/frontend_contracts.test.cjs
git diff --check
```

结果：Python 专项 51 项通过，前端契约 162 项通过，JS 语法检查通过，`git diff --check` 通过，8000 端口已释放。专项通过项覆盖启动器 Windows `tasklist` 字节/代码页兼容、ZIP 条目时间戳、网页 bridge 权限隔离、sidecar 工具发现及前端 MCP 展示契约。未把本轮文档整理误报为真实模型质量、屏幕阅读器或公网部署验收。

## 下一步入口

后续应从路线文档“上线前必经门槛”继续：真实材料告知与删除、公网鉴权/限流、数据库和附件备份恢复、授权脱敏数据上的模型质量评估，以及真实用户与屏幕阅读器试点。
