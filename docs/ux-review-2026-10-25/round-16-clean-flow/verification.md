# 验证档案：提交、复核与交付闭环


> 这是一份历史验证存档：记录指定版本、数据和环境下的用户可见结果。它不是产品介绍、开发日报或未来承诺。

## 场景

- End-to-end organizer and submitter walkthrough on an isolated SQLite demo seed, using the local service at `http://127.0.0.1:8017`.
- The demo was run without a configured model key. The browser-only presentation sweep was read-only and did not reset or modify the walkthrough database.
- Screenshots and machine-readable results are grouped under `organizer/`, `submitter/`, and `presentation/`. Database files, WAL files, and credentials are intentionally excluded.

## 可见结果

- Submitter: credential login, complete fields, upload material, save server draft, formally submit, and read the v1 receipt. Upload, draft save, and formal submission returned HTTP 200. The 390px receipt had no horizontal overflow.
- Organizer: manually review the no-key semantic checks against the current v1, accept the submission, create a formal snapshot, and export CSV and ZIP. Both export artifacts returned HTTP 200; the export job succeeded.
- The demo results reported no console errors, uncaught page errors, or 4xx/5xx responses.
- Follow-up Playwright + local Chrome presentation check measured 19 route/viewport combinations at 320, 390, and 1440px. There was no horizontal overflow, console error, page error, or 4xx/5xx response. The missing-subject review route showed its Chinese empty state.
- Frontend contract tests: 147 passed. `node --check app/static/app.js` and `git diff --check` passed.

## 产品边界

复核摘要会把技术检查未完成显示为 `检查未完成`，与规则条使用同一信息色；`failed` 的语义和验收阻断行为保持不变。该状态由前端契约覆盖，现场截图不要求刚好出现未完成规则。

## 复现边界

The walkthrough used fictional demo data and demonstrates workflow behavior only. It does not measure model accuracy, prove quality on real submissions, or satisfy authorization, accessibility, security, backup-retention, or production-readiness requirements. Model quality evaluation remains gated on an authorized, human-labeled, de-identified corpus.
