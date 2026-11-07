# 验证档案：Agent 架构与运行边界展示


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

## 场景

任务首页需要让第一次打开作品的访客看懂三件事：Agent 当前负责什么、运行状态是否可用、MCP 提供了哪些只读信息。页面同时保留原始工具证据，方便继续核对。

## 可见结果

- 任务首页展示 Agent 控制面板，说明当前运行阶段、责任范围和下一步入口。
- MCP 快照使用面向产品的能力名称，仍保留原始工具证据供评审者展开查看。
- 页面没有把 MCP 描述成可写业务接口，也没有把离线演示轨迹包装成真实模型结论。

## 复现结果

- `node --check app/static/app.js`: passed
- `node --test tests/frontend_contracts.test.cjs`: 162 passed
- `python -m pytest -q tests/test_start_demo.py tests/test_export.py`: 32 passed
- `git diff --check`: passed
- Browser walkthrough at 1440px, 390px, and 320px: no horizontal overflow
- Browser console errors: 0
- Page errors: 0
- HTTP 4xx/5xx responses: 0

截图和 `results.json` 保存在本目录。该档案不覆盖真实屏幕阅读器、实时 provider 或真实用户试点。
