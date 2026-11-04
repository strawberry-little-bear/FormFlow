# 2026-10-25 Round 17: Login and Mobile Agent Tour

## Scope

- Read-only Playwright walkthrough against `http://127.0.0.1:8000` using the existing fictional demo seed and the empty-model-key presentation configuration.
- Used the installed local Microsoft Edge executable through the repository's existing `scripts/ux_walkthrough_2026-10-25.cjs` harness. Playwright was installed in a temporary directory; no project dependency manifest was changed.
- New screenshots and `results.json` are stored in this directory. The walkthrough did not reset or modify the demo database.

## Results

- 20 route and interaction checks covered 1440px, 390px, and 320px viewports: login, tasks, design, roster, workbench, review, delivery, submitter entry, the missing-subject review empty state, and the mobile Agent architecture shortcut.
- No horizontal overflow, browser console errors, uncaught page errors, or 4xx/5xx responses were observed.
- At 320px, the Agent architecture shortcut opened the tour, moved keyboard focus into the tour, and scrolled the section into view. The four-step login flow remained readable at desktop and mobile widths.
- Results are recorded in `results.json`; screenshots include the desktop/mobile login, organizer routes, 320/390px task/design/workbench/review pages, the missing-subject state, and the expanded mobile Agent tour.

## Scope Limits

This validates the fictional demo presentation only. It does not establish screen-reader compatibility, usability with target organizers or submitters, semantic review quality on real materials, or production readiness. The mobile Agent tour received browser visual and focus checks, but no real assistive-technology test was performed.
