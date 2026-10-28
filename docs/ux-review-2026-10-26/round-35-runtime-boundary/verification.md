# Round 35 · Agent runtime 数据边界

本轮延续短期评审后的展示收口，重点是让第一次打开展示页的人能从 Agent runtime 状态卡直接看到运行边界，并明确无模型密钥时的离线路径。

## 改动

- Agent runtime 状态卡增加“查看运行边界”快捷入口，点击后展开 Agent walkthrough，并把焦点移到导览区。
- Agent 架构信号条增加“数据边界”说明：无模型密钥时明确显示当前走离线演示路径，不调用实时模型；其他状态说明 MCP 只读聚合，材料正文和最终决定仍留在授权复核路径。
- 数据边界说明在桌面与窄屏下自然换行，不挤压四站路线或状态卡布局。

## 验证

- `node --check app/static/app.js` 通过。
- `node --test tests/frontend_contracts.test.cjs`：168 项通过。
- `git diff --check` 通过。
- 隔离演示服务 `127.0.0.1:8011` 下，1440 / 390 / 320px 均显示四个状态卡、Agent runtime 的“查看运行边界”入口和“数据边界”文案。
- 点击“查看运行边界”后，Agent walkthrough 展开且焦点进入导览区；320px 下仍保持可读。
- 三档视口均满足 `scrollWidth === clientWidth`。
- 浏览器控制台错误为 0，页面异常为 0，失败请求为 0。
- 完整走查结果和定向结果分别保存在本目录的 `results.json` 与 `runtime-boundary-results.json`；截图来自虚构离线演示种子。

## 未覆盖

本轮未覆盖真实模型调用、真实评委试讲效率、真实屏幕阅读器、生产环境鉴权/限流与部署数据边界。
