# 2026-10-25 名册头像显示复核

## 发现与调整

组织者名册实拍中，姓名首字头像被裁切。`.roster-person span` 的通用元信息样式覆盖了头像的居中布局和文本显示规则。为 `.roster-person > .wb-avatar` 补充更具体的弹性居中、字体和换行样式后，桌面与移动端均完整显示姓名首字；名册内容、统计和凭证操作未变。

## 验证

- 前端契约与浏览器启动器：`node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`，159 项通过。
- 浏览器实测：`node scripts/ux_roster_avatar_check.cjs`。虚构演示名册在 1440px 和 390px 下头像宽度均为 34px，首字“张”完整，计算样式为居中弹性布局；页面无横向溢出、控制台错误、未捕获异常或 4xx/5xx 请求。
- `node --check scripts/ux_roster_avatar_check.cjs` 通过；`git diff --check` 无空白错误（Git 仅提示已有文件的换行格式转换）。
- 新截图：`roster-1440.png`、`roster-390.png`；原始浏览器测量：`results.json`。

本轮只读浏览器走查未更改演示业务数据，也未重跑 Python 全量、屏幕阅读器实测或真实用户试点。
