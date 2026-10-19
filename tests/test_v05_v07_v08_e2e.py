# -*- coding: utf-8 -*-
"""V05 / V07 / V08 \u7aef\u5230\u7aef\uff1a\u6b63\u5e38\u56e2\u8bfe PDF\u3001\u59d3\u540d\u6a21\u7cca OCR \u8bef\u8bc6\u3001\u81ea\u7531\u6587\u6863\u4e00\u9875\u672a\u8bfb\u3002

\u65b9\u6848\u9644\u5f55 A \u9996\u6279\u4e1a\u52a1\u6d4b\u8bd5\u89c4\u683c\uff1a
- V05 \u6b63\u5e38\u56e2\u8bfe PDF\uff0c\u59d3\u540d\u671f\u6b21\u8981\u7d20\u9f50\u5168
  \u9884\u671f\uff1a\u9010\u89c4\u5219\u8bc1\u636e\uff0c\u89c4\u5219\u901a\u8fc7\u540e\u5f85\u4eba\u5de1\u9a8c\u6536\u3002\u8bc1\u636e\uff1a\u4eba\u5de5\u7b54\u6848\u3001\u5f15\u7528\u3001\u51b3\u5b9a\u3002
- V07 \u59d3\u540d\u533a\u57df\u6a21\u7cca\uff0cOCR \u8bef\u8bc6\u522b
  \u9884\u671f\uff1aC-R02 unknown\uff0c\u4e0d\u5224\u672a\u586b\u5199\uff1b\u53ef\u7533\u8bf9\u3002\u8bc1\u636e\uff1a\u533a\u57df\u3001\u63d0\u53d6\u65b9\u5f8f\u3001\u4eba\u5de5\u7b54\u6848\u3002
- V08 \u81ea\u7531\u6587\u6863\u7f3a\u8981\u7d20\u4f46\u4e00\u9875\u672a\u8bfb
  \u9884\u671f\uff1a\u4e0d\u8f93\u51fa\u786e\u8ba4\u7f3a\u5931\uff1b\u8986\u76d6\u7f3a\u53e3\u53ef\u89c1\u3002\u8bc1\u636e\uff1acoverage\u3001\u672a\u8bfb/\u5931\u8d25\u9875\u3002

\u5168\u90e8\u53ea\u8dd1\u786e\u5b9a\u6027\u94fe\u8def + \u672c\u5730\u6869 LLM\uff08StubLLM\uff09\uff0c\u4e0d\u8bbf\u95ee\u5916\u90e8\u6a21\u578b\u7f51\u5173\u3002
\u6837\u672c\u7531 scripts/make_samples.py \u751f\u6210\uff1ablur_name.pdf \u59d3\u540d\u884c\u9ad8\u65af\u6a21\u7cca\u3001
partial.pdf \u7b2c 2 \u9875\u4e3a\u56fe\u7247\u9875\uff1bOCR \u4e3a\u771f\u5b9e\u5f15\u64ce\uff0c\u4e0d\u662f\u6a21\u62df\u3002
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.agents.requirements_agent import template_blueprint
from app.config import settings
from app.models import (RESULT_ISSUE, RESULT_SATISFIED, RESULT_UNKNOWN, Evidence,
                        RuleResult, Subject)
from app.parsing import parse_file
from app.schemas import RuleDef
from app.services import decisions as dec
from app.services import submissions as sub
from app.services.checks import create_run, current_summary, execute_run
from app.storage import file_dir
from tests.conftest import StubLLM, make_task, publish_blueprint

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"

NAME_QUOTE = "\u59d3\u540d\uff1a\u5f20\u4e09"
TERM_QUOTE = "\u671f\u6b21\uff1a2026 \u79cb\u5b63\u7b2c 1 \u671f"
# \u56fe\u7247\u9875 OCR \u4f1a\u628a\u5168\u89d2\u5192\u53f7\u4e0e\u7a7a\u683c\u8bfb\u6563\uff1b_norm \u5f52\u4e00\u5316\u540e\u4ecd\u80fd\u5b9a\u4f4d
OCR_TERM_QUOTE = "\u671f\u6b21 : 2 0 2 6"


@pytest.fixture(scope="module", autouse=True)
def _ensure_samples():
    missing = [n for n in ("normal.pdf", "blur_name.pdf", "partial.pdf")
               if not (SAMPLES / n).exists()]
    if missing:
        import scripts.make_samples as ms

        ms.main()


def _blueprint():
    """\u56e2\u8bfe\u62a5\u544a\u84dd\u56fe\uff1aC-R01 \u6750\u6599\u7ea6\u675f / C-R02 \u59d3\u540d / C-R03 \u671f\u6b21 / C-R04 \u5185\u5bb9\u8981\u7d20\u3002

    C-R04 \u6309\u65b9\u6848\u8868 15\u300c\u81ea\u7531\u8bed\u4e49\u7f3a\u5931\u9ed8\u8ba4\u4eba\u5de5\u786e\u8ba4\u300d\u5efa\u6a21\u4e3a human_only\uff1a
    \u4e0d\u81ea\u52a8\u5224\u5b9a\uff0c\u53ea\u8fdb\u4eba\u5de5\u961f\u5217\uff0c\u7531\u7ec4\u7ec7\u8005\u663e\u5f0f\u51b3\u5b9a\u3002
    """
    bp = template_blueprint("class_report")
    bp.rules = [
        RuleDef(id="C-R01", statement="\u62a5\u544a\u9875\u6570/\u683c\u5f0f/\u5927\u5c0f\u7b26\u5408\u69fd\u4f4d\u8981\u6c42",
                requirement_source="\u69fd\u4f4d\u7ea6\u675f", executor="deterministic",
                check={"kind": "slot_constraints", "slot": "report"}),
        RuleDef(id="C-R02", statement="\u62a5\u544a\u9875\u5199\u660e\u59d3\u540d\u5e76\u4e0e\u767b\u8bb0\u59d3\u540d\u4e00\u81f4",
                requirement_source="\u539f\u59cb\u8981\u6c42\uff1a\u59d3\u540d\u4e0e\u540d\u518c\u4e00\u81f4",
                executor="semantic"),
        RuleDef(id="C-R03", statement="\u62a5\u544a\u671f\u6b21\u987b\u4e0e\u767b\u8bb0\u671f\u6b21\u4e00\u81f4",
                requirement_source="\u539f\u59cb\u8981\u6c42\uff1a\u671f\u6b21\u4e0e\u767b\u8bb0\u4e00\u81f4",
                executor="semantic"),
        RuleDef(id="C-R04", statement="\u62a5\u544a\u5305\u542b\u6d3b\u52a8\u5185\u5bb9\u4e0e\u4e2a\u4eba\u6536\u83b7",
                requirement_source="\u539f\u59cb\u8981\u6c42\uff1a\u5185\u5bb9\u8981\u7d20\u9f50\u5168",
                executor="human_only"),
    ]
    return bp


def _setup(db):
    now = datetime.now(timezone.utc)
    task = make_task(db, name="\u56e2\u8bfe\u62a5\u544a\u6536\u96c6", mode="roster",
                     subject_kind="individual",
                     open_at=now - timedelta(days=1),
                     first_deadline=now + timedelta(days=7),
                     correction_deadline=now + timedelta(days=14))
    publish_blueprint(db, task, _blueprint())
    subject = Subject(task_id=task.id, kind="individual", display_name="\u5f20\u4e09")
    db.add(subject)
    db.flush()
    submission = sub.get_or_create_draft(db, task, subject.id)
    return task, subject, submission


def _attach(db, submission, filename, slot="report"):
    return sub.attach_file(db, submission, slot=slot, original_name=filename,
                           content=(SAMPLES / filename).read_bytes(),
                           sha256="", mime="application/octet-stream")


def _run(db, task, submission, fields, key, file_ids, client, correction=False):
    rev = sub.formal_submit(db, task, submission, fields=fields,
                            slot_file_ids={"report": list(file_ids)},
                            idempotency_key=key, is_correction=correction or None)
    run = create_run(db, task, rev)
    execute_run(db, run, client=client)
    results = {r.rule_id: r for r in db.scalars(select(RuleResult).where(
        RuleResult.run_id == run.id)).all()}
    return rev, run, results


def _evidences(db, rule_result_id):
    return db.scalars(select(Evidence).where(
        Evidence.rule_result_id == rule_result_id)).all()

# ---------------------------------------------------------------- V05
def test_v05_normal_pdf_all_elements_evidence_then_manual_accept(db_session):
    """V05\uff1a\u8981\u7d20\u9f50\u5168\u7684\u6b63\u5e38 PDF \u2192 \u9010\u89c4\u5219\u8bc1\u636e\uff0c\u89c4\u5219\u901a\u8fc7\u540e\u5f85\u4eba\u5de1\u9a8c\u6536\u3002"""
    task, subject, submission = _setup(db_session)
    f = _attach(db_session, submission, "normal.pdf")
    stub = StubLLM(responses=[
        {"result": "satisfied",
         "explanation": "\u62a5\u544a\u7b2c 1 \u9875\u59d3\u540d\u4e0e\u767b\u8bb0\u59d3\u540d\u4e00\u81f4\uff08\u5f20\u4e09\uff09",
         "evidence": [{"quote": NAME_QUOTE, "locator": "p.1"}]},
        {"result": "satisfied",
         "explanation": "\u62a5\u544a\u671f\u6b21\u4e0e\u767b\u8bb0\u671f\u6b21\u4e00\u81f4\uff082026 \u79cb\u5b63\u7b2c 1 \u671f\uff09",
         "evidence": [{"quote": TERM_QUOTE, "locator": "p.1"}]},
    ])
    _rev, run, results = _run(
        db_session, task, submission,
        {"name": "\u5f20\u4e09", "term": "2026 \u79cb\u5b63\u7b2c 1 \u671f", "class_name": "\u4e00\u73ed"},
        "k-v05", [f.file_id], stub)

    # \u9010\u89c4\u5219\u8bc1\u636e\uff1a\u7a0b\u5e8f\u89c4\u5219 + \u8bed\u4e49\u89c4\u5219\u5404\u6709\u7ed3\u8bba
    assert set(results) == {"C-R01", "C-R02", "C-R03"}
    assert results["C-R01"].result == RESULT_SATISFIED
    assert results["C-R02"].result == RESULT_SATISFIED
    assert results["C-R03"].result == RESULT_SATISFIED
    # C-R04 \u5185\u5bb9\u8981\u7d20\u9ed8\u8ba4\u4eba\u5de5\u786e\u8ba4\uff1a\u4e0d\u81ea\u52a8\u8dd1\uff0c\u4e0d\u4ea7\u751f\u7ed3\u8bba
    assert "C-R04" not in results
    assert stub.calls == 2
    assert run.pages_read == 1

    # \u5f15\u7528\u8bc1\u636e\uff1a\u80fd\u5728\u539f\u6587\u5b9a\u4f4d\uff0c\u65b9\u6cd5\u4e3a llm
    for rid, quote in (("C-R02", NAME_QUOTE), ("C-R03", TERM_QUOTE)):
        evs = _evidences(db_session, results[rid].id)
        assert len(evs) == 1
        assert evs[0].method == "llm" and evs[0].quote == quote
        assert evs[0].locator == "p.1"

    summary = current_summary(db_session, task, subject.id)
    assert summary["summary"] == "\u5f85\u4eba\u5de5"
    assert summary["acceptance"] == "pending"
    assert summary["buckets"]["blocking"] == []
    assert summary["buckets"]["unknown"] == []
    assert summary["buckets"]["human"] == ["C-R04"]
    # \u8986\u76d6\u5b8c\u6574\uff0c\u63d0\u53d6\u65b57f\u4e3a\u6587\u5b57\u5c42
    assert summary["coverage"]["complete"] is True
    assert summary["coverage"]["files"][0]["method"] == "text"
    assert summary["coverage"]["files"][0]["unread"] == 0

    # \u4eba\u5de5\u9879\u5c1a\u672a\u5904\u7f6e\u65f6\u4e0d\u80fd\u76f4\u63a5\u9a8c\u6536\uff08\u4e0d\u662f\u4e00\u952e\u9759\u9ed8\u9a8c\u6536\uff09
    with pytest.raises(dec.DecisionError):
        dec.record_decision(db_session, task, subject, decision="accept_current",
                            reason="\u770b\u7740\u6ca1\u95ee\u9898")

    # \u4eba\u5de5\u7b54\u6848 + \u51b3\u5b9a\u7559\u75d5\uff0c\u518d\u9a8c\u6536
    dec.record_decision(db_session, task, subject, decision="confirm_issue",
                        scope_rule_id="C-R04",
                        reason="\u5df2\u4eba\u5de5\u9605\u8bfb\u5168\u6587\uff0c\u6d3b\u52a8\u5185\u5bb9\u4e0e\u4e2a\u4eba\u6536\u83b7\u9f50\u5168\uff08V05 \u4eba\u5de5\u786e\u8ba4\uff09")
    dec.record_decision(db_session, task, subject, decision="accept_current",
                        reason="\u89c4\u5219\u9010\u6761\u901a\u8fc7\u3001\u4eba\u5de5\u786e\u8ba4\u5b8c\u6210\uff0c\u9a8c\u6536\u5f53\u524d\u7248\u672c")
    after = current_summary(db_session, task, subject.id)
    assert after["summary"] == "\u5df2\u9a8c\u6536"
    assert after["acceptance"] == "accepted"
    # \u59d3\u540d\u53ea\u7528\u4e8e\u6838\u5bf9\uff0c\u4e0d\u4f5c\u4e3a\u8d44\u683c\u6743\u9650\uff1a\u4e0d\u4f1a\u88ab\u81ea\u52a8\u63a8\u4e3a\u5408\u683c
    assert subject.eligibility == "not_assessed"

# ---------------------------------------------------------------- V07
def test_v07_blurred_name_ocr_misread_is_unknown_not_missing(db_session):
    """V07\uff1a\u59d3\u540d\u533a\u57df\u6a21\u7cca\u3001\u771f\u5b9e OCR \u8bef\u8bc6\u522b \u2192 C-R02 unknown\uff0c\u4e0d\u5224\u672a\u586b\u5199\uff0c\u53ef\u7533\u8bf9\u3002"""
    from app.models import FileObject
    from app.storage import file_dir

    task, subject, submission = _setup(db_session)
    f = _attach(db_session, submission, "blur_name.pdf")

    # \u5148\u8bc1\u660e\u8fd9\u662f\u771f\u5b9e\u7684 OCR \u8bef\u8bc6\u522b\uff0c\u800c\u4e0d\u662f\u6a21\u62df\uff1a\u59d3\u540d\u884c\u5df2\u4ece\u63d0\u53d6\u7ed3\u679c\u4e2d\u6d88\u5931\uff0c\u5176\u4f59\u8981\u7d20\u4ecd\u53ef\u8bfb
    fo = db_session.get(FileObject, f.id)
    parsed = parse_file(file_dir(f.file_id) / f"original_{fo.safe_name}")
    assert parsed.method == "ocr"
    joined = "\n".join(parsed.pages)
    assert "\u5f20\u4e09" not in joined
    assert "\u671f\u6b21" in joined and "\u6d3b\u52a8\u5185\u5bb9" in joined

    stub = StubLLM(responses=[
        {"result": "unknown",
         "explanation": "\u59d3\u540d\u533a\u57df\u6a21\u7cca\uff0c\u65e0\u6cd5\u786e\u8ba4\u59d3\u540d\u662f\u5426\u4e3a\u5f20\u4e09\uff1b\u4e0d\u5224\u672a\u586b\u5199\uff0c\u8f6c\u4eba\u5de5\u786e\u8ba4",
         "next_step": "\u7533\u8bf9\u6216\u7535\u8bdd\u786e\u8ba4\u59d3\u540d\u540e\u7531\u7ec4\u7ec7\u8005\u5904\u7f6e",
         "evidence": [{"quote": OCR_TERM_QUOTE,
                       "locator": "p.1 \u59d3\u540d\u533a\u57df\uff08\u6a21\u7cca\uff0cOCR \u8bef\u8bc6\u522b\uff09"}]},
        {"result": "satisfied",
         "explanation": "\u62a5\u544a\u671f\u6b21\u4e0e\u767b\u8bb0\u671f\u6b21\u4e00\u81f4",
         "evidence": [{"quote": OCR_TERM_QUOTE, "locator": "p.1"}]},
    ])
    _rev, run, results = _run(
        db_session, task, submission,
        {"name": "\u5f20\u4e09", "term": "2026 \u79cb\u5b25\u7b2c 1 \u671f", "class_name": "\u4e00\u73ed"},
        "k-v07", [f.file_id], stub)

    r02 = results["C-R02"]
    assert r02.result == RESULT_UNKNOWN
    # \u4e0d\u5f97\u628a\u201c\u8bfb\u4e0d\u5230\u201d\u8bf4\u6210\u201c\u6ca1\u586b\u201d\uff1a\u5426\u5b9a\u53e5\u5fc5\u987b\u5728\uff0c\u80cc\u4e66\u4e0d\u5f97\u5728
    assert "\u4e0d\u5224\u672a\u586b\u5199" in r02.explanation
    assert "\u786e\u8ba4\u672a\u586b\u5199" not in r02.explanation
    assert "\u5224\u4e3a\u672a\u586b\u5199" not in r02.explanation
    assert "\u786e\u8ba4\u7f3a\u5931" not in r02.explanation
    assert "\u6a21\u7cca" in r02.explanation and "\u4eba\u5de5" in r02.explanation
    # \u53ef\u7533\u8bf9\uff1a\u7ed9\u51fa\u884c\u52a8\u8def\u5f84
    assert "\u7533\u8bf9" in (r02.next_step or "") or "\u4eba\u5de5" in (r02.next_step or "")
    assert results["C-R03"].result == RESULT_SATISFIED

    # \u8bc1\u636e\uff1a\u533a\u57df + \u63d0\u53d6\u65b57f\uff08\u65b9\u6848 V07 \u8981\u6c42\u7684\u4e09\u9879\u91cc\u7684\u524d\u4e24\u9879\uff09
    evs = _evidences(db_session, r02.id)
    assert len(evs) == 1 and evs[0].method == "llm"
    assert "\u59d3\u540d\u533a\u57df" in evs[0].locator and "\u6a21\u7cca" in evs[0].locator
    coverage = current_summary(db_session, task, subject.id)["coverage"]
    assert coverage["files"][0]["method"] == "ocr"   # \u63d0\u53d6\u65b57f\u53ef\u89c1

    summary = current_summary(db_session, task, subject.id)
    assert summary["buckets"]["unknown"] == ["C-R02"]
    assert summary["buckets"]["blocking"] == []
    assert summary["summary"] == "\u5f85\u4eba\u5de5"

    # unknown \u963b\u585e\u9a8c\u6536\uff1a\u5fc5\u987b\u5148\u7533\u8bf9/\u7ea0\u6b63\u8bef\u62a5\uff0c\u4e0d\u80fd\u4e00\u70b9\u5c31\u8fc7
    with pytest.raises(dec.DecisionError):
        dec.record_decision(db_session, task, subject, decision="accept_current",
                            reason="\u5e94\u8be5\u8fc7\u4e0d\u4e86\u5427")
    dec.record_decision(db_session, task, subject, decision="correct_false_positive",
                        scope_rule_id="C-R02",
                        reason="\u7533\u8bf9\u6210\u7acb\uff1a\u539f\u4ef6\u59d3\u540d\u533a\u57df\u6a21\u7cca\u5bfc\u81f4 OCR \u8bef\u8bc6\u522b\uff0c"
                               "\u7ec4\u7ec7\u8005\u7ed3\u5408\u539f\u4ef6\u786e\u8ba4\u59d3\u540d\u4e3a\u5f20\u4e09\uff08V07\uff09")
    dec.record_decision(db_session, task, subject, decision="confirm_issue",
                        scope_rule_id="C-R04",
                        reason="\u5df2\u4eba\u5de5\u9605\u8bfb\u5168\u6587\uff0c\u6d3b\u52a8\u5185\u5bb9\u4e0e\u4e2a\u4eba\u6536\u83b7\u9f50\u5168")
    dec.record_decision(db_session, task, subject, decision="accept_current",
                        reason="\u7533\u8bf9\u5df2\u5904\u7f6e\u3001\u89c4\u5219\u9010\u6761\u901a\u8fc7\uff0c\u9a8c\u6536\u5f53\u524d\u7248\u672c")
    after = current_summary(db_session, task, subject.id)
    assert after["summary"] == "\u5df2\u9a8c\u6536"
    # \u4e0d\u4ee5\u59d3\u540d\u4f5c\u4e3a\u8d44\u683c\uff1a\u7533\u8bf9\u901a\u8fc7\u4e5f\u4e0d\u81ea\u52a8\u6539\u53d8\u8d44\u683c
    assert subject.eligibility == "not_assessed"

# ---------------------------------------------------------------- V08
def test_v08_unread_page_never_confirms_missing_and_gap_is_visible(db_session, monkeypatch):
    """V08\uff1a\u4e00\u9875\u672a\u8bfb \u2192 \u4e0d\u8f93\u51fa\u201c\u786e\u8ba4\u7f3a\u5931\u201d\uff0c\u8986\u76d6\u7f3a\u53e3\u53ef\u89c1\uff0c\u4e14\u4e0d\u6d6a\u8d39\u6a21\u578b\u8c03\u7528\u3002"""
    from app.models import FileObject
    from app.storage import file_dir

    # \u786e\u5b9a\u6027\u590d\u73b0\uff1a\u7981\u7528 OCR \u540e\uff0c\u7b2c 2 \u9875\uff08\u56fe\u7247\u9875\uff09\u8ba1\u5165\u672a\u8bfb
    monkeypatch.setattr(settings, "max_ocr_pages_per_file", 0)

    task, subject, submission = _setup(db_session)
    f = _attach(db_session, submission, "partial.pdf")
    fo = db_session.get(FileObject, f.id)
    parsed = parse_file(file_dir(f.file_id) / f"original_{fo.safe_name}")
    assert parsed.total_pages == 2 and parsed.unread_pages == 1
    assert parsed.coverage_complete is False

    stub = StubLLM()
    _rev, run, results = _run(
        db_session, task, submission,
        {"name": "\u5f20\u4e09", "term": "2026 \u79cb\u5b63\u7b2c 1 \u671f", "class_name": "\u4e00\u73ed"},
        "k-v08", [f.file_id], stub)

    # \u8986\u76d6\u4e0d\u8db3\u65f6\u4e0d\u5e94\u8be5\u53bb\u95ee\u6a21\u578b\uff1a\u96f6\u8c03\u7528
    assert stub.calls == 0

    # \u7a0b\u5e8f\u89c4\u5219\u4ecd\u80fd\u7ed9\u7ed3\u8bba\uff08\u53ea\u770b\u6570\u91cf/\u9875\u6570\uff09
    assert results["C-R01"].result == RESULT_SATISFIED
    assert results["C-R01"].explanation.startswith("\u69fd\u4f4d report")

    for rid in ("C-R02", "C-R03"):
        r = results[rid]
        assert r.result == RESULT_UNKNOWN
        assert "\u672a\u8bfb" in r.explanation
        assert "\u4e0d\u5224\u672a\u586b\u5199" in r.explanation and "\u4e0d\u786e\u8ba4\u7f3a\u5931" in r.explanation
        # \u7edd\u4e0d\u628a\u201c\u6ca1\u8bfb\u5230\u201d\u5199\u6210\u201c\u786e\u8ba4\u7f3a\u5931\u201d
        assert "\u786e\u8ba4\u7f3a\u5931" not in r.explanation.replace(
            "\u4e0d\u786e\u8ba4\u7f3a\u5931", "")
        # \u8986\u76d6\u8bc1\u636e\uff1a\u672a\u8bfb\u9875\u6570\u91cf\u5316\u544a\u77e5
        evs = _evidences(db_session, r.id)
        assert len(evs) == 1 and evs[0].method == "coverage"
        assert "\u672a\u8bfb 1 \u9875" in evs[0].quote
        assert evs[0].locator == "pages 1-2"

    # \u6ca1\u6709\u4efb\u4f55\u89c4\u5219\u88ab\u5224\u4e3a\u95ee\u9898\uff08\u4e0d\u5236\u9020\u8655\u5a01\uff09
    assert not [r for r in results.values() if r.result == RESULT_ISSUE]

    summary = current_summary(db_session, task, subject.id)
    assert summary["coverage"]["unread_pages"] == 1
    assert summary["coverage"]["failed_pages"] == 0
    assert summary["coverage"]["complete"] is False
    assert summary["coverage"]["files"][0]["unread"] == 1
    assert summary["coverage"]["files"][0]["total"] == 2
    assert summary["summary"] == "\u5f85\u4eba\u5de5"
    # \u8fd0\u884c\u7ea7\u8986\u76d6\u843d\u5e93\uff0c\u53ef\u88ab\u524d\u7aef\u76f4\u63a5\u5c55\u793a
    import json
    stored = json.loads(run.coverage_json)
    assert stored[f.file_id]["unread"] == 1 and stored[f.file_id]["failed"] == 0

    # \u8865\u6b63\u8def\u5f84\uff1a\u6362\u6210\u8986\u76d6\u5b8c\u6574\u7684\u6750\u6599\u540e\uff0c\u89c4\u5219\u53ef\u6b63\u5e38\u51fa\u7ed3\u8bba
    g = _attach(db_session, submission, "normal.pdf")
    stub2 = StubLLM(responses=[
        {"result": "satisfied", "explanation": "\u59d3\u540d\u4e00\u81f4",
         "evidence": [{"quote": NAME_QUOTE, "locator": "p.1"}]},
        {"result": "satisfied", "explanation": "\u671f\u6b21\u4e00\u81f4",
         "evidence": [{"quote": TERM_QUOTE, "locator": "p.1"}]},
    ])
    rev2, run2, results2 = _run(
        db_session, task, submission,
        {"name": "\u5f20\u4e09", "term": "2026 \u79cb\u5b63\u7b2c 1 \u671f", "class_name": "\u4e00\u73ed"},
        "k-v08-fix", [g.file_id], stub2, correction=True)
    assert rev2.version == 2
    assert results2["C-R02"].result == RESULT_SATISFIED
    cov2 = current_summary(db_session, task, subject.id)["coverage"]
    assert cov2["complete"] is True and cov2["unread_pages"] == 0
    # \u65e7\u8fd0\u884c\u7559\u75d5\uff0c\u4e0d\u88ab\u6539\u5199
    assert run.status == "success"
    assert run2.id != run.id
    assert json.loads(run.coverage_json)[f.file_id]["unread"] == 1

# ---------------------------------------------------------------- V08 \u7ec4\u7ec7\u8005\u89c6\u89d9
@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:  # \u89e6\u53fa lifespan\uff1ainit_db \u5efa\u8868
        yield c


def _register(client, username, password="pw123456"):
    r = client.post("/api/accounts", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def _mk_task(client, headers, name="\u56e2\u8bfe\u62a5\u544a\u6536\u96c6"):
    r = client.post("/api/tasks", data={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def test_v08_api_findings_shows_coverage_gap_to_organizer(client, db_session, monkeypatch):
    """V08 \u7ec4\u7ec7\u8005\u89c6\u89d9\uff1a\u590d\u6838\u9875\u80fd\u770b\u5230\u672a\u8bfb\u9875\u4e0e\u63d0\u53d6\u65b57f\uff0c\u4e0d\u628a\u201c\u6ca1\u8bfb\u5230\u201d\u53d8\u6210\u201c\u786e\u8ba4\u7f3a\u5931\u201d\u3002"""
    from app.models import Task

    monkeypatch.setattr(settings, "max_ocr_pages_per_file", 0)
    headers = _register(client, "org-v08")
    task_id = _mk_task(client, headers)

    task = db_session.get(Task, task_id)
    now = datetime.now(timezone.utc)
    task.status = "collecting"
    task.open_at = now - timedelta(days=1)
    task.first_deadline = now + timedelta(days=7)
    task.correction_deadline = now + timedelta(days=14)
    publish_blueprint(db_session, task, _blueprint())
    subject = Subject(task_id=task.id, kind="individual", display_name="\u5f20\u4e09")
    db_session.add(subject)
    db_session.flush()
    submission = sub.get_or_create_draft(db_session, task, subject.id)
    f = _attach(db_session, submission, "partial.pdf")
    _run(db_session, task, submission,
         {"name": "\u5f20\u4e09", "term": "2026 \u79cb\u5b63\u7b2c 1 \u671f", "class_name": "\u4e00\u73ed"},
         "k-v08-api", [f.file_id], StubLLM())
    db_session.commit()

    r = client.get(f"/api/tasks/{task_id}/subjects/{subject.id}/findings", headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    run = body["run"]
    assert run is not None
    assert run["coverage"]["unread_pages"] == 1
    assert run["coverage"]["complete"] is False
    assert run["coverage"]["files"][0]["method"] == "text"
    assert run["coverage"]["files"][0]["unread"] == 1
    assert run["coverage"]["files"][0]["name"] == "partial.pdf"
    assert run["pages_read"] == 1
    # \u89c4\u5219\u7ed3\u8bba\u91cc\u6ca1\u6709\u201c\u786e\u8ba4\u7f3a\u5931\u201d\uff0c\u53ea\u6709 unknown
    by_id = {x["rule_id"]: x for x in body["rules"]}
    assert by_id["C-R02"]["result"] == "unknown"
    assert "\u4e0d\u786e\u8ba4\u7f3a\u5931" in by_id["C-R02"]["explanation"]
    assert [e["method"] for e in by_id["C-R02"]["evidence"]] == ["coverage"]
    assert all(x["result"] != "issue" for x in body["rules"])
