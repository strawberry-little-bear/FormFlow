"""审核 Agent 测试：确定性检查、证据引用校验、覆盖缺口、预算、降级。"""
from __future__ import annotations

import json
from pathlib import Path

from app.agents.review_agent import (
    CheckContext,
    FileInfo,
    _eval_condition,
    _verify_quote,
    run_checks,
    run_deterministic,
    run_semantic_rule,
)
from app.llm import LLMBudgetExceeded, LLMInputUnsupported, LLMUnavailable
from app.models import (
    RESULT_FAILED,
    RESULT_ISSUE,
    RESULT_NOT_APPLICABLE,
    RESULT_SATISFIED,
    RESULT_UNKNOWN,
)
from app.parsing import ParseResult
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef
from app.services.checks import run_coverage


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
    assert r.evidence
    assert all(e.method == "program" for e in r.evidence)
    assert r.evidence[0].file_id == "f1"


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
    assert r.evidence[0].locator == "slot:photo"
    assert r.evidence[0].quote == "收到 0 个文件"
    assert r.evidence[0].method == "program"


def test_slot_presence_not_applicable():
    ctx = _ctx(fields={"name": "张三", "track": "数字"}, files=[_file()])
    r = run_deterministic(_bp().rules[3], ctx)
    assert r.result == RESULT_NOT_APPLICABLE
    assert r.evidence[0].locator == "condition:photo"


def test_team_size_and_contact():
    ctx = _ctx(members=["张三"])
    team = run_deterministic(_bp().rules[1], ctx)
    assert team.result == RESULT_ISSUE
    assert team.evidence[0].locator == "roster.members"
    ctx2 = _ctx(members=["张三", "李四"], fields={"name": "王五", "track": "实物"})
    contact = run_deterministic(_bp().rules[2], ctx2)
    assert contact.result == RESULT_ISSUE
    assert {e.locator for e in contact.evidence} == {"field:name", "roster.members"}


def test_field_and_member_checks_keep_program_evidence_for_all_results():
    required = RuleDef(id="F-R01", statement="填写姓名", requirement_source="s",
                       executor="deterministic", check={"kind": "field_required", "field": "name"})
    missing = run_deterministic(required, _ctx(fields={"track": "数字"}))
    assert missing.result == RESULT_ISSUE
    assert missing.evidence[0].locator == "field:name"
    assert missing.evidence[0].quote == "（未填写）"

    members = RuleDef(id="M-R01", statement="成员一致", requirement_source="s",
                      executor="deterministic", check={"kind": "members_match", "field": "members"})
    unknown = run_deterministic(members, _ctx(fields={"members": "张三"}, members=[]))
    assert unknown.result == RESULT_UNKNOWN
    assert {e.locator for e in unknown.evidence} == {"field:members", "roster.members"}

    satisfied = run_deterministic(members, _ctx(fields={"members": "张三、李四"}))
    assert satisfied.result == RESULT_SATISFIED
    assert all(e.method == "program" for e in satisfied.evidence)


# ---------------- 语义检查
def test_semantic_satisfied_with_verified_quote(stub_llm):
    stub_llm.responses = [{
        "result": "satisfied", "explanation": "标题为期次 1",
        "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "2026 秋季第 1 期团课报告"}],
    }]
    r = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm)
    assert r.result == RESULT_SATISFIED
    assert r.evidence and r.evidence[0].file_id == "f1"


def test_semantic_rule_passes_harness_deadline_to_llm(stub_llm):
    observed = []
    original_chat = stub_llm.chat

    def capture_deadline(messages, temperature=0.2, deadline_monotonic=None):
        observed.append(deadline_monotonic)
        return original_chat(messages, temperature)

    stub_llm.chat = capture_deadline
    result = run_semantic_rule(_bp().rules[4], _ctx(), client=stub_llm,
                               deadline_monotonic=123.5)

    assert result.result == RESULT_UNKNOWN
    assert observed == [123.5]


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


def test_semantic_prefers_direct_document_input_without_ocr(tmp_path, stub_llm, monkeypatch):
    """有原始文件和直传能力时，扫描件先交给模型，不先启动本地 OCR。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "auto")
    path = Path(tmp_path) / "scan.pdf"
    path.write_bytes(b"%PDF-1.4 fake")

    class DirectStub(type(stub_llm)):
        def __init__(self):
            super().__init__()
            self.document_calls = []

        @property
        def direct_documents_enabled(self):
            return True

        def chat_json_documents(self, messages, documents, temperature=0.1, deadline_monotonic=None):
            self.document_calls.append(documents)
            return {"result": "satisfied", "explanation": "模型直接读取了材料",
                    "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "扫描件中的标题"}]}

    client = DirectStub()
    f = FileInfo(file_id="f1", slot="report", original_name="scan.pdf", size=12,
                 path=path, parse=ParseResult(method="visual", unread_pages=1))
    result = run_semantic_rule(_bp().rules[4], _ctx(files=[f]), client=client)

    assert result.result == RESULT_SATISFIED
    assert result.evidence[0].method == "direct_model"
    assert len(client.document_calls) == 1
    assert f.input_method == "direct_model"
    assert f.direct_model_used is True

    outcome = run_checks(_ctx(files=[f]), client=client)
    coverage = outcome.coverage["f1"]
    assert coverage["method"] == "direct_model"
    assert coverage["model_direct"] is True
    assert coverage["unread"] == 0 and coverage["failed"] == 0
    assert coverage["parser_unread"] == 1
    assert coverage["read"] == coverage["total"] == 1


def test_run_coverage_explains_direct_model_provenance():
    """直传成功不把本地解析器的无文字探测算成覆盖缺口。"""
    from types import SimpleNamespace

    run = SimpleNamespace(coverage_json=json.dumps({
        "f1": {"total": 2, "text": 0, "read": 2, "unread": 0,
               "failed": 0, "parser_unread": 2, "method": "direct_model",
               "model_direct": True, "name": "scan.pdf"},
    }, ensure_ascii=False))
    coverage = run_coverage(run)
    assert coverage["complete"] is True
    assert coverage["unread_pages"] == 0
    assert coverage["model_direct"] is True
    assert coverage["direct_model_files"] == 1
    assert coverage["files"][0]["parser_unread"] == 2


def test_run_checks_keeps_direct_model_success_when_parser_has_no_result():
    """直传成功但解析器没有结果时，不把模型已读材料标成失败。"""
    ctx = CheckContext(blueprint=Blueprint(fields=[], slots=[], rules=[]), fields={}, files=[
        FileInfo(file_id="f1", slot="report", original_name="scan.pdf", size=12,
                 direct_model_used=True, input_method="direct_model")
    ])

    outcome = run_checks(ctx)

    coverage = outcome.coverage["f1"]
    assert coverage["model_direct"] is True
    assert coverage["method"] == "direct_model"
    assert coverage["unread"] == 0 and coverage["failed"] == 0
    assert coverage["parser_failed"] == 1


def test_semantic_falls_back_to_parser_when_provider_rejects_documents(tmp_path, stub_llm, monkeypatch):
    """provider 拒绝文件内容时才启用文本解析/OCR，并继续校验引用。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "auto")
    path = Path(tmp_path) / "report.txt"
    path.write_text("2026 秋季第 1 期团课报告", encoding="utf-8")

    class RejectingStub(type(stub_llm)):
        @property
        def direct_documents_enabled(self):
            return True

        def chat_json_documents(self, messages, documents, temperature=0.1, deadline_monotonic=None):
            raise LLMInputUnsupported("provider does not accept file")

    client = RejectingStub()
    client.responses = [{
        "result": "satisfied", "explanation": "标题符合要求",
        "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "2026 秋季第 1 期团课报告"}],
    }]
    f = FileInfo(file_id="f1", slot="report", original_name="report.txt", size=30,
                 path=path, parse=ParseResult(method="visual", unread_pages=1))
    result = run_semantic_rule(_bp().rules[4], _ctx(files=[f]), client=client)

    assert result.result == RESULT_SATISFIED
    assert result.evidence[0].method == "llm"
    assert f.input_method == "text"


def test_semantic_direct_mode_marks_provider_rejection_failed(tmp_path, stub_llm, monkeypatch):
    """显式 direct 模式不做本地降级，也不能让 Worker 因能力错误崩溃。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "direct")
    path = Path(tmp_path) / "report.pdf"
    path.write_bytes(b"%PDF-1.4 fake")

    class RejectingStub(type(stub_llm)):
        @property
        def direct_documents_enabled(self):
            return True

        def chat_json_documents(self, messages, documents, temperature=0.1, deadline_monotonic=None):
            raise LLMInputUnsupported("provider does not accept file")

    client = RejectingStub()
    f = FileInfo(file_id="f1", slot="report", original_name="report.pdf", size=12, path=path)
    result = run_semantic_rule(_bp().rules[4], _ctx(files=[f]), client=client)

    assert result.result == RESULT_FAILED
    assert "不支持原始文件输入" in result.explanation


def test_text_mode_never_starts_ocr(tmp_path, stub_llm, monkeypatch):
    """显式 text 模式只读取文字层，不偷偷启动本地 OCR。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "text")
    path = Path(tmp_path) / "report.pdf"
    path.write_bytes(b"%PDF-1.4 fake")
    calls = []

    def fake_parse_file(path, *, allow_ocr=True):
        calls.append(allow_ocr)
        return ParseResult(pages=["2026 秋季第 1 期团课报告"], method="text")

    monkeypatch.setattr("app.parsing.parse_file", fake_parse_file)
    client = stub_llm
    client.responses = [{
        "result": "satisfied", "explanation": "标题符合要求",
        "evidence": [{"file_id": "f1", "locator": "p.1", "quote": "2026 秋季第 1 期团课报告"}],
    }]
    f = FileInfo(file_id="f1", slot="report", original_name="report.pdf", size=12,
                 path=path, parse=ParseResult(method="visual", unread_pages=1))
    result = run_semantic_rule(_bp().rules[4], _ctx(files=[f]), client=client)

    assert result.result == RESULT_SATISFIED
    assert calls == [False]
    assert f.input_method == "text"
