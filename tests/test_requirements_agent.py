"""需求 Agent 测试：不暗加规则、配置校验、模板、空输入。"""
from __future__ import annotations

import json

from app.agents.requirements_agent import (
    draft_blueprint,
    template_blueprint,
    validate_blueprint,
)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef, TimePolicy

REQUIREMENT = "请名册内同学提交 2026 秋季第 1 期团课报告，包含姓名和期次，PDF 或 DOCX，最大 10 MiB、20 页，11 月 8 日 18:00 前提交。"


def _draft_payload():
    return {
        "blueprint": {
            "task_scope": {"name": "团课报告收集", "mode": "roster", "subject_kind": "individual"},
            "fields": [
                {"id": "name", "label": "姓名", "required": True},
                {"id": "term", "label": "期次", "required": True},
            ],
            "slots": [{"id": "report", "label": "报告", "formats": ["pdf", "docx"],
                       "max_count": 1, "max_size_mib": 10, "max_pages": 20}],
            "rules": [
                {"id": "C-R01", "statement": "材料格式与大小符合要求",
                 "requirement_source": "PDF 或 DOCX，最大 10 MiB、20 页",
                 "executor": "deterministic", "capability": "supported",
                 "check": {"kind": "slot_constraints", "slot": "report"}},
                {"id": "C-R03", "statement": "报告期次与登记一致",
                 "requirement_source": "2026 秋季第 1 期团课报告",
                 "executor": "semantic", "capability": "supported"},
            ],
            "time_policy": {"timezone": "Asia/Shanghai"},
        },
        "clarifications": [],
        "publish_summary": ["对象：名册内同学", "材料：报告 PDF/DOCX"],
    }


def test_draft_parses_and_passes_validation(stub_llm):
    stub_llm.responses = [_draft_payload()]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert len(result.blueprint.rules) == 2
    assert result.blueprint.rules[0].executor.value == "deterministic"
    assert not any("无法在原始要求中定位" in w for w in result.warnings)  # V01：来源均可定位
    assert any("截止" in w for w in result.warnings)  # V01 提醒：原始要求含截止而草案无时间策略，应先澄清不猜默认值
    assert stub_llm.calls == 1


def test_draft_llm_unavailable_degrades(stub_llm):
    from app.llm import LLMUnavailable

    stub_llm.error = LLMUnavailable("网关 500")
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.rules == []
    assert any("暂不可用" in w for w in result.warnings)


def test_empty_input_no_fabrication(stub_llm):
    result = draft_blueprint("   ", client=stub_llm)
    assert result.blueprint.rules == [] and result.blueprint.fields == []
    assert any("不生成虚构要求" in w for w in result.warnings)
    assert stub_llm.calls == 0  # 不发模型调用


def test_validate_catches_duplicate_ids_and_bad_dates():
    bp = Blueprint(
        fields=[FieldDef(id="name", label="姓名"), FieldDef(id="name", label="姓名2")],
        rules=[RuleDef(id="R1", statement="x", requirement_source="y",
                       executor="deterministic")],
        time_policy=TimePolicy(open_at=None),
    )
    from datetime import datetime

    bp.time_policy.open_at = datetime(2026, 11, 10)
    bp.time_policy.first_deadline = datetime(2026, 11, 8)
    errors = validate_blueprint(bp)
    assert any("重复" in e for e in errors)
    assert any("开放时刻必须早于首次截止" in e for e in errors)


def test_validate_catches_unlocatable_source():
    """暗加要求：来源引用无法在原文定位 → 程序拦截。"""
    bp = Blueprint(rules=[RuleDef(id="R1", statement="必须包含签名",
                                  requirement_source="组织者未提出的签名要求",
                                  executor="semantic")])
    errors = validate_blueprint(bp, "只要求交一份 PDF 报告")
    assert any("无法在原始要求中定位" in e for e in errors)


def test_validate_catches_dependency_cycle():
    bp = Blueprint(rules=[
        RuleDef(id="A", statement="a", requirement_source="a", executor="semantic", depends_on=["B"]),
        RuleDef(id="B", statement="b", requirement_source="b", executor="semantic", depends_on=["A"]),
    ])
    errors = validate_blueprint(bp)
    assert any("依赖环" in e for e in errors)


def test_validate_catches_missing_condition_ref():
    bp = Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        slots=[{"id": "photo", "label": "照片", "required_condition": "track==实物"}],
    )
    errors = validate_blueprint(bp)
    assert any("不存在的 track" in e for e in errors)


def test_template_blueprints():
    bp = template_blueprint("class_report")
    assert [f.id for f in bp.fields] == ["name", "term", "class_name"]
    assert bp.slots[0].formats == ["pdf", "docx"]
    assert bp.slots[0].max_pages == 20


# ---- 真实模型偏差容错（glm-5.3 冒烟实测：executor 会自造 "system" 之类取值）----

def test_unknown_executor_normalized_to_human_only(stub_llm):
    payload = _draft_payload()
    payload["blueprint"]["rules"][0]["executor"] = "system"  # 模型自造取值
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    rule = result.blueprint.rules[0]
    assert rule.executor.value == "human_only"  # 看不懂的规则绝不自动执行
    assert any("executor" in w and "system" in w for w in result.warnings)


def test_executor_alias_mapped_silently(stub_llm):
    payload = _draft_payload()
    payload["blueprint"]["rules"][0]["executor"] = "programmatic"
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.rules[0].executor.value == "deterministic"
    # 已知别名静默规整，不产生噪音警告（V01 截止提醒属预期提示，另行断言）
    assert not any("别名" in w or "规整" in w or "规范" in w for w in result.warnings)


def test_unknown_capability_and_field_type_normalized(stub_llm):
    payload = _draft_payload()
    payload["blueprint"]["rules"][1]["capability"] = "auto"
    payload["blueprint"]["fields"][0]["type"] = "string"
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.rules[1].capability.value == "supported"
    assert result.blueprint.fields[0].type.value == "text"
    # 已知别名静默规整，不产生噪音警告（V01 截止提醒属预期提示，另行断言）
    assert not any("别名" in w or "规整" in w or "规范" in w for w in result.warnings)


def test_non_json_response_preserves_draft(stub_llm):
    stub_llm.responses = ["完全不是 JSON 的回复"]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.rules == []
    assert any("无法解析" in w for w in result.warnings)


def test_structurally_invalid_draft_preserved_with_warning(stub_llm):
    payload = _draft_payload()
    del payload["blueprint"]["rules"][0]["statement"]  # 缺必填字段
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.rules == []
    assert any("无法解析" in w for w in result.warnings)


def test_revision_parse_failure_keeps_current_draft(stub_llm):
    current = Blueprint(
        task_scope={"name": "旧草案"},
        rules=[RuleDef(id="C-R01", statement="材料格式与大小符合要求",
                       requirement_source="PDF 或 DOCX，最大 10 MiB、20 页",
                       executor="deterministic")],
    )
    payload = _draft_payload()
    del payload["blueprint"]["rules"][0]["statement"]
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, current_draft=current, client=stub_llm)
    assert result.blueprint is current  # 修订失败时原草案原样保留
    assert any("无法解析" in w for w in result.warnings)


def test_validate_catches_empty_blueprint():
    """空蓝图（无字段无槽位）不可发布——真实模型冒烟曾返回删空的草案。"""
    errors = validate_blueprint(Blueprint())
    assert any("没有任何字段或材料槽位" in e for e in errors)


def test_parse_draft_tolerates_bare_blueprint(stub_llm):
    """模型有时直接返回蓝图本体而无 blueprint 外壳（真实网关冒烟实测）。"""
    payload = _draft_payload()["blueprint"]
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert len(result.blueprint.rules) == 2
    assert result.blueprint.slots[0].id == "report"


def test_instruction_counts_as_valid_source(stub_llm):
    """组织者修改意见中明确提出的要求不是"暗加"：来源可在意见中定位。"""
    payload = _draft_payload()
    payload["blueprint"]["rules"][0]["requirement_source"] = "PDF/DOCX 之外也接受 Markdown"
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, current_draft=Blueprint(),
                             instruction="材料格式在 PDF/DOCX 之外也接受 Markdown",
                             client=stub_llm)
    assert not any("无法在原始要求中定位" in w for w in result.warnings)


def test_answered_clarification_counts_as_valid_source(stub_llm):
    """组织者已回答的澄清是权威上下文：按澄清答案建的规则不算暗加。"""
    payload = _draft_payload()
    payload["blueprint"]["rules"][0]["requirement_source"] = "不接受手写扫描件，仅电子版"
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, answered={"是否接受手写扫描件": "不接受手写扫描件，仅电子版"},
                             client=stub_llm)
    assert not any("无法在原始要求中定位" in w for w in result.warnings)


def test_non_string_field_values_normalized(stub_llm):
    """模型偶尔返回非字符串字段值（真实冒烟实测 visibility）：规整并警告，不崩溃。"""
    payload = _draft_payload()
    payload["blueprint"]["fields"][0]["visibility"] = True   # 非法类型
    payload["blueprint"]["fields"][0]["label"] = 123          # 非法类型
    payload["blueprint"]["slots"][0]["formats"] = "pdf"       # 字符串而非列表
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert result.blueprint.fields[0].visibility == "organizer"
    assert result.blueprint.fields[0].label == "123"
    assert result.blueprint.slots[0].formats == ["pdf"]
    assert sum("不是字符串" in w for w in result.warnings) == 2


def test_clarifications_as_plain_strings_tolerated(stub_llm):
    """模型偶尔把澄清项写成纯字符串（真实冒烟实测 TypeError）：容错为问题文本。"""
    payload = _draft_payload()
    payload["clarifications"] = ["是否需要同时提交查重报告？"]
    stub_llm.responses = [payload]
    result = draft_blueprint(REQUIREMENT, client=stub_llm)
    assert [c.question for c in result.clarifications] == ["是否需要同时提交查重报告？"]
    assert any("澄清项不是对象" in w for w in result.warnings)
