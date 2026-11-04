# Round 55 · RUN STAGES 证据跳转

日期：2026-10-26

本轮目标：让任务首页的 `RUN STAGES` 从静态摘要变成可讲解的证据入口，方便第一次看到作品的评委沿着运行阶段进入授权复核上下文。

## 实现

- 四段阶段改为键盘可操作按钮，保留当前服务端摘要中的状态、数量和来源话术。
- 读取材料、程序核验、语义审核点击后展开并聚焦最近复核运行摘要。
- 人工接手在有授权复核入口时优先聚焦该入口；没有运行摘要时回到 Agent 导览的人工作用边界。
- 阶段入口在 390px 收为两列、320px 收为单列，按钮不改变时间轴的稳定尺寸。
- `index.html` 将静态 `style.css` 与 `app.js` 版本从 `20261026-1` 更新为 `20261026-2`，避免展示浏览器继续使用旧缓存。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：179 项通过。
- `node --check app/static/app.js`：通过。
- `git diff --check -- app/static/app.js app/static/style.css tests/frontend_contracts.test.cjs`：通过。
- 本地 `127.0.0.1:8000` 空模型密钥演示数据，Playwright 走查 1440 / 390 / 320px：
  - `scrollWidth === clientWidth`，三档均无横向溢出。
  - 三档均渲染 4 个阶段按钮。
  - 三档均无控制台错误和失败请求。
  - 桌面首段按钮宽度约 305px，390px 约 140px，320px 单列约 225px；文本保持横向可读。
  - 点击语义审核阶段后，最近复核运行摘要自动展开、滚入视口并获得焦点。

实拍：

- `tasks-1440-final.png`
- `tasks-390-final.png`
- `tasks-320-final.png`

## 边界

本轮验证的是页面状态与交互链，不代表真实模型质量、真实评委试讲、屏幕阅读器体验或生产部署结果。
