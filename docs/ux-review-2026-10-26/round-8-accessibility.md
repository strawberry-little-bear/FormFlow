# 2026-10-25 Round 8 Accessibility Walkthrough

## Scope

Read-only browser review of the presentation service at `http://127.0.0.1:8000`, using the existing fictional demo seed and the current local build. Chromium's computed accessibility tree was checked on organizer task, design, roster, workbench, review, and delivery routes, plus the submitter login entry. Review details were expanded before inspecting the run-record filters.

## Findings and Changes

- The earlier scan report that the four run-record filter buttons had no accessible names was a false positive. With the containing disclosure expanded, Chromium reports the visible names `全部`, `程序规则`, `语义审核`, and `需人工`; each also exposes its selected state with `aria-pressed`.
- The live accessibility tree reports names for all visible actionable controls checked across the routes. Main landmarks were present, and the review route also exposes its named step navigation.
- The sidebar group labels, footer copy, navigation links, logout action, and warning badges used low-contrast gray or amber colors. Their shared styles now use darker colors. Measured foreground/background contrast is 5.59:1 for the sidebar caption, logo label, and logout action; 5.48:1 for navigation links; 4.69:1 for the sidebar footer note; and 5.54:1 for warning badges.
- Keyboard traversal through the design route showed visible focus indicators on links, buttons, disclosure summaries, and the submitter preview. Textarea and select controls use a visible focus shadow.

## Verification

- At 320px, 390px, and 1440px, the design and review routes had no document-width overflow.
- The route scan recorded no browser page errors or HTTP 4xx/5xx responses.
- Frontend contract and browser tests: 149 passed.
- Full Python suite: 409 passed.
- `git diff --check` reported no whitespace errors; Git emitted only existing line-ending conversion warnings for modified files.

## Remaining Limits

This was a Chromium accessibility-tree and keyboard-focus check, not a real screen-reader session or a complete WCAG audit. Contrast sampling focused on shared navigation and warning styles; it did not exhaustively evaluate every content state, color pairing, or control interaction.
