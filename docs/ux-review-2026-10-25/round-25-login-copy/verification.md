# Round 25: Login Capability Copy

Date: 2026-10-25

## Finding and Change

On a first visit with `FORMFLOW_LLM_API_KEY` unset, the login page said “聊几句就能出表” and described automatic drafting without stating the model-key prerequisite. The design workspace already disclosed that AI drafting was unavailable, so the first-screen claim could set the wrong expectation.

The login feature now reads “智能起草，先确认再发布” and explains that a model key is required and the organizer confirms before publication. A frontend contract asserts the prerequisite and human confirmation remain visible. The versioned JavaScript asset URL was incremented so returning browsers load the updated copy.

## Verification

- Seeded a fresh fictional SQLite database in `.tmp-ux-organizer-recheck-20261025` with an empty `FORMFLOW_LLM_API_KEY` and ran the organizer presentation walkthrough against `127.0.0.1:8016`.
- The walkthrough covered 20 routes and viewport checks, including 1440, 390 and 320px login layouts, organizer workflow routes, missing-subject review state and the mobile Agent-tour shortcut.
- Horizontal overflow, console errors, page exceptions and 4xx/5xx responses: 0.
- Frontend contract and browser-harness tests: 157 passed. JavaScript syntax checks and `git diff --check` passed.
- The existing service on port 8000 was not used or modified.

## Evidence

- `login-desktop.png`
- `login-mobile.png`
- `login-320.png`
- `results.json`
