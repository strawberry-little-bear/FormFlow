"""审核 Agent 测试：确定性检查、证据引用校验、覆盖缺口、预算、降级。"""
from __future__ import annotations

import json

from app.agents.review_agent import (
    CheckContext,
    FileInfo,
    _eval_condition,
    _verify_quote,
    run_checks,
    run_deterministic,
    run_semantic_rule,
)
from app.llm import LLMBudgetExceeded, LLMUnavailable
from app.models import (
    RESULT_FAILED,
    RESULT_ISSUE,
    RESULT_NOT_APPLICABLE,
    RESULT_SATISFIED,
    RESULT_UNKNOWN,
)
from app.parsing import ParseResult
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef


def _bp():
    return Blueprint(
        fields=[
            FieldDef(id="name", label="姓名"),
            FieldDef(id="term", label="期次"),
            FieldDef(id="track", label="赛道", type="enum", options=["数字", "实物"]),
        ],
        slots=[
            SlotDef(id="report", label="报告", formats=["pdf"], max_count=1, max_size_mib=10, max_pages=20),
            SlotDef(id="photo", label="照片", formats=["jpg"], max_count=3, required_condition="track==实物"),
        ],
        rules=[
            RuleDef(id="C-R01", statement="材料约束", requirement_source="s",
                    executor="deterministic", check={"kind": "slot_constraints", "slot": "report"}),
            RuleDef(id="T-R01", statement="团队 2-5 人", requirement_source="s",
                    executor="deterministic", check={"kind": "team_size", "min": 2, "max": 5}),
            RuleDef(id="T-R02", statement="联系人是成员", requirement_source="s",
                    executor="deterministic", check={"kind": "contact_in_members", "field": "name"}),
            RuleDef(id="T-R03", statement="条件材料", requirement_source="s",
                    executor="deterministic", check={"kind": "slot_presence", "slot": "photo"}),
            RuleDef(id="C-R03", statement="期次一致", requirement_source="s",
                    executor="semantic"),
            RuleDef(id="H-01", statement="真实性", requirement_source="s",
                    executor="human_only"),
        ],
    )


def _file(fid="f1", slot="report", text="2026 秋季第 1 期团课报告 姓名：张三"):
    return FileInfo(file_id=fid, slot=slot, original_name=f"{fid}.pdf", size=1024,
                    parse=ParseResult(pages=[text]))


def _ctx(**kw):
    return CheckContext(blueprint=_bp(), fields=kw.get("fields", {"name": "张三", "term": "第 1 期", "track": "实物"}),
                        members=kw.get("members", ["张三", "李四"]),
                        files=kw.get("files", [_file()]))


# ---------------- 条件求值
def test_condition_eval():
    assert _eval_condition("track==实物", {"track": "实物"}) is True
    assert _eval_condition("track==实物", {"track": "数字"}) is False
    assert _eval_condition("track!=实物", {"track": "数字"}) is True
    assert _eval_condition(None, {}) is True


# ---------------- 确定性检查
def test_slot_constraints_pass():
    r = run_deterministic(_bp().rules[0], _ctx())
    assert r.result == RESULT_SATISFIED


def test_slot_constraints_wrong_format():
    f = FileInfo(file_id="f1", slot="report", original_name="a.exe", size=1024,
                 parse=ParseResult(pages=["x"]))
    r = run_deterministic(_bp().rules[0], _ctx(files=[f]))
    assert r.result == RESULT_ISSUE
    assert "扩展名" in r.explanation


def test_slot_constraints_disguised_type_by_real_content():
    """扩展名伪装：名为 .pdf 实为 docx 内容，按真实类型判不符（V11，不轻信扩展名）。"""
    f = FileInfo(file_id="f1", slot="report", original_name="a.pdf", size=1024,
                 parse=ParseResult(pages=["x"], detected="docx"))
    r = run_deterministic(_bp().rules[0], _ctx(files=[f]))
    assert r.result == RESULT_ISSUE
    assert "真实内容" in r.explanation or "实际内容" in r.explanation


def test_slot_constraints_detected_type_ok():
    """真实类型与声明格式一致时通过（内容检测为 pdf 的 .pdf）。"""
    f = FileInfo(file_id="f1", slot="report", original_name="a.pdf", size=1024,
                 parse=ParseResult(pages=["x"], detected="pdf"))
    r = run_deterministic(_bp().rules[0], _ctx(files=[f]))
    assert r.result == RESULT_SATISFIED


def test_slot_constraints_too_many_pages():
    f = FileInfo(file_id="f1", slot="report", original_name="a.pdf", size=1024,
                 parse=ParseResult(pages=["p"] * 25))
    r = run_deterministic(_bp().rules[0], _ctx(files=[f]))
    assert r.result == RESULT_ISSUE and "页数" in r.explanation


def test_slot_presence_missing_when_applicable():
    ctx = _ctx(fields={"name": "张三", "track": "实物"}, files=[_file()])
    r = run_deterministic(_bp().rules[3], ctx)
    assert r.result == RESULT_ISSUE and "缺少文件" in r.explanation


def test_slot_presence_not_applicable():
    ctx = _ctx(fields={"name": "张三", "track": "数字"}, files=[_file()])
    r = run_deterministic(_bp().rules[3], ctx)
    assert r.result == RESULT_NOT_APPLICABLE


def test_team_size_and_contact():
    ctx = _ctx(members=["张三"])
    assert run_deterministic(_bp().rules[1], ctx).result == RESULT_ISSUE
    ctx2 = _ctx(members=["张三", "李四"], fields={"name": "王五", "track": "实物"})
    assert run_deterministic(_bp().rules[2], ctx2).result == RESULT_ISSUE


# ---------------- 语义检查
def test_semantic_satisfied_with_verified_quote(stub_llm):
    stub_llm.responses = [{
        "result": "satisfied", "explanation": "标题为期次 1",
        "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "2026 秋季第 1 期团课报告"}],
    }]
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_SATISFIED
    assert r.evidence and r.evidence[0].file_id == "f1"


def test_semantic_fabricated_quote_downgraded_to_unknown(stub_llm):
    """编造原文：引用无法定位 → unknown，不得作为确认结论。"""
    stub_llm.responses = [{
        "result": "issue", "explanation": "发现第 2 期",
        "evidence": [{"file_id": "f1", "locator": "p.9", "quote": "第 2 期团课报告"}],
    }]
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_UNKNOWN
    assert "缺少可在原文定位的证据" in r.explanation


def test_semantic_unread_pages_force_unknown(stub_llm):
    """覆盖缺口：存在未读页时必须 unknown（V08）。"""
    f = FileInfo(file_id="f1", slot="report", original_name="scan.pdf", size=1024,
                 parse=ParseResult(pages=["第 1 页"], unread_pages=3))
    r = run_semantic_rule(_bp().rules[4], _ctx(files=[f]), client=stub_llm)
    assert r.result == RESULT_UNKNOWN
    assert "覆盖不完整" in r.explanation
    assert stub_llm.calls == 0  # 覆盖不足时不浪费调用


def test_semantic_llm_unavailable_marks_failed(stub_llm):
    from app.llm import LLMUnavailable as U

    stub_llm.error = U("网关 503")
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_FAILED and "未完成" in r.explanation


def test_run_checks_separates_human_only_and_counts_budget(stub_llm):
    outcome = run_checks(_ctx(), client=stub_llm)
    assert outcome.human_only_rules == ["H-01"]
    assert outcome.llm_calls_used == 1  # 仅 1 条语义规则
    results = {r.rule_id: r.result for r in outcome.results}
    assert results["C-R01"] == RESULT_SATISFIED
    assert results["T-R03"] == RESULT_ISSUE  # 实物赛道缺照片
    assert "H-01" not in results  # 人工项不产出机器结论
    assert outcome.coverage["f1"]["total"] == 1


def test_semantic_non_object_json_marks_failed_not_guessed(stub_llm):
    """模型返回非对象 JSON（如数组）：检查未完成记 failed，绝不臆造结论。"""
    stub_llm.responses = [json.dumps(["不是对象"])]
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_FAILED
    assert "无法解析" in r.explanation


def test_semantic_non_dict_evidence_items_ignored(stub_llm):
    """证据项不是对象时忽略，合法证据仍保留（坏数据不变证据）。"""
    stub_llm.responses = [json.dumps(
        {"result": "satisfied", "explanation": "x",
         "evidence": ["不是对象", {"quote": "2026 秋季第 1 期团课报告 姓名：张三"}]})]
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_SATISFIED
    assert len(r.evidence) == 1

def test_verify_quote_tolerates_ocr_punctuation_noise():
    """OCR 把全角标点识别成半角、文字加空格碎片时，合理引用仍应通过验证（V07）。"""
    ocr_text = "期次 : 2 0 2 6 秋季第 1 期团课报告"
    assert _verify_quote("期次：2026", {"f1": ocr_text}) == "f1"
    assert _verify_quote("期次:2026秋季第1期", {"f1": ocr_text}) == "f1"
    # 内容不存在时仍然拒绝（噪声容忍不等于放行臆造）
    assert _verify_quote("期次：2027", {"f1": ocr_text}) is None
