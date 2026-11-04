# Round 31 · 启动器与展示首屏收口

日期：2026-10-26

本轮承接 `feedback.md` 的短期评审意见，核对上一轮修复仍然有效，并收口两项展示前阻塞：Windows 一键启动器在第二次运行时的编码异常，以及展示模式首屏重复显示完整运行时摘要。

## 处理

- `scripts/start_demo.py` 调用 `tasklist` 和种子脚本时改为捕获 bytes，再按 UTF-8 / Windows `mbcs` 解码；同时兼容测试夹具返回字符串的情况。这样在 `PYTHONUTF8=1` 与中文 Windows 代码页并存时，`--check`、`--stop`、`--reset` 不会因为子进程输出解码失败而崩溃。
- 展示模式隐藏重复的完整 `workspace-runtime-strip`，首屏继续保留 `LIVE SHOWCASE STATE`、当前路线、Agent runtime、MCP 只读回放和人工接管摘要；完整运行边界仍可在普通任务页和 Agent walkthrough 中按需展开。
- 新增前端契约，锁定展示模式的摘要层级，避免后续改动重新把重复运行账本放回首屏。

## 验证

- `pytest -q tests/test_start_demo.py`：23 passed
- `node --test tests/frontend_contracts.test.cjs`：166 passed
- `node --check app/static/app.js`：通过
- `node --check scripts/ux_walkthrough_2026-10-25.cjs`：通过
- `git diff --check`：通过
- 隔离演示服务 `http://127.0.0.1:8011`：组织者全流程、复核缺失提交者编号、无模型密钥降级、提交者登录/填表/上传/保存草稿/刷新恢复/正式提交/回执均通过
- 1440px、390px、320px：无整页横向溢出；展示页首屏保留路线与 Agent/MCP/人工接管线索，Agent walkthrough 默认收起
- 浏览器走查：控制台错误 0、页面异常 0、失败请求 0
- 走查脚本：`ux_walkthrough.cjs`、`ux_review_check.cjs`、`ux_key_paths.cjs`、`ux_submitter_check.cjs`、`ux_submitter_full_walkthrough.cjs`、`ux_walkthrough_2026-10-25.cjs`

原始截图和结果位于 `docs/ux-review-2026-10-26/round-31-live/`。

## 未覆盖

- 本轮仍使用空模型密钥和虚构演示数据，未覆盖真实模型质量、授权脱敏数据集评估、真实目标用户试讲和生产部署边界。
- 自动化可达性结果不替代真实屏幕阅读器与辅助技术用户走查。
- 当前隔离演示数据曾被提交者完整走查改写，不再是全新种子；需要复现实拍时用 `python scripts/start_demo.py --reset --port 8011` 重建。

