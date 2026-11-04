# Round 36 · 短期评审闭环

日期：2026-10-26  
环境：Windows / Python 3.13 / `FORMFLOW_LLM_API_KEY` 为空 / 隔离演示服务 `127.0.0.1:8011`  
数据：`scripts/start_demo.py --reset` 写入的虚构演示种子

## 本轮结论

`docs/ux-review-2026-10-26/feedback.md` 中列出的短期问题在当前工作树均已落地。此次复核没有新增业务代码修改，重点是用专项测试和真实浏览器确认历史修复在当前版本仍然生效。

## 复核证据

- 启动器：`python scripts/start_demo.py --check --port 8011` 正常完成；已登记的 API 与 Worker 均被识别为运行中，没有再次出现 Windows 原生工具输出导致的 `UnicodeDecodeError` / `AttributeError`。
- 前端契约：`node --test tests/frontend_contracts.test.cjs`，168 项通过。
- 启动器与导出：`python -m pytest tests/test_start_demo.py tests/test_export.py -q`，32 项通过；单独导出回归 9 项通过，ZIP 材料条目年份不再是 1980。
- 语法与空白：`node --check app/static/app.js`、`git diff --check` 均通过。
- 390px / 320px 提交者页：三项操作中“提交更正版本并重新核对”独占一行；次要操作并排且文字完整；`scrollWidth === clientWidth`；标题没有装饰句号孤行。
- 复核页：已满足规则仅显示当前结果，不再把“阻塞验收”作为并排状态；缺少提交者编号的 `#/review/1` 显示“先选一位提交者”中文空态且不发请求。
- 无模型密钥路径：复核代码区分“模型尚未配置，检查暂未开始”和“这次检查没有形成结论”，分别提供模板/人工处理或重新发起检查的下一步，并指向任务列表配置提示。
- 凭证错误路径：输入无效提交凭证时页面只显示“凭证无效或已撤销”，不再重复拼接“凭证无效或已失效：”。
- 浏览器走查：有效路径无控制台异常；无效凭证只产生预期的 `401 /api/me`，页面停留在登录页并保留下一步提示。

## 本轮覆盖边界

没有覆盖真实模型供应商调用、真实评委试讲效率、屏幕阅读器、剪贴板权限拒绝、生产部署和公网安全配置。这些仍属于上线前门槛，不把当前离线演示结果当作生产结论。
