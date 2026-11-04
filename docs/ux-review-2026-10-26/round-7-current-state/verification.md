# 2026-10-25 Current Presentation Baseline

## Scope

Read-only browser walkthrough of the local presentation service at `http://127.0.0.1:8000`, using the existing fictional demo seed and an empty `FORMFLOW_LLM_API_KEY`. The run covered organizer login and task/design/roster/workbench/review/delivery routes, the missing-subject review route, the submitter login entry, and 320px/390px/1440px viewports. Evidence and raw measurements are in this directory; `results.json` was generated at `2026-10-25T08:34:51.603Z`.

## Results

- 20 route or interaction checks completed. No horizontal overflow, browser console errors, uncaught page errors, or HTTP 4xx/5xx responses were recorded.
- `#/review/1` showed the Chinese “先选一位提交者” empty state.
- At 320px, the “查看 Agent 架构” shortcut opened the guide, moved focus into it, and scrolled the guide into view (`tourTop: 198`; viewport and document widths both 320px). This behavior is now asserted by `scripts/ux_walkthrough_2026-10-25.cjs`.
- The no-model-key fallback was visible on the design route. Submitter coverage in this run was the 390px credential-entry view only; it did not repeat upload, formal submission, or receipt actions.

## Regression Evidence

The seven findings in `docs/ux-review-2026-10-23/verification.md` have corresponding current implementation and regression coverage: missing-subject review empty state, honest no-key fallback, inline favicon, SVG login feature icons, short date formatting, “提交时间” receipt label, and task-timezone CSV timestamps with invalid-zone fallback. This run directly rechecked the missing-subject state and no-key banner; it did not repeat every original interaction or CSV export path.

This round reran `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs` (149 passed) and the focused Python Agent, LLM/no-key, export, and MCP tests (45 passed). The full Python suite was not rerun. Existing round-16 evidence separately records the clean-seed organizer/submitter submission-to-archive flow.

## Limits

This is fictional-seed workflow and layout evidence, not model-quality evidence. This round did not cover a real user pilot, authorized de-identified material evaluation, real screen-reader testing, full accessibility verification, or production security/deployment readiness. It did not re-run the full Python suite.
