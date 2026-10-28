# Round 8: Submitter Network Recovery

Date: 2026-10-25

## Environment

- Isolated SQLite database seeded with scripts/seed_demo.py; existing demo databases were not used.
- Local API on 127.0.0.1:8001; FORMFLOW_LLM_API_KEY was empty.
- Chromium browser automation with API route interception; the test used fictional seed data and a generated text attachment.

## Results

- Initial submitter-space load failure: previously verified separately; credential remains in local storage, route stays on #/submit, and the reload control is visible.
- Upload failure before the request reaches the API: the page states that upload success is unconfirmed and the selected file remains selected. Retrying the upload succeeds and the attachment appears in the form.
- Formal submit response loss: the intercepted request reaches the API and commits successfully, then the browser connection is aborted. The page says the result is unconfirmed. Retrying sends the same idempotency key, returns the original receipt, and displays the successful v1 receipt without creating a second revision.

The browser automation reported all these assertions as passing. This covers submitter initial load, upload retry, and idempotent recovery after an ambiguous submit response.

## Follow-up Contract Coverage

- Submitter result reads keep existing content visible on failure and expose a manual reload action.
- A transient 503 schedules a retry after 3 seconds. Reconnection triggers an immediate read, and a successful response resets the retry state.
- Automatic retries use 3/6/12/24/30-second delays and stop after five retries. A 401 does not schedule another request.
- The front-end contract suite passes 138 tests.

This follow-up is contract-tested in the browser-facing JavaScript harness; a browser-level result-poll disconnect/reconnect run is still outstanding. Repeated connectivity changes, delayed responses, and the organizer workspace under network loss also remain unverified.
