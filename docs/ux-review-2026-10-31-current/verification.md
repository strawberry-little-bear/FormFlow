# CI 与提交者校验验证档案


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

验证日期：2026-10-30

## 验证范围

验证 CI 历史失败的原因，确认修复可以按 GitHub Actions 的执行顺序在本机复现，并验证提交者第一次校验失败后继续编辑不会留下过期的错误摘要。

## CI 结果与原因

历史失败集中在四处：干净 runner 没有被 `.gitignore` 忽略的 `data/samples/` 解析夹具；Ubuntu 模拟 Windows `tasklist` 时使用了不存在的 `mbcs` codec；Windows 前端契约中的异步测试主体误包住了后续用例，导致后续用例被取消；GitHub Actions 使用旧 Node 20 runtime。

对应处理是：工作流在 pytest 前运行 `python scripts/make_samples.py`；测试夹具改为 ASCII bytes，生产代码在 Windows 优先使用 `mbcs`、跨平台测试时回退本地首选编码；异步契约测试拆成独立的 `test()`；checkout、setup-python、setup-node 升级到 v7，Python 3.12 和 Node.js 22 保持不变。

## 本机 CI 等价检查

按工作流顺序执行：

- `python scripts/make_samples.py`：成功生成 10 个解析样本。
- Python：`450 passed`。
- 前端与浏览器契约：`239 passed`。
- `node --check app/static/app.js`：通过。
- 全部 `ux_*.cjs` 与 `showcase_check.cjs` 语法检查：通过。

## 真实浏览器校验

环境为独立演示服务 `127.0.0.1:8011`、虚构种子、空 `FORMFLOW_LLM_API_KEY`、真实 Worker。

1. 赵六首次进入提交空间，直接点击正式提交，页面显示“还有 1 项需要核对”，并指出缺少“团课报告”。
2. 填写姓名并上传报告后，错误摘要自动隐藏，字段恢复为有效状态；刷新错误摘要没有再次抢焦点。
3. 上传接口返回 HTTP 200；本次浏览器检查无控制台错误、页面错误或失败 HTTP 响应。

## 结论与边界

CI 历史失败来自测试夹具、跨平台编码、异步测试边界和 Action runtime 的组合问题，而不是业务规则本身不稳定。当前代码在本机完整等价检查通过，提交者校验也完成了从失败到修正的闭环。该记录只覆盖本机等价检查和本地浏览器，不替代 GitHub Actions 双平台运行、真实模型评估或公网部署验收。
