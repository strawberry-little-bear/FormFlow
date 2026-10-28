# 2026-10-25 手机 Agent 导览复核

## 环境与范围

- 服务：http://127.0.0.1:8000，使用现有演示入口；没有重置或修改任务数据。
- 路由：组织者任务首页展示视图。
- 视口：390px、320px 和 1440px。
- 浏览器：本机 Chromium，无痕会话。

## 调整

手机展示视图不再自动展开 Agent 工作导览的五阶段说明、Harness 约束和 MCP 边界。标题、离线/在线状态及展开提示仍可见；点击摘要仍能展开全部架构细节。桌面展示视图继续默认展开，工作模式不变。

390px 页面总高从上一轮实拍的约 2632px 降至 1728px；320px 为 1792px。两种手机宽度均无横向溢出。手机展开后 aria-expanded 随 details 状态更新；1440px 展示入口仍自动展开。控制台错误、页面异常及 4xx/5xx 请求均为 0。

前端契约 132 项通过，node --check app/static/app.js 与 git diff --check 通过。

## 截图

- mobile-collapsed.png
- mobile-320-collapsed.png
- desktop-expanded.png
