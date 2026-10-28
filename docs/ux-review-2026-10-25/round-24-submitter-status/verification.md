# Round 24: Submitter Status After Formal Submission

Date: 2026-10-25

## Finding and Change

After a successful first submission, the page appended a success receipt but kept the top receipt and right-side instructions in their pre-submission state until a manual refresh. The stale instructions still said “提交前核对” and “记得点正式提交”, which conflicted with the successful result.

After the submit API confirms success, the page now reloads the authoritative server draft and receipt. The page immediately shows the formal version, receipt, correction deadline, and guidance that uploads or saved drafts do not replace the formal version. The browser walkthrough now asserts this state transition.

## Verification

- Used a fresh isolated SQLite demo seed at 127.0.0.1:8014 with FORMFLOW_LLM_API_KEY empty. The existing 8000 service was not touched.
- Completed credential login, form entry, file upload, server draft save, refresh and draft restoration, formal submission, and receipt review. Upload, draft, and submit each returned HTTP 200.
- Confirmed the formal receipt and “补正与回执” guidance appear immediately; “提交前核对” is absent.
- At 390px, document width equaled viewport width (390px). Browser console errors, page exceptions, and 4xx/5xx responses: 0.
- Frontend contracts: 155 passed. JavaScript syntax checks and git diff --check passed.

## Evidence

- submitter-form-before.png
- submitter-receipt.png
- submitter-receipt-390.png

This round covers the submitter flow and does not replace a new organizer walkthrough, a screen-reader sign-off, or real-user and model-quality evaluation.
