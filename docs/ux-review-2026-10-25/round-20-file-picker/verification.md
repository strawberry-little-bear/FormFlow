# Round 20: Submitter File Picker

Date: 2026-10-25

## Finding

The submitter material slot used the browser's default English file input, which looked out of place in the Chinese interface and gave no consistent filename preview.

## Change

Both the complete form and step-by-step guide now share a Chinese file picker with a visible selected filename, an accessible name, a live filename announcement, keyboard focus styling, and the existing format filter. The full-form input remains associated with its slot validation message. The file upload API and upload limits are unchanged.

## Verification

- Playwright on an isolated SQLite fictional seed with `FORMFLOW_LLM_API_KEY` empty: credential login, form completion, file selection, upload, server draft save, refresh and guide restoration, formal submit, and receipt all completed. Upload, draft, and submit returned HTTP 200.
- Selected filename was `赵六_团课报告.txt`; 390px viewport and document widths were both 390.
- Console errors, page errors, and 4xx/5xx responses: 0.
- Frontend contracts and browser harness: 155 passed. `node --check app/static/app.js`, `node --check scripts/ux_submitter_full_walkthrough.cjs`, and `git diff --check` passed. Python tests were not rerun because this round changed no Python code.

## Evidence

- `submitter-results.json`
- `submitter-form-before.png`
- `submitter-draft-saved.png`
- `submitter-receipt-390.png`

The browser walkthrough selected a file through the full-form picker. The step-by-step guide uses the same picker renderer, but this run did not upload through the guide itself. The seed contains fictional data and does not establish model quality or production readiness.
