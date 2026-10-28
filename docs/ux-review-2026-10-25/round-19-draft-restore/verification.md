# Round 19: Draft Restore in the Submitter Guide

Date: 2026-10-25

## Scope

Ran the submitter path against a fresh, isolated SQLite demo seed at `http://127.0.0.1:8001`, with `FORMFLOW_LLM_API_KEY` empty. The walkthrough used the fictional Zhao Liu subject and did not touch the existing demo service on port 8000.

## Results

- Logged in with a submitter credential, completed the fields, uploaded one material, saved the server draft, refreshed, reopened the step-by-step guide, formally submitted, and read the receipt.
- After refresh, the guide skipped the uploaded material and opened the review step. Upload, draft save, and formal submission returned HTTP 200.
- At 390px, document width matched viewport width. Browser console errors, page errors, and 4xx/5xx responses were all zero.
- Frontend contracts and browser harness: 155 passed. JavaScript syntax and `git diff --check` passed. Python tests were not rerun because this round changed no Python code.

## Evidence

- `submitter-results.json`
- `submitter-draft-restored-guide.png`
- `submitter-receipt.png`

The restored-guide screenshot was captured during the chat message entrance animation, so some message text looks faint. The browser assertion checked the restored step content independently of that transient animation.

This verifies the demo workflow with fictional seed data. It does not measure model quality or replace a real-user trial.
