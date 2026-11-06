"""需求 Agent 测试：不暗加规则、配置校验、模板、空输入。"""
from __future__ import annotations

import json
from pathlib import Path

from app.agents.requirements_agent import (
    build_source_text,
    draft_blueprint,
    normalize_source_materials,
    requirements_skill_manifest,
    requirements_skill_self_test,
    template_blueprint,
    validate_blueprint,
)
from app.schemas import Blueprint, FieldDef, RuleDef, SlotDef, TimePolicy
from app.llm import DocumentInput, LLMInputUnsupported
from app.parsing import ParseResult

REQUIREMENT = "请名册内同学提交 2026 秋季第 1 期团课报告，包含姓名和期次，PDF 或 DOCX，最大 10 MiB、20 页，11 月 8 日 18:00 前提交。"


def test_requirements_skill_contract_is_bounded_and_publish_gated():
    manifest = requirements_skill_manifest()
    assert manifest["name"] == "requirements_draft"
    assert manifest["allowed_tools"] == []
    assert manifest["execution"] == "application_service"
    assert manifest["source_limits"] == {
        "materials": 8, "per_material_chars": 12_000, "total_chars": 30_000,
    }
    assert manifest["max_clarifications"] == 3
    assert manifest["idempotency"] == "task_account_request_id"
    assert manifest["version_conflict"] == "fail_closed"
    assert manifest["human_gate"] == "发布前必须由组织者确认"
    assert requirements_skill_self_test()["status"] == "passed"


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


def test_source_materials_are_segmented_and_summarized(stub_llm):
    stub_llm.responses = [_draft_payload()]
    materials = [{"id": "notice", "name": "报名通知", "kind": "notice", "content": "提交 PDF，截止 11 月 8 日"},
                 {"id": "roster", "name": "适用名单", "kind": "roster", "content": "张三、李四"}]
    result = draft_blueprint("请按资料整理", source_materials=materials, client=stub_llm)
    prompt = stub_llm.prompts[0][1]["content"]
    assert "【来源资料 1 · 报名通知 · notice · id=notice】" in prompt
    assert "【来源资料 2 · 适用名单 · roster · id=roster】" in prompt
    assert [item.id for item in result.source_materials] == ["notice", "roster"]
    assert result.source_materials[0].chars == len("提交 PDF，截止 11 月 8 日")
    assert "【来源资料 1 · 报名通知 · notice · id=notice】" in build_source_text("请按资料整理", source_materials=materials)


def test_source_materials_validate_shape_and_limits():
    base = {"id": "notice", "name": "报名通知", "kind": "notice", "content": "正文"}
    assert normalize_source_materials([base])[0]["id"] == "notice"
    for bad, message in [
        ([base, {**base, "id": "notice"}], "id 重复"),
        ([{**base, "content": ""}], "不能为空"),
        ([{**base, "kind": "pdf"}], "类型无效"),
    ]:
        try:
            normalize_source_materials(bad)
        except ValueError as exc:
            assert message in str(exc)
        else:
            raise AssertionError("invalid source material was accepted")


def test_document_fallback_persists_effective_parsed_source(monkeypatch, tmp_path, stub_llm):
    """直传失败后，草案引用应校验并保存实际解析/OCR 文本，而不是占位符。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "auto")
    path = Path(tmp_path) / "notice.pdf"
    path.write_bytes(b"%PDF-1.4 scan")

    class RejectingDirectStub(type(stub_llm)):
        @property
        def direct_documents_enabled(self):
            return True

        def chat_json_documents(self, messages, documents, temperature=0.1,
                                deadline_monotonic=None):
            raise LLMInputUnsupported("provider does not accept file")

    client = RejectingDirectStub()
    payload = _draft_payload()
    payload["blueprint"]["rules"][0].update({
        "requirement_source": "提交 PDF 报告，截止 11 月 8 日。",
        "source_material_id": "notice",
        "source_locator": "p.1",
    })
    client.responses = [payload]

    def fake_parse_file(_path, *, allow_ocr=True):
        assert allow_ocr is True
        return ParseResult(pages=["提交 PDF 报告，截止 11 月 8 日。"], method="ocr")

    monkeypatch.setattr("app.agents.requirements_agent.parse_file", fake_parse_file)
    result = draft_blueprint(
        "请按扫描通知整理",
        source_materials=[{
            "id": "notice", "name": "扫描通知", "kind": "notice",
            "content": "（原始文件尚未形成文字缓存，优先尝试模型直读）",
        }],
        source_documents=[DocumentInput("notice", "notice.pdf", path, "application/pdf")],
        client=client,
    )

    assert not any("来源引用无法在资料 notice" in warning for warning in result.warnings)
    assert "提交 PDF 报告，截止 11 月 8 日。" in result._effective_source_text
    assert "_effective_source_text" not in result.model_dump()
    assert result.input_provenance[0].method == "ocr"
    assert result.input_provenance[0].status == "fallback"
    assert "直传" in result.input_provenance[0].detail


def test_direct_document_source_keeps_locator_and_warns_human_review(monkeypatch, tmp_path, stub_llm):
    """直传成功但没有文字层时，不把模型定位线索误判为程序已验证。"""
    monkeypatch.setattr("app.config.settings.llm_input_mode", "auto")
    path = Path(tmp_path) / "scan.pdf"
    path.write_bytes(b"%PDF-1.4 scan")

    class DirectStub(type(stub_llm)):
        @property
        def direct_documents_enabled(self):
            return True

        def chat_json_documents(self, messages, documents, temperature=0.1,
                                deadline_monotonic=None):
            return self.responses.pop(0)

    client = DirectStub()
    payload = _draft_payload()
    payload["blueprint"]["rules"][0].update({
        "requirement_source": "扫描件第 1 页的提交要求",
        "source_material_id": "notice",
        "source_locator": "p.1",
    })
    client.responses = [payload]
    result = draft_blueprint(
        "请按扫描通知整理",
        source_materials=[{
            "id": "notice", "name": "扫描通知", "kind": "notice",
            "content": "（原始文件尚未形成文字缓存，优先尝试模型直读）",
        }],
        source_documents=[DocumentInput("notice", "scan.pdf", path, "application/pdf")],
        client=client,
    )

    assert not any("来源引用无法在资料 notice" in warning for warning in result.warnings)
    assert any("发布前请打开原文件人工核对" in warning for warning in result.warnings)
    assert result.input_provenance[0].method == "direct_model"
    assert result.input_provenance[0].status == "used"
    assert "原始文件" in result.input_provenance[0].detail


def test_requirements_agent_uses_real_client_document_payload_before_parser(
    monkeypatch, tmp_path
):
    """需求 Agent 的直传分支必须经过真实 LLMClient，且不先启动本地解析/OCR。"""
    import httpx

    monkeypatch.setattr("app.config.settings.llm_input_mode", "auto")
    path = Path(tmp_path) / "通知.pdf"
    path.write_bytes(b"%PDF-1.4 scan")
    captured = {}

    class CapturingClient:
        def __init__(self, *, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, *, json, headers):
            import json as json_module

            captured["json"] = json
            captured["headers"] = headers
            return httpx.Response(
                200,
                json={"choices": [{"message": {
                    "content": json_module.dumps(_draft_payload(), ensure_ascii=False),
                }}]},
                request=httpx.Request("POST", url),
            )

    def parser_must_not_run(*_args, **_kwargs):
        raise AssertionError("直传成功时不应先调用本地文字解析或 OCR")

    monkeypatch.setattr("app.llm.httpx.Client", CapturingClient)
    monkeypatch.setattr("app.agents.requirements_agent.parse_file", parser_must_not_run)

    from app.llm import LLMClient

    result = draft_blueprint(
        "请按通知整理收集要求",
        source_materials=[{
            "id": "src_notice", "name": "通知.pdf", "kind": "notice",
            "content": "（原始文件尚未形成文字缓存，优先尝试模型直读）",
        }],
        source_documents=[DocumentInput(
            "src_notice", "通知.pdf", path, "application/pdf",
        )],
        client=LLMClient(
            base_url="https://provider.example/v1",
            api_key="secret-provider-key",
            model="document-model",
            max_retries=0,
        ),
    )

    assert result.blueprint.slots[0].id == "report"
    assert result.input_provenance[0].method == "direct_model"
    assert result.input_provenance[0].status == "used"
    assert captured["headers"] == {"Authorization": "Bearer secret-provider-key"}
    content = captured["json"]["messages"][-1]["content"]
    assert any(part.get("type") == "file" for part in content)
    assert any("src_notice" in str(part) for part in content)


def test_missing_model_key_is_explicitly_not_sent(stub_llm):
    from app.llm import LLMUnavailable

    stub_llm.api_key = ""
    stub_llm.error = LLMUnavailable("未配置 FORMFLOW_LLM_API_KEY")
    result = draft_blueprint(
        "请按通知整理",
        source_materials=[{
            "id": "notice", "name": "报名通知", "kind": "notice", "content": "提交 PDF。",
        }],
        client=stub_llm,
    )

    assert result.input_provenance[0].method == "none"
    assert result.input_provenance[0].status == "not_configured"
    assert "未发送" in result.input_provenance[0].detail


def test_explicit_text_mode_prepares_parser_input(monkeypatch, tmp_path, stub_llm):
    monkeypatch.setattr("app.config.settings.llm_input_mode", "text")
    path = Path(tmp_path) / "notice.pdf"
    path.write_bytes(b"%PDF-1.4 text")

    def fake_parse_file(_path, *, allow_ocr=True):
        assert allow_ocr is False
        return ParseResult(pages=["提交 PDF 报告。"], method="text")

    monkeypatch.setattr("app.agents.requirements_agent.parse_file", fake_parse_file)
    stub_llm.responses = [_draft_payload()]
    result = draft_blueprint(
        "请按通知整理",
        source_materials=[{
            "id": "notice", "name": "报名通知", "kind": "notice",
            "content": "（原始文件尚未形成文字缓存，优先尝试模型直读）",
        }],
        source_documents=[DocumentInput("notice", "notice.pdf", path, "application/pdf")],
        client=stub_llm,
    )

    assert result.input_provenance[0].method == "text"
    assert result.input_provenance[0].status == "used"
    assert "提交 PDF 报告。" in stub_llm.prompts[-1][1]["content"]


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


def test_validate_source_material_citation_requires_existing_id_and_locator():
    source_text = build_source_text(
        "请按通知收集材料。",
        source_materials=[{
            "id": "notice-2026",
            "name": "报名通知",
            "kind": "notice",
            "content": "提交 PDF 报告，截止 11 月 8 日。",
        }],
    )
    valid = Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告")],
        rules=[RuleDef(
            id="R1",
            statement="提交 PDF 报告",
            requirement_source="提交 PDF 报告",
            source_material_id="notice-2026",
            source_locator="p.2",
            executor="deterministic",
            check={"kind": "slot_constraints", "slot": "report"},
        )],
    )
    assert validate_blueprint(valid, source_text) == []

    missing_id = valid.model_copy(deep=True)
    missing_id.rules[0].source_material_id = "missing"
    assert any("不存在的来源资料" in e for e in validate_blueprint(missing_id, source_text))

    missing_locator = valid.model_copy(deep=True)
    missing_locator.rules[0].source_locator = ""
    assert any("缺少 source_locator" in e for e in validate_blueprint(missing_locator, source_text))


def test_validate_source_material_citation_must_match_material_text():
    source_text = build_source_text(
        "请按通知收集材料。",
        source_materials=[{
            "id": "notice-2026",
            "name": "报名通知",
            "kind": "notice",
            "content": "提交 PDF 报告。",
        }],
    )
    bp = Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告")],
        rules=[RuleDef(
            id="R1",
            statement="通知要求提交签名页",
            requirement_source="通知要求提交签名页",
            source_material_id="notice-2026",
            source_locator="p.3",
            executor="semantic",
        )],
    )
    errors = validate_blueprint(bp, source_text)
    assert any("来源引用无法在资料 notice-2026 中定位" in e for e in errors)


def test_legacy_rule_without_source_material_fields_remains_compatible():
    bp = Blueprint(
        fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告")],
        rules=[RuleDef(
            id="R1",
            statement="提交 PDF 报告",
            requirement_source="提交 PDF 报告",
            executor="deterministic",
            check={"kind": "slot_constraints", "slot": "report"},
        )],
    )
    assert validate_blueprint(bp, "提交 PDF 报告") == []


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
