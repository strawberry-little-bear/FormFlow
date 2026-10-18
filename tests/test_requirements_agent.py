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
    assert result.warnings == []  # 来源均可定位，无校验错误
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
