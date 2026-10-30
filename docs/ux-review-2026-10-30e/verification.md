# CI 与首次任务闭环复核

日期：2026-10-30

## 目标

确认近期 CI 失败不是偶发重跑，并用干净 SQLite、虚构种子、空 `FORMFLOW_LLM_API_KEY` 和真实 Worker 重跑第一次创建任务到归档的完整路径。

## CI 根因与处理

| 根因 | 处理 |
| --- | --- |
| 解析样本位于被 `.gitignore` 忽略的 `data/samples/`，干净 runner 没有夹具 | 工作流在 Python 测试前运行 `python scripts/make_samples.py` |
| Ubuntu 没有 Windows 专属 `mbcs` codec | `tasklist` 模拟夹具使用 ASCII bytes；生产代码在 Windows 优先 `mbcs`，其他平台回退本地首选编码 |
| 前端契约异步测试结构误包住后续用例，Windows runner 取消了后续 6 项 | 拆开异步测试主体，保证每个 `test()` 独立完成 |
| checkout/setup action 使用旧 Node 20 runtime | 升级 `actions/checkout`、`actions/setup-python`、`actions/setup-node` 到 v7，保留 Python 3.12 / Node.js 22 |

## 远端结果

- GitHub Actions：运行 [41042093193](https://github.com/strawberry-little-bear/FormFlow/actions/runs/41042093193)。
- `ubuntu-latest`：成功；生成样本、Python 450 项、前端契约 238 项、JS 语法检查全部通过。
- `windows-latest`：成功；同一套步骤全部通过。

## 首次任务闭环

独立服务 `127.0.0.1:8152`，Worker 已启动，模型密钥留空。浏览器走查覆盖：组织者新建任务、选择模板并发布、导入名单、发放凭证；提交者首次登录、缺项阻止提交、上传 PDF、保存服务器草稿、正式提交；Worker 从排队进入无密钥降级结果；组织者固定快照并导出 CSV + ZIP。

结果：所有关键接口返回 200，正式提交只发起 1 次；提交者看到“材料检查已完成，等待组织者验收”，并明确“暂时没有需要你处理的事项”；1440/390/320px 均无横向溢出，无控制台错误、失败 HTTP 请求或意外 Agent 请求。原始 JSON 结果位于 `%TEMP%\formflow-next-round-20261030-190350\first-task-with-worker`。

## 结论

CI 的环境差异和测试结构问题已经修复并在 Ubuntu/Windows 双平台连续运行通过；本轮首次使用者闭环也在 Worker 真实运行条件下完成。后续若再次失败，优先检查 runner 是否执行了样本生成步骤，以及失败发生在哪个平台矩阵，而不是先重跑同一提交。