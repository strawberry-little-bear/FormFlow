# 验证档案：评审问题验证档案


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

本档案记录 `feedback.md` 中 8 类体验问题的处理结果，Agent、Skill、MCP、Harness 与人工确认边界保持不变。

## 已处理

| 优先级 | 问题 | 处理 |
| --- | --- | --- |
| P0 | Windows 下启动器第二次运行遇到 `tasklist/taskkill` 本地代码页输出会崩溃 | `tasklist` 显式按 Windows 代码页读取并兼容字节输出；`taskkill` 不再强制解码无须读取的输出；进程仍存活时才报告停止失败 |
| P1 | 390px/320px 提交者操作区拥挤，正式提交按钮被挤成多行 | 窄屏下次要操作并排，正式提交独占一行并保持可点击高度 |
| P2 | 提交者标题装饰句号在窄屏孤行 | 移除标题末尾装饰句号 |
| P2 | 复核页“满足”同时显示“阻塞验收” | 已满足规则不再显示阻塞严重度徽章；待处理规则仍保留严重度信息 |
| P2 | 凭证错误提示重复 | 服务端已有明确 `detail` 时直接展示，只有空消息才使用兜底文案 |
| P3 | ZIP 材料条目时间戳为 1980-01-01 | 材料条目使用正式提交时间，缺失时回退原件 mtime，并按 ZIP 时间范围与精度规范化 |
| P3 | 截止时间卡片省略年份 | 提交者顶部截止时间显示完整年份 |
| P3 | 复核页无模型密钥时没有配置引导 | 未完成语义/跨材料检查时显示配置提示，并提供返回任务列表的入口 |

## 自动化验证

- `pytest -q tests/test_start_demo.py tests/test_export.py`：32 passed
- `node --test tests/frontend_contracts.test.cjs`：158 passed
- `node --check app/static/app.js`
- `python -m py_compile scripts/start_demo.py app/services/export.py`
- `git diff --check`

新增回归覆盖 Windows 代码页字节输出、ZIP 材料条目年份和提交凭证错误提示不重复。

## 验证边界

本档案不替代全套 Playwright 实拍、真实屏幕阅读器验证或用户试点。相关截图与走查结论保留在本目录；提交者窄屏操作区、复核页无密钥状态和 ZIP 文件属性仍需要在对应环境中复核。
