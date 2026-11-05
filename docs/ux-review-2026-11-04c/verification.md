# 2026-11-04 提交者材料上传辅助技术走查


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

## 范围

- 基线：GitHub `main`，提交 `c7910f0fb49a03d35d0f5ac3cef55082a4f5c4f5`；检查时远端 `main` 指向同一提交。
- 在独立临时克隆中检查提交者表单材料槽位。
- 发现格式、份数、大小和页数限制虽显示在页面中，但文件选择控件的 `aria-describedby` 只关联错误消息，屏幕阅读器用户聚焦控件时不会获知上传约束。

## 结果与验证

- 为每个材料槽位的限制说明添加稳定 ID；文件控件现在同时关联限制说明、适用的条件要求和校验错误。
- 增加前端契约，渲染有条件与无条件材料槽，并验证控件关联的每个描述 ID 都存在于页面输出；静态资源版本更新至 `20261104-5`。
- `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs`：247 项通过。
- CI 同序 Python 全量命令（关闭 pytest 缓存）：452 项通过。
- `node --check app/static/app.js`、`node --check tests/frontend_contracts.test.cjs`、`git diff --check`：通过。

## 限制

本记录验证锁定 DOM 模板契约，未运行真实屏幕阅读器或浏览器端读屏验收；本地未重跑 Python 全量。推送后的 GitHub Actions 结果需另行确认。
