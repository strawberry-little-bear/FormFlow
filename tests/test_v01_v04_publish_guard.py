# -*- coding: utf-8 -*-
"""V01-V04 发布校验加固回归测试。

- V01：规则来源必须能在组织者原始输入中定位（不暗加要求）；
        原始要求含时间/截止线索而蓝图无时间策略时给非阻塞提醒（先澄清，不猜默认值）。
- V02：态度类表述（认真/态度/用心/真情实感/原创性…）没有可执行定义，
        必须标人工或需澄清，不得宣称可由系统自动鉴定。
- V03：条件表达式仅支持 字段==值 / 字段!=值 及 and/or 连接；
        不受支持的形式发布即拦截、运行期判 failed 并提示人工，不静默通过。
- V04：check 规格 / 依赖 / 交付命名 / 自动范围引用必须自洽，
        被引用对象被删时在这里定位冲突，不静默移除约束。
"""
from __future__ import annotations

from datetime import datetime

import pytest

from app.agents.requirements_agent import blueprint_advisories, validate_blueprint
from app.agents.review_agent import CheckContext, run_deterministic
from app.models import RESULT_FAILED, BlueprintVersion, Task
from app.schemas import Blueprint, DraftResult, FieldDef, RuleDef, SlotDef
from app.services import tasks as task_service
from app.services.tasks import PublishBlocked


def _task(db):
    t = Task(name="比赛报名", mode="open", subject_kind="team",
             timezone="Asia/Shanghai", status="draft")
    db.add(t)
    db.flush()
    return t


def _save(db, task, blueprint, source_text="", version=1):
    bp = BlueprintVersion(task_id=task.id, version=version,
                          blueprint_json=blueprint.model_dump_json(),
                          source_text=source_text, status="draft")
    db.add(bp)
    db.flush()
    return bp


def _class_bp():
    """自洽的确定性蓝图：字段 name + 槽位 report + slot_constraints 规则。"""
    return Blueprint(
        task_scope={"name": "团课报告收集"},
        fields=[FieldDef(id="name", label="姓名")],
        slots=[SlotDef(id="report", label="报告", formats=["pdf"], max_count=1)],
        rules=[RuleDef(id="R1", statement="材料格式与数量符合要求",
                       requirement_source="提交 PDF 格式报告一份",
                       executor="deterministic",
                       check={"kind": "slot_constraints", "slot": "report"})],
    )


# ---------------------------------------------------------------- V01
def test_v01_publish_blocked_when_source_unlocatable(db_session):
    """来源引用无法在原始要求中定位 → 发布拦截（防暗加要求）。"""
    task = _task(db_session)
    bp = _class_bp()
    bp.rules[0].requirement_source = "组织者从未提出的签名要求"
    ver = _save(db_session, task, bp, source_text="请提交团课报告一份")
    with pytest.raises(PublishBlocked) as ei:
        task_service.publish(db_session, task, ver.id)
    assert "无法在原始要求中定位" in str(ei.value)


def test_v01_publish_ok_when_source_locatable(db_session):
    """来源可在原始要求中定位 → 正常发布。"""
    task = _task(db_session)
    ver = _save(db_session, task, _class_bp(), source_text="提交 PDF 格式报告一份")
    out = task_service.publish(db_session, task, ver.id)
    assert out.status == "published"
    assert task.status == "collecting"


def test_v01_template_draft_without_source_can_publish(db_session):
    """模板草案没有组织者原始输入（source_text 为空）→ V01 不拦截，可发布。"""
    task = _task(db_session)
    ver = task_service.draft_from_template(db_session, task, "class_report")
    out = task_service.publish(db_session, task, ver.id)
    assert out.status == "published"


def test_v01_advisory_when_time_clue_without_policy():
    """原始要求提到截止而蓝图无时间策略 → 非阻塞提醒，不猜默认值。"""
    bp = _class_bp()
    warns = blueprint_advisories(bp, "11 月 8 日 18:00 前提交团课报告")
    assert any("截止" in w for w in warns)
    # 蓝图已设置截止后不再提醒
    bp.time_policy.first_deadline = datetime(2026, 11, 8, 18, 0)
    assert blueprint_advisories(bp, "11 月 8 日 18:00 前提交团课报告") == []


def test_v01_source_accumulates_across_revisions(db_session, stub_llm):
    """多轮修订的来源逐轮累积：后轮草案的来源引用可在早期输入中定位。"""
    task = _task(db_session)
    ver = _save(db_session, task, _class_bp(), source_text="提交 PDF 格式报告一份")
    stub_llm.responses = [{
        "blueprint": {
            "task_scope": {"name": "团课报告收集", "mode": "open", "subject_kind": "team"},
            "fields": [{"id": "name", "label": "姓名"}],
            "slots": [{"id": "report", "label": "报告",
                       "formats": ["pdf", "docx"], "max_count": 1}],
            "rules": [{"id": "R1", "statement": "材料格式与数量符合要求",
                       "requirement_source": "提交 PDF 格式报告一份",
                       "executor": "deterministic", "capability": "supported",
                       "check": {"kind": "slot_constraints", "slot": "report"}}],
            "time_policy": {"timezone": "Asia/Shanghai"},
        },
        "clarifications": [],
        "publish_summary": [],
    }]
    result, bp2, _impact = task_service.revise_draft(
        db_session, task, ver.id, requirement="格式改为 PDF 或 DOCX",
        answered={"截止时间": "11 月 8 日 18:00"}, instruction="", client=stub_llm)
    assert bp2.version > ver.version  # 有实质变化，产生新版本
    assert "提交 PDF 格式报告一份" in bp2.source_text      # 历史来源不丢
    assert "格式改为 PDF 或 DOCX" in bp2.source_text
    assert "11 月 8 日 18:00" in bp2.source_text


# ---------------------------------------------------------------- V02
def test_v02_attitude_rule_cannot_claim_auto():
    """态度类表述 + 宣称可自动鉴定 → 校验错误。"""
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="作品须体现认真态度",
                            requirement_source="作品须体现认真态度",
                            executor="semantic"))
    errors = validate_blueprint(bp)
    assert any("自动鉴定" in e for e in errors)


def test_v02_attitude_rule_human_only_passes():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="作品须体现认真态度",
                            requirement_source="作品须体现认真态度",
                            executor="human_only"))
    assert validate_blueprint(bp) == []


def test_v02_attitude_rule_needs_human_passes():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="作品须有原创性",
                            requirement_source="作品须有原创性",
                            executor="semantic", capability="needs_human"))
    assert validate_blueprint(bp) == []


def test_v02_publish_blocked_for_attitude_rule(db_session):
    task = _task(db_session)
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="作品须体现认真态度",
                            requirement_source="作品须体现认真态度",
                            executor="deterministic",
                            check={"kind": "slot_constraints", "slot": "report"}))
    ver = _save(db_session, task, bp, source_text="作品须体现认真态度")
    with pytest.raises(PublishBlocked) as ei:
        task_service.publish(db_session, task, ver.id)
    assert "自动鉴定" in str(ei.value)


# ---------------------------------------------------------------- V03
@pytest.mark.parametrize("cond", [
    "track==实物",
    "track!=数字",
    "track==实物 or track==数字",
    "track==实物 and term==2026",
])
def test_v03_supported_conditions_pass(cond):
    bp = Blueprint(
        fields=[FieldDef(id="track", label="赛道", required_condition=cond),
                FieldDef(id="term", label="期次")],
        slots=[SlotDef(id="report", label="报告")],
        rules=[RuleDef(id="R1", statement="提交报告",
                       requirement_source="提交报告", executor="semantic")],
    )
    assert validate_blueprint(bp) == []


@pytest.mark.parametrize("cond", [
    "track>2",              # 大小比较
    "size>=10",             # 区间比较
    "contains(track,实物)",  # 函数调用
    "(track==实物)",         # 括号
    "track like 实物",       # 关键字
])
def test_v03_unsupported_conditions_blocked(cond):
    bp = Blueprint(
        fields=[FieldDef(id="track", label="赛道", required_condition=cond)],
        slots=[SlotDef(id="report", label="报告")],
        rules=[RuleDef(id="R1", statement="提交报告",
                       requirement_source="提交报告", executor="semantic")],
    )
    errors = validate_blueprint(bp)
    assert any("不受支持的形式" in e for e in errors)


def test_v03_runtime_unsupported_condition_fails_loudly():
    """运行期遇到不受支持的条件：判 failed 并提示改写/人工，不静默通过。"""
    bp = Blueprint(
        fields=[FieldDef(id="track", label="赛道")],
        slots=[SlotDef(id="photo", label="照片", required_condition="track>2")],
        rules=[RuleDef(id="R1", statement="实物赛道须交照片",
                       requirement_source="实物赛道须交照片",
                       executor="deterministic",
                       check={"kind": "slot_presence", "slot": "photo"})],
    )
    out = run_deterministic(bp.rules[0], CheckContext(
        blueprint=bp, fields={"track": "实物"}, members=[], files=[]))
    assert out.result == RESULT_FAILED
    assert "不受支持" in out.explanation
    assert "人工" in out.next_step


# ---------------------------------------------------------------- V04
def test_v04_check_references_missing_field():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="必须填写联系方式",
                            requirement_source="必须填写联系方式",
                            executor="deterministic",
                            check={"kind": "field_required", "field": "ghost"}))
    errors = validate_blueprint(bp)
    assert any("不存在的字段 ghost" in e for e in errors)


def test_v04_check_references_missing_slot():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="须交作品",
                            requirement_source="须交作品",
                            executor="deterministic",
                            check={"kind": "slot_presence", "slot": "ghost"}))
    errors = validate_blueprint(bp)
    assert any("不存在的槽位 ghost" in e for e in errors)


def test_v04_unknown_check_kind_blocked():
    bp = _class_bp()
    bp.rules[0].check = {"kind": "magic_compare"}
    errors = validate_blueprint(bp)
    assert any("magic_compare" in e and "不受支持" in e for e in errors)


def test_v04_deterministic_without_check_blocked():
    bp = _class_bp()
    bp.rules[0].check = None
    errors = validate_blueprint(bp)
    assert any("没有 check 规格" in e for e in errors)


def test_v04_team_size_range_inverted_blocked():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="R2", statement="团队 5-2 人",
                            requirement_source="团队 5-2 人",
                            executor="deterministic",
                            check={"kind": "team_size", "min": 5, "max": 2}))
    errors = validate_blueprint(bp)
    assert any("大于 max" in e for e in errors)


def test_v04_delivery_naming_missing_field_blocked():
    bp = _class_bp()
    bp.delivery = {"naming": "{field:ghost}_报告"}
    errors = validate_blueprint(bp)
    assert any("交付命名" in e and "ghost" in e for e in errors)


def test_v04_auto_scope_ghost_rule_blocked():
    bp = _class_bp()
    bp.auto_scope = ["GHOST"]
    errors = validate_blueprint(bp)
    assert any("GHOST" in e for e in errors)


def test_v04_auto_scope_human_rule_blocked():
    bp = _class_bp()
    bp.rules.append(RuleDef(id="H1", statement="人工复核着装",
                            requirement_source="人工复核着装",
                            executor="human_only"))
    bp.auto_scope = ["H1"]
    errors = validate_blueprint(bp)
    assert any("人工规则" in e for e in errors)


def test_v04_depends_on_missing_rule_blocked():
    bp = _class_bp()
    bp.rules[0].depends_on = ["R9"]
    errors = validate_blueprint(bp)
    assert any("R9" in e for e in errors)


def test_v04_time_conflict_still_blocked():
    """时间冲突这一原有拦截不回归。"""
    bp = _class_bp()
    bp.time_policy.open_at = datetime(2026, 11, 10, 9, 0)
    bp.time_policy.first_deadline = datetime(2026, 11, 8, 18, 0)
    errors = validate_blueprint(bp)
    assert any("开放时刻必须早于首次截止" in e for e in errors)


# ---------------------------------------------------------------- 发布阻塞/提醒拆分
def test_publish_allowed_with_advisory_only(db_session):
    """只有非阻塞提醒（如未设时间）时允许发布，提醒写入审计。"""
    task = _task(db_session)
    bp = _class_bp()
    ver = _save(db_session, task, bp,
                source_text="11 月 8 日 18:00 前提交 PDF 格式报告一份")
    out = task_service.publish(db_session, task, ver.id)
    assert out.status == "published"
    assert task.status == "collecting"


def test_publish_still_blocked_by_hard_error(db_session):
    """硬校验错误仍然拦截，不会被提醒豁免逻辑放过。"""
    task = _task(db_session)
    bp = _class_bp()
    bp.rules[0].check = {"kind": "magic_compare"}
    ver = _save(db_session, task, bp, source_text="提交 PDF 格式报告一份")
    with pytest.raises(PublishBlocked) as ei:
        task_service.publish(db_session, task, ver.id)
    assert "magic_compare" in str(ei.value)


def test_split_publish_checks_separates_advisory():
    bp = _class_bp()
    src = "11 月 8 日 18:00 前提交 PDF 格式报告一份"
    draft = DraftResult(blueprint=bp, warnings=blueprint_advisories(bp, src))
    ver = BlueprintVersion(version=1, blueprint_json=bp.model_dump_json(),
                           source_text=src, status="draft")
    blocking, advisories = task_service.split_publish_checks(bp, ver, draft)
    assert blocking == []
    assert advisories and "截止" in advisories[0]
