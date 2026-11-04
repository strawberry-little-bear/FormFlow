# Round 23: Runtime Contract Version

Date: 2026-10-25

## Change

- Added `contract_version: 1` to the organizer Agent runtime manifest.
- The frontend now rejects a manifest with a missing or unsupported contract version and keeps the local static explanation visible.
- A Chinese status warns that the API and page versions differ and instructs the operator to restart the API before refreshing. The warning is retained across the offline status repaint on both the task workspace and design page.
- Updated the static MCP fallback text to list all four read-only sidecar tools and its data boundary.

## Browser Verification

Tested the existing API at `127.0.0.1:8000` read-only and the isolated fictional seed database at `127.0.0.1:8001` with an empty model key.

| Port | API response | Workspace | Design page |
| --- | --- | --- | --- |
| 8000 | Legacy manifest, no contract version, 3 MCP tools | Shows version mismatch and restart instruction | Shows the same warning |
| 8001 | Contract version 1, 4 MCP tools | Loads current manifest; accurately reports offline demo mode | Retains the no-model-key status |

Screenshots: `port-8000.png`, `port-8001.png`.

## Automated Checks

- `python -m pytest tests/test_agent_runtime.py tests/test_mcp_server.py -q`: 9 passed.
- `node --test tests/frontend_contracts.test.cjs`: 155 passed.
- `node --check app/static/app.js`: passed.
- `git diff --check`: passed (Git emitted existing LF-to-CRLF working-copy notices).

This round does not claim a full user pilot, model quality evaluation on authorized real samples, accessibility sign-off with a screen reader, or production readiness.
