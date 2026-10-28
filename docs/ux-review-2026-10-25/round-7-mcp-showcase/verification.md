# 2026-10-25 五分钟演示顺序与 MCP 实连

## 演示顺序

修正 `docs/demo-guide.md` 的重叠时间段，使交付（3:40–4:10）、Skill/Harness/MCP（4:10–4:45）和双 Agent 收尾（4:45–5:00）按顺序完成。

## MCP 现场调用

- 命令：`python scripts/demo_mcp.py`。
- 使用本地虚构演示账号登录，stdio 客户端发现 `list_my_tasks`、`get_task_next_step`、`get_task_agent_runtime` 三个工具，均带只读提示。
- 三项工具调用成功，读取 1 个演示任务的路线与 runtime 合同；输出包含 Skill、允许工具、Harness 步骤/调用上限和人工控制点。
- 会话 token 未打印；sidecar 未读取提交者名单或材料正文，也没有写入业务状态。
- API 环境：`http://127.0.0.1:8000`。本次走查只验证协议和演示链路，不代表真实模型质量评估。

## 自动化

`tests/test_mcp_server.py` 与 `tests/test_demo_mcp_script.py` 覆盖 MCP 授权、工具发现、只读标记、字段投影及演示选择逻辑。
