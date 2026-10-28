import json
import math
import subprocess
import sys
from pathlib import Path

import pytest

from app.agents.review_evaluation import evaluate_cases, validate_dataset


def _case(case_id, expected="issue", *, category="normal", manual=None, gap=0):
    file = {"file_id": "f1", "slot": "report", "name": "report.txt", "pages": ["报告记载第 2 期"]}
    if gap:
        file["unread_pages"] = gap
    case = {
        "id": case_id,
        "category": category,
        "rule": {"id": "R1", "statement": "期次为第 1 期", "requirement_source": "报名要求"},
        "files": [file],
        "expected": {
            "result": expected,
            "evidence_quotes": [] if gap else [{"file_id": "f1", "quote": "报告记载第 2 期"}],
        },
    }
    if manual is not None:
        case["manual_review"] = manual
    return case


def test_validate_dataset_requires_authorization_and_bounds():
    with pytest.raises(ValueError, match="authorized_and_deidentified"):
        validate_dataset({"format_version": 1, "cases": [_case("a")]})
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [_case("a")]}
    assert len(validate_dataset(data)) == 1


@pytest.mark.parametrize("minutes", [math.nan, math.inf, -math.inf, True, 10**1000])
def test_validate_dataset_rejects_non_finite_or_boolean_review_time(minutes):
    data = {
        "format_version": 1,
        "authorization": "authorized_and_deidentified",
        "cases": [_case("a", manual={"minutes": minutes})],
    }
    with pytest.raises(ValueError, match="finite non-negative number"):
        validate_dataset(data)


def test_validate_dataset_rejects_review_time_totals_that_overflow():
    data = {
        "format_version": 1,
        "authorization": "authorized_and_deidentified",
        "cases": [
            _case("a", manual={"minutes": 1e308}),
            _case("b", manual={"minutes": 1e308}),
        ],
    }
    with pytest.raises(ValueError, match="total manual review time must remain finite"):
        validate_dataset(data)


def test_validate_dataset_requires_gold_quotes_to_match_the_named_source_file():
    case = _case("a")
    case["expected"]["evidence_quotes"] = [{"file_id": "f1", "quote": "另一份材料里的原文"}]
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [case]}
    with pytest.raises(ValueError, match="locatable in their source file"):
        validate_dataset(data)


@pytest.mark.parametrize("manual", [
    {"final_result": ["issue"]},
    {"final_result": {}},
    {"final_result": "not-a-result"},
])
def test_validate_dataset_rejects_malformed_manual_final_result(manual):
    data = {
        "format_version": 1,
        "authorization": "authorized_and_deidentified",
        "cases": [_case("a", manual=manual)],
    }
    with pytest.raises(ValueError, match="manual_review.final_result"):
        validate_dataset(data)


@pytest.mark.parametrize("file_update", [
    {"file_id": "x" * 81},
    {"unread_pages": True},
    {"failed_pages": False},
])
def test_validate_dataset_bounds_file_context_and_requires_integer_coverage(file_update):
    case = _case("a")
    case["files"][0].update(file_update)
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [case]}
    with pytest.raises(ValueError, match="file_id|coverage counts"):
        validate_dataset(data)


@pytest.mark.parametrize("quotes", [
    [{"file_id": "f1", "quote": "报告记载第 2 期"}] * 51,
    [{"file_id": "f1", "quote": "x" * 2_001}],
    [{"file_id": "x" * 81, "quote": "报告记载第 2 期"}],
])
def test_validate_dataset_bounds_gold_evidence_context(quotes):
    case = _case("a")
    case["expected"]["evidence_quotes"] = quotes
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [case]}
    with pytest.raises(ValueError, match="expected.evidence_quotes"):
        validate_dataset(data)


def test_validate_dataset_rejects_boolean_format_version():
    data = {"format_version": True, "authorization": "authorized_and_deidentified", "cases": [_case("a")]}
    with pytest.raises(ValueError, match="format_version=1"):
        validate_dataset(data)


@pytest.mark.parametrize("context_update", [
    {"fields": {"description": "x" * 12_001}},
    {"members": ["x" * 12_001]},
    {"rule": {"id": "R1", "statement": "x" * 4_001, "requirement_source": "报名要求"}},
])
def test_validate_dataset_bounds_all_non_material_prompt_context(context_update):
    case = _case("a")
    case.update(context_update)
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [case]}
    with pytest.raises(ValueError, match="exceeds|length limits"):
        validate_dataset(data)


@pytest.mark.parametrize("context_update", [
    {"fields": []},
    {"members": ["张三", 3]},
])
def test_validate_dataset_rejects_invalid_prompt_context_shapes(context_update):
    case = _case("a")
    case.update(context_update)
    data = {"format_version": 1, "authorization": "authorized_and_deidentified", "cases": [case]}
    with pytest.raises(ValueError, match="fields must be an object"):
        validate_dataset(data)


def test_evaluation_reports_aggregate_quality_and_human_review(stub_llm):
    stub_llm.responses = [{
        "result": "issue", "explanation": "期次不一致",
        "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "报告记载第 2 期"}],
    }]
    cases = [_case("a", manual={"minutes": 3.5, "final_result": "satisfied"})]
    report = evaluate_cases(cases, stub_llm)
    assert report["cases"] == 1
    assert report["semantic_invocations"] == 1
    assert report["result_match_rate"] == 1
    assert report["issue_precision"] == 1
    assert report["issue_recall"] == 1
    assert report["citation_verification_rate"] == 1
    assert report["gold_reference_coverage"] == 1
    assert report["manual_correction_cases"] == 1
    assert report["human_review_minutes"] == 3.5
    assert "case_ids" not in report  # report contains aggregates only


def test_unread_pages_are_counted_as_unknown_without_model_call(stub_llm):
    report = evaluate_cases([_case("gap", expected="unknown", category="ocr_gap", gap=1)], stub_llm)
    assert report["result_match_rate"] == 1
    assert report["semantic_invocations"] == 0
    assert report["gold_reference_coverage"] is None
    assert report["by_category"]["ocr_gap"]["cases"] == 1
    assert stub_llm.calls == 0


def test_cli_validates_without_calling_model(tmp_path):
    dataset = tmp_path / "eval.json"
    dataset.write_text(json.dumps({
        "format_version": 1,
        "authorization": "authorized_and_deidentified",
        "cases": [_case("private-id")],
    }), encoding="utf-8")
    script = Path(__file__).resolve().parents[1] / "scripts" / "evaluate_review_agent.py"
    completed = subprocess.run(
        [sys.executable, str(script), str(dataset)], capture_output=True, text=True, check=False,
    )
    assert completed.returncode == 0, completed.stderr
    assert json.loads(completed.stdout) == {"validated_cases": 1, "model_called": False}
    assert "private-id" not in completed.stdout
