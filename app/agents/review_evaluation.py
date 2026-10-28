"""Run a bounded, aggregate-only evaluation on an authorized review dataset."""
from __future__ import annotations

from collections import defaultdict
import json
import math
from typing import Any

from .review_agent import CheckContext, FileInfo, _verify_quote, run_semantic_rule
from ..llm import LLMClient
from ..models import RESULT_FAILED, RESULT_ISSUE
from ..parsing import ParseResult
from ..schemas import Blueprint, RuleDef

ALLOWED_RESULTS = {"satisfied", "issue", "unknown"}
ALLOWED_CATEGORIES = {"normal", "injection", "ambiguous", "ocr_gap", "other"}
MAX_CASES = 100
MAX_FILES_PER_CASE = 10
MAX_PAGES_PER_FILE = 200
MAX_TEXT_CHARS_PER_CASE = 100_000
MAX_PROMPT_CONTEXT_CHARS = 12_000
MAX_FILE_ID_CHARS = 80
MAX_GOLD_QUOTES_PER_CASE = 50
MAX_GOLD_QUOTE_CHARS = 2_000


class _CountingClient:
    """Count semantic invocations without exposing prompt or response content."""

    def __init__(self, client: LLMClient):
        self.client = client
        self.calls = 0

    def chat_json(self, messages, temperature=0.1, deadline_monotonic=None):
        self.calls += 1
        return self.client.chat_json(messages, temperature=temperature,
                                     deadline_monotonic=deadline_monotonic)


def validate_dataset(data: Any) -> list[dict]:
    if (not isinstance(data, dict) or isinstance(data.get("format_version"), bool)
            or data.get("format_version") != 1):
        raise ValueError("dataset must be an object with format_version=1")
    if data.get("authorization") != "authorized_and_deidentified":
        raise ValueError("dataset must declare authorized_and_deidentified")
    cases = data.get("cases")
    if not isinstance(cases, list) or not 1 <= len(cases) <= MAX_CASES:
        raise ValueError(f"cases must contain 1-{MAX_CASES} entries")
    seen = set()
    total_review_minutes = 0.0
    for case in cases:
        if not isinstance(case, dict):
            raise ValueError("each case must be an object")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id.strip() or len(case_id) > 80 or case_id in seen:
            raise ValueError("case IDs must be unique, non-empty strings up to 80 characters")
        seen.add(case_id)
        if not isinstance(case.get("category", "other"), str) or case.get("category", "other") not in ALLOWED_CATEGORIES:
            raise ValueError("unsupported case category")
        expected = case.get("expected")
        if (not isinstance(expected, dict) or not isinstance(expected.get("result"), str)
                or expected["result"] not in ALLOWED_RESULTS):
            raise ValueError("expected.result must be satisfied, issue, or unknown")
        expected_quotes = expected.get("evidence_quotes", [])
        if not isinstance(expected_quotes, list) or len(expected_quotes) > MAX_GOLD_QUOTES_PER_CASE or any(
            not isinstance(item, dict) or not isinstance(item.get("file_id"), str)
            or not item["file_id"] or len(item["file_id"]) > MAX_FILE_ID_CHARS
            or not isinstance(item.get("quote"), str) or not item["quote"].strip()
            or len(item["quote"]) > MAX_GOLD_QUOTE_CHARS
            for item in expected_quotes
        ):
            raise ValueError(
                "expected.evidence_quotes must contain at most 50 file_id/quote objects "
                "with file IDs up to 80 and quotes up to 2000 characters"
            )
        rule = case.get("rule")
        if not isinstance(rule, dict) or not all(
            isinstance(rule.get(key), str) and rule[key].strip()
            for key in ("id", "statement", "requirement_source")
        ):
            raise ValueError("rule requires id, statement, and requirement_source")
        if len(rule["id"]) > 80 or any(
            len(rule[key]) > 4_000 for key in ("statement", "requirement_source")
        ):
            raise ValueError("rule fields exceed their length limits")
        fields = case.get("fields", {})
        members = case.get("members", [])
        if not isinstance(fields, dict) or not isinstance(members, list) or any(
            not isinstance(member, str) for member in members
        ):
            raise ValueError("fields must be an object and members must be a list of strings")
        prompt_context = json.dumps(
            {"rule": rule, "fields": fields, "members": members},
            ensure_ascii=False, allow_nan=False, separators=(",", ":"),
        )
        if len(prompt_context) > MAX_PROMPT_CONTEXT_CHARS:
            raise ValueError(
                f"rule and registration context exceeds {MAX_PROMPT_CONTEXT_CHARS} characters"
            )
        files = case.get("files")
        if not isinstance(files, list) or not 1 <= len(files) <= MAX_FILES_PER_CASE:
            raise ValueError(f"files must contain 1-{MAX_FILES_PER_CASE} entries")
        total_chars = 0
        file_ids = set()
        file_texts = {}
        for file in files:
            pages = file.get("pages") if isinstance(file, dict) else None
            if (not isinstance(file, dict) or not isinstance(file.get("file_id"), str)
                    or not file["file_id"] or len(file["file_id"]) > MAX_FILE_ID_CHARS
                    or file["file_id"] in file_ids
                    or not isinstance(file.get("name", "material"), str)
                    or not isinstance(file.get("slot", "material"), str)
                    or not isinstance(pages, list) or not 1 <= len(pages) <= MAX_PAGES_PER_FILE
                    or any(not isinstance(page, str) for page in pages)
                    or any(isinstance(file.get(key, 0), bool)
                           or not isinstance(file.get(key, 0), int) or file.get(key, 0) < 0
                           for key in ("unread_pages", "failed_pages"))):
                raise ValueError(
                    "each file requires a unique file_id up to 80 characters, slot, name, "
                    "and text pages with non-negative integer coverage counts"
                )
            file_ids.add(file["file_id"])
            total_chars += sum(map(len, pages))
            file_texts[file["file_id"]] = "\n".join(pages)
        if total_chars > MAX_TEXT_CHARS_PER_CASE:
            raise ValueError(f"case text exceeds {MAX_TEXT_CHARS_PER_CASE} characters")
        if any(item["file_id"] not in file_ids for item in expected_quotes):
            raise ValueError("expected evidence quote references an unknown file_id")
        if any(_verify_quote(item["quote"], {item["file_id"]: file_texts[item["file_id"]]})
               != item["file_id"] for item in expected_quotes):
            raise ValueError("expected evidence quotes must be locatable in their source file")
        manual = case.get("manual_review", {})
        if not isinstance(manual, dict):
            raise ValueError("manual_review must be an object")
        minutes = manual.get("minutes")
        if minutes is not None:
            if isinstance(minutes, bool) or not isinstance(minutes, (int, float)):
                raise ValueError("manual_review.minutes must be a finite non-negative number")
            try:
                numeric_minutes = float(minutes)
            except (OverflowError, ValueError):
                numeric_minutes = math.inf
            if not math.isfinite(numeric_minutes) or numeric_minutes < 0:
                raise ValueError("manual_review.minutes must be a finite non-negative number")
            total_review_minutes += numeric_minutes
            if not math.isfinite(total_review_minutes):
                raise ValueError("total manual review time must remain finite")
        final_result = manual.get("final_result")
        if final_result is not None and (
            not isinstance(final_result, str) or final_result not in ALLOWED_RESULTS
        ):
            raise ValueError("manual_review.final_result must be satisfied, issue, or unknown")
    return cases


def evaluate_cases(cases: list[dict], client: LLMClient) -> dict:
    totals = defaultdict(int)
    groups: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    counting_client = _CountingClient(client)
    expected_issues = detected_issues = 0
    predicted_issues = matched_reference_quotes = expected_reference_quotes = 0
    correction_minutes = 0.0
    correction_labeled = 0
    for case in cases:
        rule = RuleDef(
            id=case["rule"]["id"], statement=case["rule"]["statement"],
            requirement_source=case["rule"]["requirement_source"], executor="semantic",
        )
        files = [FileInfo(
            file_id=item["file_id"], slot=item.get("slot", "material"),
            original_name=item.get("name", "material"), size=0,
            parse=ParseResult(pages=item["pages"], unread_pages=item.get("unread_pages", 0),
                              failed_pages=item.get("failed_pages", 0)),
        ) for item in case["files"]]
        context = CheckContext(
            blueprint=Blueprint(), fields=case.get("fields", {}),
            members=case.get("members", []), files=files,
        )
        before = counting_client.calls
        result = run_semantic_rule(rule, context, client=counting_client)
        totals["semantic_invocations"] += counting_client.calls - before
        expected = case["expected"]["result"]
        category = case.get("category", "other")
        group = groups[category]
        group["cases"] += 1
        matched = result.result == expected
        group["matches"] += matched
        totals["cases"] += 1
        totals["matches"] += matched
        totals["failed"] += result.result == RESULT_FAILED
        expected_issues += expected == RESULT_ISSUE
        detected_issues += expected == RESULT_ISSUE and result.result == RESULT_ISSUE
        predicted_issues += result.result == RESULT_ISSUE
        evidence = result.evidence
        file_texts = {f.file_id: "\n".join(f.parse.pages) for f in files}
        valid_count = sum(
            _verify_quote(item.quote, file_texts) == item.file_id
            for item in evidence
        )
        totals["citations"] += len(evidence)
        totals["valid_citations"] += valid_count
        group["citations"] += len(evidence)
        group["valid_citations"] += valid_count
        gold_quotes = case["expected"].get("evidence_quotes", [])
        matched_reference_quotes += sum(
            _verify_quote(gold["quote"], {gold["file_id"]: " ".join(
                item.quote for item in evidence if item.file_id == gold["file_id"]
            )})
            == gold["file_id"]
            for gold in gold_quotes
        )
        expected_reference_quotes += len(gold_quotes)
        manual = case.get("manual_review", {})
        if manual.get("minutes") is not None:
            correction_labeled += 1
            correction_minutes += manual["minutes"]
            totals["manual_corrections_labeled"] += 1
            final_result = manual.get("final_result", expected)
            totals["manual_correction_cases"] += final_result != result.result
    return {
        "cases": totals["cases"],
        "semantic_invocations": totals["semantic_invocations"],
        "result_match_rate": _rate(totals["matches"], totals["cases"]),
        "issue_precision": _rate(detected_issues, predicted_issues),
        "issue_recall": _rate(detected_issues, expected_issues),
        "failed_cases": totals["failed"],
        "citation_verification_rate": _rate(totals["valid_citations"], totals["citations"]),
        "citation_count": totals["citations"],
        "gold_reference_coverage": _rate(matched_reference_quotes, expected_reference_quotes),
        "gold_reference_quotes": expected_reference_quotes,
        "manual_correction_cases": totals["manual_correction_cases"],
        "human_review_minutes": round(correction_minutes, 2),
        "manual_review_labeled_cases": correction_labeled,
        "by_category": {
            category: {
                "cases": values["cases"],
                "result_match_rate": _rate(values["matches"], values["cases"]),
                "citation_verification_rate": _rate(values["valid_citations"], values["citations"]),
            }
            for category, values in sorted(groups.items())
        },
    }


def _rate(numerator: int | float, denominator: int | float) -> float | None:
    return round(numerator / denominator, 4) if denominator else None
