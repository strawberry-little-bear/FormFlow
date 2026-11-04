# 2026-10-25 Round 16: Clean Submission and Review Flow

## Scope

- End-to-end organizer and submitter walkthrough on an isolated SQLite demo seed, using the local service at `http://127.0.0.1:8017`.
- The demo was run without a configured model key. The browser-only presentation sweep was read-only and did not reset or modify the walkthrough database.
- Screenshots and machine-readable results are grouped under `organizer/`, `submitter/`, and `presentation/`. Database files, WAL files, and credentials are intentionally excluded.

## Results

- Submitter: credential login, complete fields, upload material, save server draft, formally submit, and read the v1 receipt. Upload, draft save, and formal submission returned HTTP 200. The 390px receipt had no horizontal overflow.
- Organizer: manually review the no-key semantic checks against the current v1, accept the submission, create a formal snapshot, and export CSV and ZIP. Both export artifacts returned HTTP 200; the export job succeeded.
- The demo results reported no console errors, uncaught page errors, or 4xx/5xx responses.
- Follow-up Playwright + local Chrome presentation check measured 19 route/viewport combinations at 320, 390, and 1440px. There was no horizontal overflow, console error, page error, or 4xx/5xx response. The missing-subject review route showed its Chinese empty state.
- Frontend contract tests: 147 passed. `node --check app/static/app.js` and `git diff --check` passed.

## Follow-up Fix

The review rule badge and count describe a failed technical check as `检查未完成` with the information tone. The run-summary chip had still used the warning tone. It now uses the same information tone; the semantic `failed` result and acceptance blocking behavior are unchanged. A contract assertion covers the run-summary chip.

The live review screenshot did not contain an incomplete rule, so this exact chip color is verified by the frontend contract rather than by a live failed-state screenshot. Python tests were not rerun for this frontend-only change.

## Scope Limits

The walkthrough used fictional demo data and demonstrates workflow behavior only. It does not measure model accuracy, prove quality on real submissions, or satisfy authorization, accessibility, security, backup-retention, or production-readiness requirements. Model quality evaluation remains gated on an authorized, human-labeled, de-identified corpus.
