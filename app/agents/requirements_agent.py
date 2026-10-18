"""需求 Agent（方案表 3 / 第 3 节）。

职责：把自然语言要求编译成结构化蓝图草案。
边界：不自行发布、不外发、不读取其他任务、不替组织者批准新增要求；
      不暗加字数、签章、签到等组织者未提出的门槛（由程序校验来源引用）。
"""
from __future__ import annotations

import json
from typing import Optional

from ..llm import LLMClient, LLMError, LLMUnavailable, get_client
from ..schemas import (
    Blueprint,
    Capability,
    Clarification,
    DraftResult,
    Executor,
    FieldDef,
    RuleDef,
    SlotDef,
    TimePolicy,
)

SYSTEM_PROMPT = """你是"收齐啦"平台的需求 Agent。把组织者的自然语言收集要求编译成结构化任务蓝图草案。

硬性规则（必须遵守）：
1. 只能从原始要求中提取规则。每条规则必须给出 requirement_source，即原始要求中的原文引用。
   禁止添加组织者没有提出的要求（如字数、签章、签到、格式细则）。
2. 规则能力必须如实标注：
   - deterministic: 可由程序确定性核验（数量、大小、页数、格式、人数、联系人是否在成员列表、条件必交）
   - semantic: 需要理解文档内容（如标题期次、要素是否存在）
   - cross_material: 需要跨材料/字段一致性比对
   - human_only: 只能人工判断（如态度、真实性、资格）
   capability 取值：supported（可自动）、needs_human（需人工）、needs_clarification（需澄清）。
3. 只问高影响澄清问题；已知信息不重复追问；没有歧义就不要编造问题。
4. 不得自行决定发布；你只产出草案与发布摘要，由组织者确认。
5. 空输入或信息不足时，不要虚构要求，改用 clarifications 提出澄清。

只输出 JSON，格式：
{
  "blueprint": {
    "task_scope": {"name": "...", "description": "...", "template": "...", "mode": "roster|open", "subject_kind": "individual|team"},
    "fields": [{"id":"...","label":"...","type":"text|enum|date|number","options":[],"required":true,"required_condition":null,"purpose":"...","visibility":"organizer|submitter"}],
    "slots": [{"id":"...","label":"...","formats":["pdf"],"max_count":1,"max_size_mib":10,"max_pages":20,"required_condition":null}],
    "rules": [{"id":"...","statement":"...","requirement_source":"原文引用","executor":"...","capability":"...","severity":"blocking|advisory","depends_on":[],"clarification_question":null}],
    "time_policy": {"timezone":"Asia/Shanghai","open_at":null,"first_deadline":null,"correction_deadline":null},
    "auto_scope": ["规则ID"],
    "manual_acceptance": true,
    "eligibility_required": false,
    "delivery": {},
    "governance": {}
  },
  "clarifications": [{"question":"...","why":"...","affects_rule_ids":[]}],
  "publish_summary": ["逐项确认：对象/材料/检查能力/双截止/验收/交付/用途/模型处理/留存"],
  "warnings": []
}
"""

REVISION_SYSTEM_PROMPT = """你是"收齐啦"平台的需求 Agent。组织者在结构化编辑器基础上提出了修改意见。
请输出修改后的完整蓝图 JSON（格式与首次起草相同），并保持未提及部分不变。
保持字段稳定 ID 不变；不要暗加要求；修改要有据可依，引用原始要求。只输出 JSON。"""


def _build_user_prompt(
    requirement_text: str,
    template: Optional[str],
    answered: Optional[dict],
    current_draft: Optional[Blueprint],
    instruction: str = "",
) -> str:
    parts = [f"【原始要求】\n{requirement_text.strip()}"]
    if template:
        parts.append(f"【选用模板】{template}")
    if answered:
        parts.append("【组织者已回答的澄清】\n" + json.dumps(answered, ensure_ascii=False, indent=2))
    if instruction and instruction.strip():
        parts.append(f"【本次修改意见】\n{instruction.strip()}")
    if current_draft is not None:
        parts.append("【当前草案】\n" + current_draft.model_dump_json(indent=2))
    return "\n\n".join(parts)

def _parse_draft(payload: dict) -> DraftResult:
    bp = payload.get("blueprint") or {}
    blueprint = Blueprint(
        task_scope=bp.get("task_scope") or {},
        fields=[FieldDef(**f) for f in bp.get("fields", [])],
        slots=[SlotDef(**s) for s in bp.get("slots", [])],
        rules=[RuleDef(**r) for r in bp.get("rules", [])],
        time_policy=TimePolicy(**bp.get("time_policy", {})),
        auto_scope=bp.get("auto_scope", []),
        manual_acceptance=bp.get("manual_acceptance", True),
        eligibility_required=bp.get("eligibility_required", False),
        delivery=bp.get("delivery") or {},
        governance=bp.get("governance") or {},
    )
    return DraftResult(
        blueprint=blueprint,
        clarifications=[Clarification(**c) for c in payload.get("clarifications", [])],
        publish_summary=payload.get("publish_summary", []),
        warnings=payload.get("warnings", []),
    )


def validate_blueprint(blueprint: Blueprint, source_text: str = "") -> list[str]:
    """程序侧发布校验（第 3 节）：
    引用存在、日期顺序、重复 ID、依赖环、规则来源可定位。
    返回错误列表；关键错误应阻止发布。
    """
    errors: list[str] = []
    field_ids = [f.id for f in blueprint.fields]
    rule_ids = [r.id for r in blueprint.rules]
    slot_ids = [s.id for s in blueprint.slots]

    for name, ids in (("字段", field_ids), ("材料槽位", slot_ids), ("规则", rule_ids)):
        dup = {x for x in ids if ids.count(x) > 1}
        if dup:
            errors.append(f"{name} ID 重复: {sorted(dup)}")

    known = set(field_ids) | set(slot_ids)
    for f in blueprint.fields:
        if f.required_condition:
            for token in _condition_refs(f.required_condition):
                if token not in known:
                    errors.append(f"字段 {f.id} 的必填条件引用了不存在的 {token}")
    for s in blueprint.slots:
        if s.required_condition:
            for token in _condition_refs(s.required_condition):
                if token not in known:
                    errors.append(f"槽位 {s.id} 的条件必交引用了不存在的 {token}")

    # 依赖环检测
    graph = {r.id: [d for d in r.depends_on if d in rule_ids] for r in blueprint.rules}
    for rid in graph:
        if _has_cycle(graph, rid, set()):
            errors.append(f"规则 {rid} 存在依赖环")
            break

    tp = blueprint.time_policy
    if tp.open_at and tp.first_deadline and tp.open_at >= tp.first_deadline:
        errors.append("时间冲突：开放时刻必须早于首次截止")
    if tp.first_deadline and tp.correction_deadline and tp.first_deadline >= tp.correction_deadline:
        errors.append("时间冲突：补正截止必须晚于首次截止")

    # 规则来源必须能在原文定位（防暗加要求的程序校验）
    if source_text.strip():
        for r in blueprint.rules:
            src = (r.requirement_source or "").strip()
            if not src:
                errors.append(f"规则 {r.id} 缺少要求来源")
            elif src not in source_text and len(src) >= 8:
                errors.append(f"规则 {r.id} 的来源引用无法在原始要求中定位，疑似暗加要求")
    return errors


def _condition_refs(expr: str) -> list[str]:
    """从简单条件表达式中提取标识符，如 track==physical -> [track]。"""
    import re

    return [t for t in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", expr) if t not in {"and", "or", "not", "in"}]


def _has_cycle(graph: dict, node: str, seen: set) -> bool:
    if node in seen:
        return True
    seen = seen | {node}
    for nxt in graph.get(node, []):
        if _has_cycle(graph, nxt, seen):
            return True
    return False


def draft_blueprint(
    requirement_text: str,
    template: Optional[str] = None,
    answered: Optional[dict] = None,
    current_draft: Optional[Blueprint] = None,
    instruction: str = "",
    client: Optional[LLMClient] = None,
) -> DraftResult:
    """需求 Agent 主入口：自然语言要求 → 蓝图草案。"""
    if not requirement_text.strip() and current_draft is None:
        return DraftResult(
            blueprint=Blueprint(),
            warnings=["输入为空：不生成虚构要求，请填写原始要求或选择模板"],
        )
    client = client or get_client()
    system = REVISION_SYSTEM_PROMPT if current_draft is not None else SYSTEM_PROMPT
    try:
        payload = client.chat_json(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": _build_user_prompt(requirement_text, template, answered, current_draft, instruction)},
            ]
        )
    except LLMUnavailable as e:
        return DraftResult(
            blueprint=current_draft or Blueprint(),
            warnings=[f"需求 Agent 暂不可用（{e}）。已保留当前草案，请手动编辑或稍后重试。"],
        )
    result = _parse_draft(payload)
    result.warnings.extend(validate_blueprint(result.blueprint, requirement_text))
    return result


def template_blueprint(template: str) -> Blueprint:
    """确定性模板骨架（不经过模型，避免虚构要求）。"""
    if template == "class_report":
        return Blueprint(
            task_scope={"name": "团课报告收集", "template": "class_report", "mode": "roster", "subject_kind": "individual"},
            fields=[
                FieldDef(id="name", label="姓名", required=True, purpose="与名册核对"),
                FieldDef(id="term", label="期次", required=True, purpose="核对报告期次"),
                FieldDef(id="class_name", label="班级", required=True, purpose="按班级整理"),
            ],
            slots=[SlotDef(id="report", label="团课报告", formats=["pdf", "docx"], max_count=1, max_size_mib=10, max_pages=20)],
            rules=[],
            time_policy=TimePolicy(),
            delivery={"group_by": "class_name", "naming": "{subject_id}_{field:name}"},
        )
    if template == "contest_signup":
        return Blueprint(
            task_scope={"name": "比赛报名", "template": "contest_signup", "mode": "open", "subject_kind": "team"},
            fields=[
                FieldDef(id="team_name", label="队名", required=True),
                FieldDef(id="project_name", label="项目名", required=True),
                FieldDef(id="contact", label="联系人", required=True),
                FieldDef(id="email", label="邮箱", required=True),
                FieldDef(id="track", label="赛道", type="enum", options=["数字", "实物"], required=True),
            ],
            slots=[
                SlotDef(id="proposal", label="项目简介", formats=["pdf"], max_count=1, max_size_mib=10),
                SlotDef(id="photo", label="实物照片", formats=["jpg", "png"], max_count=3, required_condition="track==实物"),
            ],
            rules=[],
            time_policy=TimePolicy(),
            delivery={"group_by": "track", "naming": "{subject_id}_{field:team_name}"},
        )
    return Blueprint(task_scope={"template": template})


def blueprint_diff(old: Blueprint, new: Blueprint) -> dict:
    """结构化修订影响：按稳定 ID 比较字段/材料/规则变化（方案：显示修改影响）。"""
    def _index(items):
        return {getattr(i, "id"): i for i in items}

    def _cmp(old_items, new_items):
        o, n = _index(old_items), _index(new_items)
        return {
            "added": sorted(set(n) - set(o)),
            "removed": sorted(set(o) - set(n)),
            "changed": sorted(i for i in set(o) & set(n)
                              if o[i].model_dump() != n[i].model_dump()),
        }

    diff = {
        "fields": _cmp(old.fields, new.fields),
        "slots": _cmp(old.slots, new.slots),
        "rules": _cmp(old.rules, new.rules),
        "auto_scope": {"added": sorted(set(new.auto_scope) - set(old.auto_scope)),
                       "removed": sorted(set(old.auto_scope) - set(new.auto_scope))},
        "time_policy_changed": old.time_policy.model_dump() != new.time_policy.model_dump(),
        "manual_acceptance_changed": old.manual_acceptance != new.manual_acceptance,
        "eligibility_required_changed": old.eligibility_required != new.eligibility_required,
    }
    parts = []
    for key in ("fields", "slots", "rules"):
        d = diff[key]
        if d["added"]:
            parts.append(f"{key}+{len(d['added'])}")
        if d["removed"]:
            parts.append(f"{key}-{len(d['removed'])}")
        if d["changed"]:
            parts.append(f"{key}~{len(d['changed'])}")
    if diff["time_policy_changed"]:
        parts.append("时间策略变化")
    if diff["manual_acceptance_changed"] or diff["eligibility_required_changed"]:
        parts.append("验收/资格设置变化")
    diff["summary"] = "；".join(parts) if parts else "无实质变化"
    return diff
