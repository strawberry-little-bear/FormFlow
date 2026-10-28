# 2026-10-25 Agent MCP Boundary Check

## Change

The offline Agent walkthrough now lists all four read-only MCP sidecar tools, including `get_task_collection_progress`. Its boundary text says the sidecar returns task navigation, applicable collection-stage aggregate counts, and Agent runtime; it does not read person-level roster rows, material contents, or review results, and the webpage Agent does not call it. The frontend contract asserts the fourth tool and these boundaries.

## Verification

- Frontend contracts and browser launcher tests: 149 passed.
- Agent runtime and MCP server tests: 9 passed.
- `git diff --check`: passed.
- The local service returned HTTP 200 at `127.0.0.1:8000`.

## Limits

No browser screenshots or live layout measurements were captured. The walkthrough script could not start because Playwright was unavailable. The desktop in-app browser then denied access to the local loopback URL, so browser policy was not bypassed. `git fetch origin` also failed because the GitHub connection was reset; the local `main` branch's remote tracking state could not be refreshed during this check.
