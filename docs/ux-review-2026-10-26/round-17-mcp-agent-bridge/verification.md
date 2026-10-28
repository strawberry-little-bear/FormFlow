# Round 17 - Agent to MCP read-only bridge

Date: 2026-10-26 (Asia/Shanghai)

This round turns the MCP showcase from a passive snapshot into a repeatable,
server-owned read-only Agent walkthrough. The organizer page can request one
run, then shows the bounded intent, four allow-listed reads, correlation id,
redacted result scope, and the remaining organizer decision gate.

## Implementation

- `POST /api/tasks/{task_id}/mcp-demo` runs the deterministic server-side bridge.
- The browser receives no MCP session token, participant rows, material body, or review evidence.
- Each call is labeled with its sequence, organizer scope, status, and bounded duration field.
- The existing `GET /api/tasks/{task_id}/mcp-snapshot` now exposes the same contract with a page-load trigger.
- The task home displays the run intent, correlation id, four capability cards, and a clear human gate.

## Verification

- `node --check app/static/app.js`: passed
- `node --test tests/frontend_contracts.test.cjs`: 162 passed
- `python -m pytest -q tests/test_agent_runtime.py tests/test_mcp_server.py tests/test_demo_mcp_script.py tests/test_start_demo.py tests/test_export.py`: 51 passed
- `git diff --check`: passed
- Chromium walkthrough at 1440px, 390px, and 320px: intent, correlation id, and all four tool capabilities visible after running the walkthrough
- Horizontal overflow: none (`scrollWidth === clientWidth` at all three widths)
- Browser console errors: 0
- HTTP 4xx/5xx responses: 0

Screenshots and machine-readable results are in this directory. No real
screen-reader test or live user pilot was performed. The web path is a
server-side MCP-compatible bridge for the showcase; the separately runnable
stdio sidecar remains available for a real external MCP client demonstration.
