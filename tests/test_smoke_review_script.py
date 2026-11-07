"""Keep the local review smoke stub aligned with the production LLM contract."""
from __future__ import annotations

import json
import time

from scripts.smoke_review import StubLLM


def test_smoke_review_stub_accepts_run_deadline():
    payload = StubLLM().chat(
        [{"role": "user", "content": "【规则】姓名一致\n姓名：张三"}],
        deadline_monotonic=time.monotonic() + 1,
    )

    assert json.loads(payload)["result"] == "satisfied"
