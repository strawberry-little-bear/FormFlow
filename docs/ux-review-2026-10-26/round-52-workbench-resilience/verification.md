# 收集工作台弱网状态验证（2026-10-26）

## 本轮处理

- 首次读取失败时，在工作台就地显示“提交情况尚未加载”和重试按钮；名单、催交区域说明暂不可读，不将网络失败伪装成空名单。
- 同一任务已有读取结果时，重新进入工作台会先恢复显示缓存的名单、进度和催交状态。更新失败会标记数据来自上次读取，并保留现有内容。
- 每次刷新附带递增请求编号，并核对路由 epoch、任务编号和当前路由；迟到的旧请求不能覆盖较新的成功结果，也不能在离开页面后改变提示。

## 验证

- `node --test tests/frontend_contracts.test.cjs`：177 项通过，含首次加载失败、旧数据保留、并发旧响应忽略三个场景。
- `node --check app/static/app.js` 与 `node --check tests/frontend_contracts.test.cjs`：通过。
- `git diff --check -- app/static/app.js app/static/style.css tests/frontend_contracts.test.cjs`：通过。

本轮没有对现有演示数据库做写入，也没有进行真实浏览器断网或断网重连实拍；全站离线恢复仍不在本轮结论范围内。
