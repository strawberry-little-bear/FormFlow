# 跨平台运行与首次任务闭环


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

日期：2026-10-30

## 读者可见范围

这份档案展示 FormFlow 在 Ubuntu 与 Windows 运行环境中的验证范围，并用干净 SQLite、虚构种子、空 `FORMFLOW_LLM_API_KEY` 和真实 Worker 走完第一次创建任务到归档的路径。

## 跨平台兼容性

| 根因 | 处理 |
| --- | --- |
| 解析样本位于被 `.gitignore` 忽略的 `data/samples/`，干净 runner 没有夹具 | 工作流在 Python 测试前运行 `python scripts/make_samples.py` |
| Ubuntu 没有 Windows 专属 `mbcs` codec | `tasklist` 模拟夹具使用 ASCII bytes；生产代码在 Windows 优先 `mbcs`，其他平台回退本地首选编码 |
| 前端契约异步测试结构误包住后续用例，Windows runner 取消了后续 6 项 | 拆开异步测试主体，保证每个 `test()` 独立完成 |
| checkout/setup action 使用旧 Node 20 runtime | 升级 `actions/checkout`、`actions/setup-python`、`actions/setup-node` 到 v7，保留 Python 3.12 / Node.js 22 |

## 自动化结果

- GitHub Actions：运行 [41042093193](https://github.com/strawberry-little-bear/FormFlow/actions/runs/41042093193)。
- `ubuntu-latest`：成功；生成样本、Python 450 项、前端契约 238 项、JS 语法检查全部通过。
- `windows-latest`：成功；同一套步骤全部通过。

## 首次任务闭环

独立服务 `127.0.0.1:8152`，Worker 已启动，模型密钥留空。浏览器走查覆盖：组织者新建任务、选择模板并发布、导入名单、发放凭证；提交者首次登录、缺项阻止提交、上传 PDF、保存服务器草稿、正式提交；Worker 从排队进入无密钥降级结果；组织者固定快照并导出 CSV + ZIP。

结果：所有关键接口返回 200，正式提交只发起 1 次；提交者看到“材料检查已完成，等待组织者验收”，并明确“暂时没有需要你处理的事项”；1440/390/320px 均无横向溢出，无控制台错误、失败 HTTP 请求或意外 Agent 请求。原始 JSON 结果位于 `%TEMP%\formflow-next-round-20261030-190350\first-task-with-worker`。

## 体验边界

自动化结果覆盖样本生成、跨平台编码、异步测试边界和 Action runtime；组织者与提交者的首次任务闭环也在 Worker 真实运行条件下完成。这里的结果只说明指定版本和环境可以复现该路径，不代表真实模型质量或公网部署已经验收。
