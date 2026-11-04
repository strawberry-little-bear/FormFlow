# Agent Runtime Manifest Walkthrough

Date: 2026-10-25

Environment: local demo service at `http://127.0.0.1:8000`; browser automation used the bundled Playwright package with the installed Google Chrome executable. The walkthrough used the read-only organizer script `scripts/ux_walkthrough_2026-10-25.cjs` and wrote screenshots into this directory.

Results: 19 route/viewport measurements covered organizer desktop routes, the missing-subject review route, organizer pages at 320px and 390px, and submitter login entry at 390px. All measurements had `document.scrollWidth === document.clientWidth`; console errors, uncaught page errors, and HTTP 4xx/5xx responses were all zero. The no-model-key banner was visible on the design route, and the missing-subject route showed its Chinese empty state.

Automated verification: `node --test tests/frontend_contracts.test.cjs tests/ux_browser.test.cjs` passed 148 tests; `python -m pytest -q tests/test_export.py tests/test_agent_runtime.py tests/test_agent_requests.py` passed 18 tests.

Scope note: this run did not upload or formally submit materials, so it did not mutate the seeded demo task. Submitter coverage here is limited to the credential-entry view; the full submit flow has separate evidence under `submitter-full`.

Screenshots and raw measurements are in the sibling PNG files and `results.json`.
