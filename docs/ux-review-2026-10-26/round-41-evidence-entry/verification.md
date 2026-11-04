# Round 41 · 当前焦点的证据入口

日期：2026-10-26

## 目的

短期反馈记录 `feedback.md` 是“只记录、不修复”的历史走查，本轮不重复修复已经闭环的 8 类问题。继续展示打磨时发现，展示路线的“证据入口”只是说明文字，第一次接触的人仍要先猜当前站的页面和复核主体。

## 处理

- `app/static/app.js` 为四个展示站点生成可操作的证据入口：蓝图、名单与凭证、规则证据、验收快照。
- 复核站沿用服务端路线返回的当前 `href`，例如 `#/review/1/2`，不自行拼接缺失提交者编号的地址。
- `app/static/style.css` 为证据链接补充紧凑布局、紫色行动提示和可见键盘焦点，保留 320px 的单列收缩规则。
- `tests/frontend_contracts.test.cjs` 增加四站路由、文案和焦点样式契约。

## 验证

- `node --check app/static/app.js`：通过。
- `node --test tests/frontend_contracts.test.cjs`：169 项通过。
- `git diff --check -- app/static/app.js app/static/style.css tests/frontend_contracts.test.cjs`：通过。
- 隔离演示服务 `127.0.0.1:8014`，空模型密钥、虚构种子数据，Playwright 1440px / 390px / 320px：当前复核站入口均为 `#/review/1/2`；三档 `scrollWidth === clientWidth`；控制台错误 0；失败请求 0。

截图：

- `desktop.png`
- `mobile-390.png`
- `mobile-320.png`

这轮只验证展示入口和响应式布局；没有据此声称模型质量、生产鉴权或上线前门槛已经完成。
