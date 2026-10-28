"""Validate or run the bounded review Agent evaluation on local input data."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from pydantic import ValidationError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.agents.review_evaluation import evaluate_cases, validate_dataset
from app.config import settings
from app.llm import get_client

MAX_DATASET_BYTES = 20 * 1024 * 1024


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path, help="local JSON dataset; never copied into the report")
    parser.add_argument("--run-model", action="store_true", help="explicitly call the configured model")
    args = parser.parse_args()
    try:
        if args.dataset.stat().st_size > MAX_DATASET_BYTES:
            raise ValueError(f"dataset exceeds {MAX_DATASET_BYTES} bytes")
        dataset = json.loads(args.dataset.read_text(encoding="utf-8"))
        cases = validate_dataset(dataset)
        if not args.run_model:
            print(json.dumps({"validated_cases": len(cases), "model_called": False}, ensure_ascii=False))
            return 0
        client = get_client()
        if not settings.llm_configured or not client.configured:
            raise ValueError("FORMFLOW_LLM_API_KEY is not configured; model evaluation was not started")
        report = evaluate_cases(cases, client)
        report["model_called"] = True
        report["interpretation"] = "Results apply only to this labeled evaluation set; not a general accuracy claim."
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 0
    except (OSError, ValueError, ValidationError, json.JSONDecodeError) as exc:
        print(f"evaluation error: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
