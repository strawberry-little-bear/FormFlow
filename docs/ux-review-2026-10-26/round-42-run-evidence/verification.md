# Round 42 · 复核运行直达证据

日期：2026-10-26  
环境：Windows / Python 3.13 / `FORMFLOW_LLM_API_KEY` 为空 / 隔离演示服务 `127.0.0.1:8015`  
数据：`scripts/seed_demo.py` 生成的虚构演示种子

## 目的

Round 41 已为当前展示站点补上证据入口，但“最近复核运行”展开后仍只有运行摘要、Harness 预算和回放。第一次接触的人需要再回到上方当前焦点才能进入对应主体的证据复核，运行摘要与证据页面之间缺少一跳。

## 处理

- 服务端 `review_signal` 投影新增 `review_href`，由当前任务、正式提交和复核主体生成，例如 `#/review/1/2`；排队中的运行也沿用同一授权复核范围。
- 展示页的“最近复核运行”在摘要来源下方增加“打开本次证据复核”，只使用服务端返回的目标，不在前端猜提交者编号。
- 链接保持轻量文本行动样式，并补充键盘焦点；不自动展开运行详情，也不把运行摘要当作验收决定。
- 增加 Python 与前端契约，覆盖真实主体、路由和焦点样式。

## 验证

- `node --check app/static/app.js`：通过。
- `node --test tests/frontend_contracts.test.cjs`：169 项通过。
- `python -m pytest tests/test_demo_seed.py -q`：4 项通过。
- `git diff --check`：通过。
- Playwright 使用隔离演示服务、空模型密钥和虚构种子，在 1440px / 390px / 320px 打开展示页，展开“最近复核运行”并点击直达链接：三档均进入 `#/review/1/2`；`scrollWidth === clientWidth`；控制台错误 0；页面异常 0；失败请求 0。

截图：

- `round-42-current-1440.png`
- `round-42-current-390.png`
- `round-42-current-320.png`

本轮只改善展示路径和服务端投影的可追溯入口；没有据此声称真实模型质量、生产鉴权、屏幕阅读器回归或上线前门槛已经完成。
