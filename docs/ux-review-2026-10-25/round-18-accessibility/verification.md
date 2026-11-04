# Round 18: Accessibility Sweep

Date: 2026-10-25

## Scope

Ran axe-core against the organizer login, submitter login tab, and the task, design, roster, workbench, review, and delivery routes on the local seeded demo. Checks were tagged for WCAG 2.1/2.2 A/AA. The report is `accessibility-results.json`.

## Findings and changes

- Darkened secondary labels that fell below the 4.5:1 text contrast threshold, including table headers, design preview labels, runtime tour labels, readiness labels, and success badges.
- Removed incomplete `aria-label` values from showcase route links and workbench statistic buttons. Their accessible names now come from their visible labels, while route current-step and pressed-state semantics remain.
- Updated frontend contracts to protect visible accessible names and team-unit counts.

## Verification

- axe-core: 0 confirmed violations across all 8 scanned views; no console errors, page errors, or failed HTTP responses.
- Frontend contracts: 150 passed.
- `node --check app/static/app.js` and `git diff --check`: passed.

axe reported some checks as incomplete where it could not determine contrast automatically. Those require human review; this scan does not replace keyboard-only checks with assistive technology, a screen-reader walkthrough, or testing with people who use assistive technology.
