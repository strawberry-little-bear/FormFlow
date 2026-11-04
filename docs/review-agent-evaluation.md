# 审核 Agent 评估集

评估器 `scripts/evaluate_review_agent.py` 用已有审核 skill 逐条运行语义规则，并只输出汇总指标。它服务于获准、脱敏并由人工标注的数据；虚构种子和合成对抗测试只验证程序行为，不能作为模型准确率证据。

## 数据格式

数据集使用 UTF-8 JSON，放在受控的本地私有目录，不提交到仓库。顶层要求：

```json
{
  "format_version": 1,
  "authorization": "authorized_and_deidentified",
  "cases": []
}
```

每个案例需含唯一 `id`、`rule`（`id`、`statement`、`requirement_source`）、`files`、`expected.result`。`expected.result` 只能是 `satisfied`、`issue`、`unknown`。可选 `expected.evidence_quotes` 用 `{ "file_id": "...", "quote": "..." }` 记录人工确认的关键原文短句，供证据覆盖率比较；每例最多 50 条，每条最多 2,000 字符，校验会确认短句能在指定文件原文中定位。`files` 中每项含唯一且最多 80 字符的 `file_id`、`slot`、`name` 和按页拆分的 `pages`；可用非负整数 `unread_pages` / `failed_pages` 标注覆盖缺口。可选 `fields`、`members`、`category` 与 `manual_review`。分类限定为 `normal`、`injection`、`ambiguous`、`ocr_gap`、`other`；人工复核可记录有限的非负 `minutes` 与 `satisfied`、`issue` 或 `unknown` 之一作为最终确认的 `final_result`。

## 运行

先只校验格式，不调用模型：

```powershell
python scripts/evaluate_review_agent.py C:\private\review-eval.json
```

确认数据已授权脱敏、所用模型供应商的数据处理条件获准用于该批材料，且运行成本可接受后，显式加 `--run-model`：

```powershell
python scripts/evaluate_review_agent.py C:\private\review-eval.json --run-model
```

`authorization` 是数据维护者的明确声明，工具无法验证授权本身。评估器不复制或写出数据集，只在标准输出打印汇总 JSON；其中不含案例 ID、材料、提示词、模型解释或引文。样本上限为 100，每例最多 10 个文件、每文件 200 页、材料文本总计 100,000 字符；每条规则原文最多 4,000 字符，规则与登记字段/成员上下文合计最多 12,000 字符；输入文件上限 20 MiB。规则和登记上下文也会进入模型提示词，因此一并限制，避免它们绕过材料文本预算；文件 ID 与人工标注引文也有独立长度和数量限制。页覆盖计数必须是整数，布尔值不会被当作 0/1 接受。

## 指标解释

- `result_match_rate`：模型结论与预先人工标注结论完全一致的比例。
- `issue_precision` / `issue_recall`：模型报出的 issue 中正确的比例，以及标注为 issue 的案例中模型也报为 issue 的比例；分母为零时是 `null`。
- `gold_reference_coverage`：人工标注的关键短句有多少也出现在模型保留的证据中；没有标注短句时是 `null`。它测的是证据覆盖，不自动判断引用是否足以支持结论，也不判断 locator 页码正确性。
- `citation_verification_rate`：审核程序最终保留的引文中，可在材料原文定位的比例。运行时会丢弃不可定位的模型引文，因此这个指标主要监视应用校验合同，不能代表独立模型准确率。
- `by_category`：按固定类别分组的样本量、结论一致率与引用定位率。
- `manual_correction_cases`、`human_review_minutes`：仅统计提供 `manual_review.minutes` 的案例，分别记录人工最终结论与模型不一致的数量及复核总分钟数。
- `failed_cases`：模型或检查未能给出可用结论的数量；不能与 issue 混为一类。

这是一轮固定数据集上的观察，不控制模型随机性，也不提供统计置信区间、逐文件 OCR 质量判读或人工标签一致性。应按规则和材料类型解释结果，保留失败样本交人工复核，并先制定业务可接受阈值；不得仅凭小样本把产品描述成具备某一准确率。
