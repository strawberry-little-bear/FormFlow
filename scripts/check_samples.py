"""Fail clearly when generated parser fixtures are missing or empty."""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.make_samples import EXPECTED_FILES, OUT  # noqa: E402


def main() -> None:
    missing = [name for name in EXPECTED_FILES if not (OUT / name).is_file()]
    empty = [
        name
        for name in EXPECTED_FILES
        if (OUT / name).is_file() and (OUT / name).stat().st_size == 0
    ]
    if missing or empty:
        details = []
        if missing:
            details.append("missing: " + ", ".join(missing))
        if empty:
            details.append("empty: " + ", ".join(empty))
        raise SystemExit("parser fixtures missing or empty (" + "; ".join(details) + ")")
    print(f"verified {len(EXPECTED_FILES)} parser fixtures in {OUT}")


if __name__ == "__main__":
    main()
