# Round 21: Reminder Deadline Clarity

Date: 2026-10-25

## Finding

The organizer's default reminder said to pay attention to the deadline but did not include the task's actual first-submission deadline. This left a common copy-and-send workflow vulnerable to date confusion.

## Change

The generated reminder draft now includes the first deadline formatted in the task timezone. If the task has no first deadline, the draft uses a generic instruction without inventing a date. Organizers can edit the text before generating a notification intent; the application still does not send notifications.

## Verification

- Frontend contracts: 154 passed, including configured and unset first-deadline cases.
- Playwright with an isolated SQLite fictional seed and an empty model key rendered `2026-10-31 20:07` in the task timezone at desktop and 390px; viewport and document widths both measured 390px.
- Browser console errors, page errors, and 4xx/5xx responses: 0. No notification intent was created.
- `node --check app/static/app.js`, `node --check scripts/ux_reminder_deadline.cjs`, and `git diff --check`: passed.

## Evidence

- `browser-results.json`
- `workbench-reminder-desktop.png`
- `workbench-reminder-390.png`
