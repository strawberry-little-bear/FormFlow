"""需求 Agent（方案表 3 / 第 3 节）。

职责：把自然语言要求编译成结构化蓝图草案。
边界：不自行发布、不外发、不读取其他任务、不替组织者批准新增要求；
      不暗加字数、签章、签到等组织者未提出的门槛（由程序校验来源引用）。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Optional
from datetime import datetime
from zoneinfo import ZoneInfo

from ..llm import (DocumentInput, LLMClient, LLMError, LLMInputUnsupported,
                   LLMUnavailable, get_client)
from ..config import settings
from ..parsing import ParseError, format_parse_text, parse_file
from pydantic import ValidationError
from ..schemas import (
    Blueprint,
    Capability,
    Clarification,
    Executor,
    DraftResult,
    FieldDef,
    FieldType,
    RuleDef,
    SlotDef,
    SourceMaterialProvenance,
    SourceMaterialSummary,
    TimePolicy,
)

SOURCE_MATERIAL_KINDS = {"notice", "roster", "template", "attachment", "other"}
MAX_SOURCE_MATERIALS = 8
MAX_SOURCE_MATERIAL_CHARS = 12_000
MAX_SOURCE_TOTAL_CHARS = 30_000
MAX_CLARIFICATIONS = 3
_UNVERIFIABLE_SOURCE_MARKERS = (
    "（原始文件尚未形成文字缓存",
    "【文件存在未读页面】",
    "【未读页面：",
    "：未读】",
    "【覆盖提示】",
    "【文件解析失败：",
    "【解析失败页面：",
)


@dataclass(frozen=True)
class RequirementsSkillSpec:
    """Executable contract for the requirements Agent workflow.

    The prompt explains the method to the model; this contract gives the
    application something concrete to validate and expose in the runtime
    manifest.  The durable request queue remains the execution harness for
    this application-owned skill.
    """

    name: str
    description: str
    stages: tuple[str, ...]
    max_source_materials: int
    max_source_material_chars: int
    max_source_total_chars: int
    max_clarifications: int
    idempotency: str
    version_conflict: str
    human_gate: str


REQUIREMENTS_DRAFT_SKILL = RequirementsSkillSpec(
    name="requirements_draft",
    description="读取并分类来源资料，整理有来源的蓝图草案，提出澄清；不自行发布。",
    stages=(
        "classify_sources",
        "extract_requirements",
        "check_conflicts",
        "compile_blueprint",
        "ask_clarifications",
        "return_editable_draft",
        "organizer_publish_gate",
    ),
    max_source_materials=MAX_SOURCE_MATERIALS,
    max_source_material_chars=MAX_SOURCE_MATERIAL_CHARS,
    max_source_total_chars=MAX_SOURCE_TOTAL_CHARS,
    max_clarifications=MAX_CLARIFICATIONS,
    idempotency="task_account_request_id",
    version_conflict="fail_closed",
    human_gate="发布前必须由组织者确认",
)


def requirements_skill_manifest() -> dict[str, object]:
    """Return the non-sensitive, server-owned requirements Skill contract."""
    return {
        "name": REQUIREMENTS_DRAFT_SKILL.name,
        "description": REQUIREMENTS_DRAFT_SKILL.description,
        "stages": list(REQUIREMENTS_DRAFT_SKILL.stages),
        "source_limits": {
            "materials": REQUIREMENTS_DRAFT_SKILL.max_source_materials,
            "per_material_chars": REQUIREMENTS_DRAFT_SKILL.max_source_material_chars,
            "total_chars": REQUIREMENTS_DRAFT_SKILL.max_source_total_chars,
        },
        "max_clarifications": REQUIREMENTS_DRAFT_SKILL.max_clarifications,
        "idempotency": REQUIREMENTS_DRAFT_SKILL.idempotency,
        # Keep the explicit runtime-facing name used by older showcase clients.
        "request_idempotency": REQUIREMENTS_DRAFT_SKILL.idempotency,
        "version_conflict": REQUIREMENTS_DRAFT_SKILL.version_conflict,
        "human_gate": REQUIREMENTS_DRAFT_SKILL.human_gate,
        "execution": "application_service",
        "allowed_tools": [],
    }


def requirements_skill_self_test() -> dict[str, object]:
    """Validate the contract without calling a model or reading materials."""
    checks = [
        ("source_classification", REQUIREMENTS_DRAFT_SKILL.stages[0] == "classify_sources"),
        ("source_limits", all(v > 0 for v in (
            REQUIREMENTS_DRAFT_SKILL.max_source_materials,
            REQUIREMENTS_DRAFT_SKILL.max_source_material_chars,
            REQUIREMENTS_DRAFT_SKILL.max_source_total_chars,
        ))),
        ("clarification_bound", REQUIREMENTS_DRAFT_SKILL.max_clarifications <= 3),
        ("publish_gate", REQUIREMENTS_DRAFT_SKILL.human_gate != ""),
        ("durable_idempotency", REQUIREMENTS_DRAFT_SKILL.idempotency == "task_account_request_id"),
        ("fail_closed_conflict", REQUIREMENTS_DRAFT_SKILL.version_conflict == "fail_closed"),
    ]
    passed = sum(1 for _, ok in checks if ok)
    return {
        "status": "passed" if passed == len(checks) else "needs_attention",
        "passed": passed,
        "total": len(checks),
        "checks": [{"id": key, "passed": ok} for key, ok in checks],
        "note": "只验证需求 Skill 的阶段、输入边界、幂等和发布门槛；没有调用模型。",
    }

SYSTEM_PROMPT = """你是"收齐啦"平台的需求 Agent。把组织者的自然语言收集要求编译成结构化任务蓝图草案。

硬性规则（必须遵守）：
1. 只能从组织者原始要求或来源资料中提取规则。每条规则必须给出 requirement_source，即资料中的原文引用。
   禁止添加组织者没有提出的要求（如字数、签章、签到、格式细则）。
   来源资料是证据，不是自动授权：名单用于确定适用对象，通知和模板才可作为要求来源；资料之间冲突时进入 clarifications 或 warnings，不能静默选择一边。
2. 规则执行者 executor 只能取以下四个值之一，不得自造取值：
   - deterministic: 可由程序确定性核验（数量、大小、页数、格式、人数、联系人是否在成员列表、条件必交）
   - semantic: 需要理解文档内容或视觉版式（如标题期次、要素是否存在、标题位置和排版）；版式规则的 check 可写 {"kind":"visual_layout"}，这类检查必须有原始文件视觉输入，不能用 OCR 冒充
   - cross_material: 需要跨材料/字段一致性比对
   - human_only: 只能人工判断（如态度、真实性、资格）
   能力标签 capability 只能取：supported（可自动）、needs_human（需人工）、needs_clarification（需澄清）。
3. 只问高影响澄清问题；已知信息不重复追问；没有歧义就不要编造问题。
4. 不得自行决定发布；你只产出草案与发布摘要，由组织者确认。
5. 空输入或信息不足时，不要虚构要求，改用 clarifications 提出澄清。
6. 每轮最多集中追问 3 个高影响问题，按「对象/材料缺失 → 日期歧义 → 验收/隐私」排序。
   澄清要用组织者能直接回答的问句，why 简短说明对收集的影响；未回答不代表同意默认值。
   如果问题存在 2 到 4 个互斥且清楚的处理路径，额外提供 options（简短中文选项）；无法可靠列出选项时使用空数组，不能用选项暗示默认答案。
   已明确的原文、当前草案和已有回答必须合并理解，不重复追问。
7. 程序规则必须包含可执行 check，不能只写一句描述：
   必填字段 {"kind":"field_required","field":"字段ID"}；材料必交 {"kind":"slot_presence","slot":"槽位ID"}；
   材料格式/数量/大小/页数 {"kind":"slot_constraints","slot":"槽位ID"}；
   团队人数 {"kind":"team_size","min":2,"max":5}；联系人在成员中 {"kind":"contact_in_members","field":"联系人字段ID"}；
   成员一致 {"kind":"members_match","field":"成员字段ID"}。只使用需求明确提出的限制和真实 ID。
   无法表示为这些规格的确定性规则不得谎称已支持，应标为需澄清或人工项。
8. 日期必须参考提供的当前日期和时区；含糊或已过期的截止先澄清，不能随意猜年份。
9. publish_summary 用简明中文写实际采纳的内容和待确认事项，不用模板化口号。
10. 用平实、友好的中文写说明，像同事在一起把事情说清楚；不说教、不责备、不堆制度术语，也不使用“智能赋能、全面闭环”等宣传话。原要求不明确时坦诚说还不确定，并问一个组织者能直接回答的问题；不能为了显得周到而自作主张补要求。
11. 每条 requirement_source 必须能在原始要求或已提供来源资料的正文中逐字定位；不要把来源资料的名称、名单内容或模型推断当作原文引用。
12. 如果要求来自带 id 的来源资料，必须填写 source_material_id，并填写 source_locator（例如 p.2、表格第 3 行、field:deadline）；名单只能说明适用对象，不能作为收集要求来源。无法确定位置时不要猜，改为澄清或人工项。文字缓存中的 `【第 N 页】` 是服务端保留的页码边界，应优先转换为 `p.N`；`未读` 或 `解析失败` 标记不能作为要求原文引用。

只输出 JSON，格式：
{
  "blueprint": {
    "task_scope": {"name": "...", "description": "...", "template": "...", "mode": "roster|open", "subject_kind": "individual|team"},
    "fields": [{"id":"...","label":"...","type":"text|enum|date|number","options":[],"required":true,"required_condition":null,"purpose":"...","visibility":"organizer|submitter"}],
    "slots": [{"id":"...","label":"...","formats":["pdf"],"max_count":1,"max_size_mib":10,"max_pages":20,"required_condition":null}],
    "rules": [{"id":"...","statement":"...","requirement_source":"原文引用","source_material_id":"notice或null","source_locator":"p.2或field:deadline","executor":"deterministic|semantic|cross_material|human_only","capability":"supported|needs_human|needs_clarification","severity":"blocking|advisory","depends_on":[],"clarification_question":null,"check":null}],
    "time_policy": {"timezone":"Asia/Shanghai","open_at":null,"first_deadline":null,"correction_deadline":null},
    "auto_scope": ["规则ID"],
    "manual_acceptance": true,
    "eligibility_required": false,
    "delivery": {},
    "governance": {}
  },
  "clarifications": [{"question":"...","why":"...","options":["方案 A","方案 B"],"affects_rule_ids":[]}],
  "publish_summary": ["逐项确认：对象/材料/检查能力/双截止/验收/交付/用途/模型处理/留存"],
  "warnings": []
}
"""

REVISION_SYSTEM_PROMPT = """你是"收齐啦"平台的需求 Agent。组织者在结构化编辑器基础上提出了修改意见。
硬性要求：
1. 输出修改后的完整蓝图 JSON。【当前草案】中的全部字段、材料槽位、规则必须逐一保留；
   除修改意见明确要求删除或修改的内容外，一律原样保留（含稳定 ID 与 check 等程序规格），
   不得遗漏、不得重写、不得减少数量。
2. 时间策略（open_at / first_deadline / correction_deadline）未被修改意见提及时必须原样保留；
   日期时间使用 ISO 8601 格式，如 2026-11-08T18:00:00。
3. 保持字段稳定 ID 不变；不要暗加要求；修改要有据可依，引用原始要求或来源资料正文。名单只用于适用对象核对，资料冲突必须进入澄清或 warning。
4. executor 只能取 deterministic|semantic|cross_material|human_only；需要判断标题位置、对齐、页眉页脚等视觉版式时使用 semantic，并在 check 中写 {"kind":"visual_layout"}；没有明确的版式要求不要自行添加。
   capability 只能取 supported|needs_human|needs_clarification。
5. 面向组织者解释修改与澄清时保持简洁、自然、合作的语气，不用空泛口号；只说这次改动实际影响，不暗示已经发布或已取得组织者同意。
   如果问题存在 2 到 4 个互斥且清楚的处理路径，额外提供 options；无法可靠列出选项时使用空数组。
6. 规则若来自来源资料，保留原规则的 source_material_id 与 source_locator；修改意见没有改变来源时不得清空这两个字段。
只输出 JSON，格式（必须带 blueprint 外壳，与首次起草相同）：
{
  "blueprint": {
    "task_scope": {"name": "...", "description": "...", "template": "...", "mode": "roster|open", "subject_kind": "individual|team"},
    "fields": [{"id":"...","label":"...","type":"text|enum|date|number","options":[],"required":true,"required_condition":null,"purpose":"...","visibility":"organizer|submitter"}],
    "slots": [{"id":"...","label":"...","formats":["pdf"],"max_count":1,"max_size_mib":10,"max_pages":20,"required_condition":null}],
    "rules": [{"id":"...","statement":"...","requirement_source":"原文引用","source_material_id":"notice或null","source_locator":"p.2或field:deadline","executor":"deterministic|semantic|cross_material|human_only","capability":"supported|needs_human|needs_clarification","severity":"blocking|advisory","depends_on":[],"clarification_question":null,"check":null}],
    "time_policy": {"timezone":"Asia/Shanghai","open_at":null,"first_deadline":null,"correction_deadline":null},
    "auto_scope": ["规则ID"],
    "manual_acceptance": true,
    "eligibility_required": false,
    "delivery": {},
    "governance": {}
  },
  "clarifications": [],
  "publish_summary": [],
  "warnings": []
}"""


def normalize_source_materials(source_materials: Optional[list[dict]] = None) -> list[dict]:
    """Validate and normalize organizer-provided source material.

    Source text is deliberately bounded before it reaches the model or the
    durable request queue.  The normalized shape is also used for hashing so
    changing a notice, roster, or template cannot silently reuse an old job.
    """
    if source_materials is None:
        return []
    if not isinstance(source_materials, list):
        raise ValueError("来源资料必须是列表")
    if len(source_materials) > MAX_SOURCE_MATERIALS:
        raise ValueError(f"来源资料最多 {MAX_SOURCE_MATERIALS} 份")
    normalized: list[dict] = []
    seen: set[str] = set()
    total_chars = 0
    for index, raw in enumerate(source_materials, 1):
        if not isinstance(raw, dict):
            raise ValueError(f"第 {index} 份来源资料格式不正确")
        material_id = str(raw.get("id") or "").strip()
        name = str(raw.get("name") or "").strip()
        kind = str(raw.get("kind") or "").strip().lower()
        content = str(raw.get("content") or "").strip()
        if not material_id:
            raise ValueError(f"第 {index} 份来源资料缺少 id")
        if material_id in seen:
            raise ValueError(f"来源资料 id 重复：{material_id}")
        if not name:
            raise ValueError(f"来源资料 {material_id} 缺少名称")
        if kind not in SOURCE_MATERIAL_KINDS:
            allowed = "、".join(sorted(SOURCE_MATERIAL_KINDS))
            raise ValueError(f"来源资料 {material_id} 类型无效，请使用：{allowed}")
        if not content:
            raise ValueError(f"来源资料 {material_id} 不能为空")
        if len(content) > MAX_SOURCE_MATERIAL_CHARS:
            raise ValueError(f"来源资料 {material_id} 过长，单份最多 {MAX_SOURCE_MATERIAL_CHARS} 个字符")
        total_chars += len(content)
        if total_chars > MAX_SOURCE_TOTAL_CHARS:
            raise ValueError(f"来源资料总长度不能超过 {MAX_SOURCE_TOTAL_CHARS} 个字符")
        seen.add(material_id)
        normalized.append({"id": material_id, "name": name, "kind": kind, "content": content})
    return normalized


def source_material_summaries(source_materials: Optional[list[dict]] = None) -> list[SourceMaterialSummary]:
    """Return only safe metadata for the draft response and audit context."""
    return [SourceMaterialSummary(id=m["id"], name=m["name"], kind=m["kind"],
                                  chars=len(m["content"]))
            for m in normalize_source_materials(source_materials)]


def _source_provenance(
    source_materials: Optional[list[dict]], *, method: str = "none",
    status: str = "not_sent", detail: str = "",
) -> list[SourceMaterialProvenance]:
    """Build safe per-source input metadata without retaining material content."""
    return [SourceMaterialProvenance(id=material["id"], method=method,
                                     status=status, detail=detail)
            for material in normalize_source_materials(source_materials)]


def _fallback_method_from_text(content: str) -> str:
    """Infer only the safe display method from parser markers already in text."""
    text = str(content or "")
    if not text.strip() or text.startswith("（原始文件尚未"):
        return "unread"
    has_unread = any(marker in text for marker in ("：未读】", "【未读页面：", "【覆盖提示】"))
    has_failed = any(marker in text for marker in ("【解析失败页面：", "【文件解析失败："))
    if has_unread or has_failed:
        return "mixed" if "【第 " in text else "unread"
    return "text"


def _fallback_inputs(
    source_materials: list[dict], source_documents: list[DocumentInput], *,
    allow_ocr: bool,
) -> tuple[list[dict], list[SourceMaterialProvenance]]:
    """Prepare text/OCR inputs only after direct input is unavailable or disabled."""
    fallback_materials: list[dict] = []
    provenance: list[SourceMaterialProvenance] = []
    for material, document in zip(source_materials, source_documents):
        content = material["content"]
        parsed_method = ""
        detail = ""
        if not content or content.startswith("（原始文件尚未"):
            try:
                parsed = parse_file(document.path, allow_ocr=allow_ocr)
                content = format_parse_text(parsed)
                parsed_method = parsed.method if parsed.method in {"text", "ocr", "mixed"} else ""
                if parsed.unread_pages or parsed.failed_pages:
                    content += ("\n【覆盖提示】部分页面未读或解析失败，不能据此判定材料缺失"
                                if content else "【覆盖提示】文件存在未读或解析失败页面")
                    parsed_method = "mixed" if content and parsed.text_pages else "unread"
            except (ParseError, OSError) as exc:
                content = f"【文件解析失败：{str(exc)[:180]}】"
                parsed_method = "unread"
                detail = "文件解析失败，未据此判定材料缺失。"
        method = parsed_method or _fallback_method_from_text(content)
        if method == "ocr":
            detail = detail or "使用本机 OCR 形成文字输入；未读页面仍需人工核对。"
        elif method == "mixed":
            detail = detail or "文字解析/OCR 仅覆盖部分页面；未读页面仍需人工核对。"
        elif method == "unread":
            detail = detail or "未形成完整文字输入；不能据此判定材料缺失。"
        else:
            detail = detail or "使用已有文字解析结果作为模型输入。"
        fallback_materials.append({**material, "content": content})
        provenance.append(SourceMaterialProvenance(id=material["id"], method=method,
                                                   status="used", detail=detail))
    return normalize_source_materials(fallback_materials), provenance


def _source_material_prompt_parts(source_materials: Optional[list[dict]] = None) -> list[str]:
    return [
        f"【来源资料 {index} · {material['name']} · {material['kind']} · id={material['id']}】\n"
        f"{material['content']}"
        for index, material in enumerate(normalize_source_materials(source_materials), 1)
    ]


def _build_user_prompt(
    requirement_text: str,
    template: Optional[str],
    answered: Optional[dict],
    current_draft: Optional[Blueprint],
    instruction: str = "",
    source_materials: Optional[list[dict]] = None,
) -> str:
    now = datetime.now(ZoneInfo("Asia/Shanghai"))
    parts = [f"【当前日期与时区】{now.strftime('%Y-%m-%d %H:%M')} Asia/Shanghai"]
    if requirement_text.strip():
        parts.append(f"【原始要求】\n{requirement_text.strip()}")
    parts.extend(_source_material_prompt_parts(source_materials))
    if template:
        parts.append(f"【选用模板】{template}")
    if answered:
        parts.append("【组织者已回答的澄清】\n" + json.dumps(answered, ensure_ascii=False, indent=2))
    if instruction and instruction.strip():
        parts.append(f"【本次修改意见】\n{instruction.strip()}")
    if current_draft is not None:
        parts.append("【当前草案】\n" + current_draft.model_dump_json(indent=2))
    return "\n\n".join(parts)

_EXECUTOR_ALIASES = {
    "program": "deterministic", "programmatic": "deterministic", "code": "deterministic",
    "auto": "deterministic", "automatic": "deterministic",
    "ai": "semantic", "model": "semantic", "llm": "semantic", "agent": "semantic",
    "cross": "cross_material", "crosscheck": "cross_material", "consistency": "cross_material",
    "human": "human_only", "manual": "human_only", "organizer": "human_only",
}
_CAPABILITY_ALIASES = {
    "auto": "supported", "automatic": "supported",
    "human": "needs_human", "manual": "needs_human",
    "clarify": "needs_clarification", "clarification": "needs_clarification",
}
_FIELD_TYPE_ALIASES = {
    "string": "text", "str": "text", "textarea": "text",
    "select": "enum", "choice": "enum", "option": "enum",
    "datetime": "date", "int": "number", "integer": "number", "float": "number",
}
_SEVERITY_ALIASES = {"block": "blocking", "warn": "advisory", "warning": "advisory"}


def _norm_choice(value, allowed: set, aliases: dict, default: str,
                 warnings: list, what: str) -> str:
    """模型枚举值规整：命中即用；别名映射；无法识别时保守默认并记录 warning。

    保守方向：executor 默认 human_only（看不懂的规则绝不自动执行），
    capability 默认 needs_human，severity 默认 blocking，字段类型默认 text。
    """
    raw = str(value if value is not None else "").strip().lower()
    if raw in allowed:
        return raw
    if raw in aliases:
        return aliases[raw]
    warnings.append(f"{what} 无法识别（{value!r}），已按 {default} 保守处理")
    return default


def _parse_field(f: dict, warnings: list) -> FieldDef:
    f = dict(f)
    fid = f.get("id", "?")
    if "type" in f:
        f["type"] = _norm_choice(f.get("type"), {t.value for t in FieldType},
                                 _FIELD_TYPE_ALIASES, "text", warnings,
                                 f"字段 {fid} 的 type")
    for key in ("label", "purpose"):
        if key in f and f[key] is not None and not isinstance(f[key], str):
            warnings.append(f"字段 {fid} 的 {key} 不是字符串（{f[key]!r}），已转换为文本")
            f[key] = str(f[key])
    if f.get("visibility") is not None and not isinstance(f["visibility"], str):
        warnings.append(f"字段 {fid} 的 visibility 不是字符串（{f['visibility']!r}），已按 organizer 处理")
        f["visibility"] = "organizer"
    if f.get("required_condition") is not None and not isinstance(f["required_condition"], str):
        warnings.append(f"字段 {fid} 的 required_condition 不是字符串，已置空")
        f["required_condition"] = None
    return FieldDef(**f)


def _parse_rule(r: dict, warnings: list) -> RuleDef:
    r = dict(r)
    rid = r.get("id", "?")
    if "executor" in r:
        r["executor"] = _norm_choice(r.get("executor"), {e.value for e in Executor},
                                     _EXECUTOR_ALIASES, "human_only", warnings,
                                     f"规则 {rid} 的 executor")
    if "capability" in r:
        r["capability"] = _norm_choice(r.get("capability"), {c.value for c in Capability},
                                       _CAPABILITY_ALIASES, "needs_human", warnings,
                                       f"规则 {rid} 的 capability")
    if "severity" in r:
        r["severity"] = _norm_choice(r.get("severity"), {"blocking", "advisory"},
                                     _SEVERITY_ALIASES, "blocking", warnings,
                                     f"规则 {rid} 的 severity")
    for key in ("statement", "requirement_source", "clarification_question",
                "source_material_id", "source_locator"):
        if key in r and r[key] is not None and not isinstance(r[key], str):
            r[key] = str(r[key])
    return RuleDef(**r)


def _parse_slot(slot: dict, warnings: list) -> SlotDef:
    slot = dict(slot)
    sid = slot.get("id", "?")
    fmts = slot.get("formats")
    if isinstance(fmts, str):
        slot["formats"] = [fmts]  # 模型偶尔把格式列表写成单个字符串
    if slot.get("label") is not None and not isinstance(slot["label"], str):
        slot["label"] = str(slot["label"])
    if slot.get("required_condition") is not None and not isinstance(slot["required_condition"], str):
        warnings.append(f"材料槽位 {sid} 的 required_condition 不是字符串，已置空")
        slot["required_condition"] = None
    return SlotDef(**slot)


def _as_dict(value, warnings: list, what: str) -> dict:
    if isinstance(value, dict):
        return value
    if value not in (None, "", [], {}):
        warnings.append(f"{what} 不是对象，已忽略")
    return {}


def _as_str_list(value) -> list:
    if not isinstance(value, list):
        return []
    return [str(x) for x in value]


def _parse_clarifications(raw, warnings: list) -> list:
    """澄清项偶尔被模型写成纯字符串或结构不全：容错而非崩溃。"""
    out = []
    for c in raw if isinstance(raw, list) else []:
        if isinstance(c, str) and c.strip():
            out.append(Clarification(question=c.strip()))
            warnings.append(f"澄清项不是对象，已按问题文本处理：{c.strip()[:40]}")
        elif isinstance(c, dict):
            try:
                normalized = dict(c)
                raw_options = normalized.get("options", [])
                if raw_options in (None, ""):
                    raw_options = []
                if not isinstance(raw_options, list):
                    warnings.append(f"澄清项 options 不是列表，已忽略：{str(c)[:60]}")
                    raw_options = []
                options = list(dict.fromkeys(str(option).strip() for option in raw_options if str(option).strip()))
                if len(options) > 4:
                    warnings.append("澄清项选项超过 4 个，已截取前 4 个")
                    options = options[:4]
                normalized["options"] = options
                out.append(Clarification(**normalized))
            except ValidationError:
                warnings.append(f"澄清项结构不合法已忽略：{str(c)[:60]}")
    return out


def _parse_draft(payload: dict) -> DraftResult:
    warnings: list[str] = []
    bp = payload.get("blueprint") or {}
    if not bp and isinstance(payload, dict) and (
            "task_scope" in payload or "fields" in payload
            or "slots" in payload or "rules" in payload):
        bp = payload  # 模型直接返回了蓝图本体（未包 blueprint 外壳）
    try:
        blueprint = Blueprint(
            task_scope=_as_dict(bp.get("task_scope"), warnings, "task_scope"),
            fields=[_parse_field(f, warnings) for f in bp.get("fields", []) or []],
            slots=[_parse_slot(x, warnings) for x in bp.get("slots", []) or []],
            rules=[_parse_rule(r, warnings) for r in bp.get("rules", []) or []],
            time_policy=TimePolicy(**_as_dict(bp.get("time_policy"), warnings, "time_policy")),
            auto_scope=_as_str_list(bp.get("auto_scope")),
            manual_acceptance=bool(bp.get("manual_acceptance", True)),
            eligibility_required=bool(bp.get("eligibility_required", False)),
            delivery=_as_dict(bp.get("delivery"), warnings, "delivery"),
            governance=_as_dict(bp.get("governance"), warnings, "governance"),
        )
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(x) for x in first.get("loc", ()))
        raise LLMError(f"蓝图草案结构不合法（{loc}: {first.get('msg', '')}）") from e
    return DraftResult(
        blueprint=blueprint,
        clarifications=_parse_clarifications(payload.get("clarifications"), warnings),
        publish_summary=_as_str_list(payload.get("publish_summary")),
        warnings=warnings + _as_str_list(payload.get("warnings")),
    )


# ---------------------------------------------------------------- 程序侧校验组件
# V02：无可执行定义的态度类表述。命中后必须标人工/需澄清，
# 不得把"认真、态度"这类无法计算的要求包装成可自动鉴定的能力。
_VAGUE_ATTITUDE_WORDS = ("认真", "态度", "用心", "真情实感", "原创性", "独创性", "高质量", "优质")

# V03：条件表达式仅支持 字段==值 / 字段!=值 及 and / or 连接（与 review_agent 同一语法）；
# 其余形式（括号、函数、区间比较等）不受支持——不支持就不承诺自动判定。
_CONDITION_CMP = re.compile(
    "^([A-Za-z_][A-Za-z0-9_]*)" + chr(92) + "s*(==|!=)" + chr(92) + "s*(.+)$")


def _looks_vague_attitude(statement: str) -> Optional[str]:
    """返回命中的态度类词；态度没有可执行定义，不能交给程序或模型自动鉴定。"""
    for w in _VAGUE_ATTITUDE_WORDS:
        if w in statement:
            return w
    return None


def _condition_supported(expr: str) -> bool:
    """条件表达式是否为受支持的简单形式（V03）。"""
    expr = (expr or "").strip()
    if not expr:
        return True
    for joiner in (" or ", " and "):
        if joiner in expr:
            return all(_condition_supported(p) for p in expr.split(joiner))
    return bool(_CONDITION_CMP.match(expr))


def _check_spec_errors(rule: RuleDef, field_ids: list[str],
                       slot_ids: list[str]) -> list[str]:
    """V04：check 规格引用必须存在且 kind 受支持；被引用字段/槽位被删时定位冲突。"""
    errors: list[str] = []
    check = rule.check or {}
    kind = check.get("kind")
    if kind in ("field_required", "contact_in_members", "members_match"):
        ref = check.get("field")
        if ref is not None and ref not in field_ids:
            errors.append(f"规则 {rule.id} 的检查规格引用了不存在的字段 {ref}")
    elif kind in ("slot_constraints", "slot_presence"):
        ref = check.get("slot")
        if ref not in slot_ids:
            errors.append(f"规则 {rule.id} 的检查规格引用了不存在的槽位 {ref}")
    elif kind == "team_size":
        lo, hi = check.get("min", 2), check.get("max", 5)
        if isinstance(lo, int) and isinstance(hi, int) and lo > hi:
            errors.append(f"规则 {rule.id} 的团队人数范围 min={lo} 大于 max={hi}")
    else:
        errors.append(f"规则 {rule.id} 的检查规格 kind={kind!r} 不受支持，无法自动执行")
    return errors


def build_source_text(requirement_text: str, instruction: str = "",
                      answered: Optional[dict] = None,
                      source_materials: Optional[list[dict]] = None) -> str:
    """组织者一侧原始输入汇总，并保留来源资料边界供规则定位。"""
    nl = chr(10)
    source_text = requirement_text.strip()
    for index, material in enumerate(normalize_source_materials(source_materials), 1):
        source_text += (nl if source_text else "") + f"【来源资料 {index} · {material['name']} · {material['kind']} · id={material['id']}】" + nl + material["content"]
    if instruction and instruction.strip():
        source_text += nl + "【组织者修改意见】" + nl + instruction.strip()
    if answered:
        qa = nl.join(f"{q}：{a}" for q, a in answered.items())
        source_text += nl + "【组织者已回答的澄清】" + nl + qa
    return source_text


def blueprint_advisories(blueprint: Blueprint, source_text: str = "") -> list[str]:
    """非阻塞提醒（V01）：原始要求提到时间/截止而蓝图没有任何时间策略时提示核对。"""
    if not source_text.strip():
        return []
    tp = blueprint.time_policy
    if tp.open_at or tp.first_deadline or tp.correction_deadline:
        return []
    text = source_text
    has_time_hint = (
        ("月" in text and ("日" in text or "号" in text))
        or "截止" in text
        or "deadline" in text.lower()
        or re.search("[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}", text)
    )
    if has_time_hint:
        return ["原始要求中提到时间或截止，但蓝图尚未设置任何开放/截止时间；"
                "关键期次与截止应先向组织者澄清确认，不猜默认值"]
    return []


def _source_text_unverifiable(section: str) -> bool:
    """Return whether a source section is only a direct-read/fallback marker.

    A model may have received the original file even when the server has no
    complete text layer.  In that case the citation is a locator hint for the
    organizer, not something the server can prove by substring matching.
    """
    return any(marker in section for marker in _UNVERIFIABLE_SOURCE_MARKERS)


def source_material_advisories(blueprint: Blueprint, source_text: str = "") -> list[str]:
    """Return non-blocking reminders for source material needing human review."""
    if not source_text.strip():
        return []
    sections = _source_sections(source_text)
    ids = {
        r.source_material_id.strip()
        for r in blueprint.rules
        if r.source_material_id and _source_text_unverifiable(
            sections.get(r.source_material_id.strip(), "")
        )
    }
    if not ids:
        return []
    names = "、".join(sorted(ids))
    return [
        f"来源资料 {names} 尚无可供程序复核的完整文字层；规则保留了模型定位线索，"
        "发布前请打开原文件人工核对。"
    ]


def validate_blueprint(blueprint: Blueprint, source_text: str = "") -> list[str]:
    """程序侧发布校验（第 3 节）：
    引用存在、日期顺序、重复 ID、依赖环、规则来源可定位。
    返回错误列表；关键错误应阻止发布。
    """
    errors: list[str] = []
    if not blueprint.fields and not blueprint.slots:
        errors.append("蓝图没有任何字段或材料槽位，无法发布")
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

    # V02：态度类无可执行定义 -> 必须标人工/需澄清，不得宣称可自动鉴定
    for r in blueprint.rules:
        hit = _looks_vague_attitude(r.statement)
        if hit and r.executor is not Executor.HUMAN_ONLY and r.capability is Capability.SUPPORTED:
            errors.append(
                f"规则 {r.id} 的表述「{hit}」没有可执行定义，必须标为人工（human_only）"
                f"或需澄清（needs_human/needs_clarification），不得宣称可由系统自动鉴定")

    # V03：条件表达式只支持简单形式；不受支持的形式不放行（不承诺自动判定）
    for owner, items in (("字段", blueprint.fields), ("槽位", blueprint.slots)):
        for it in items:
            cond = getattr(it, "required_condition", None)
            if cond and not _condition_supported(cond):
                errors.append(
                    f"{owner} {it.id} 的必交条件「{cond}」使用了不受支持的形式；"
                    f"仅支持 字段==值 / 字段!=值 及 and/or 连接，"
                    f"请改写为简单条件或改为人工核验")

    # V04：check 规格 / 依赖 / 交付命名 / 自动范围引用必须自洽；
    # 被引用字段或规则被删除时在这里定位冲突，不静默移除约束。
    rule_id_set = set(rule_ids)
    by_id = {r.id: r for r in blueprint.rules}
    for r in blueprint.rules:
        if r.check:
            errors.extend(_check_spec_errors(r, field_ids, slot_ids))
            check_kind = str(r.check.get("kind") or "").strip().lower()
            if check_kind in {"visual_layout", "visual", "layout"} \
                    and r.executor is not Executor.SEMANTIC:
                errors.append(
                    f"规则 {r.id} 的视觉版式检查必须由 semantic 执行，"
                    "不能交给确定性程序或跨材料工具冒充"
                )
        elif r.executor is Executor.DETERMINISTIC:
            errors.append(f"规则 {r.id} 是确定性规则但没有 check 规格，无法自动执行")
        for d in r.depends_on:
            if d not in rule_id_set:
                errors.append(f"规则 {r.id} 依赖了不存在的规则 {d}")
    naming = str(blueprint.delivery.get("naming", "") or "")
    for token in re.findall("{field:([A-Za-z_][A-Za-z0-9_]*)}", naming):
        if token not in field_ids:
            errors.append(f"交付命名模板引用了不存在的字段 {token}")
    for rid in blueprint.auto_scope:
        if rid not in rule_id_set:
            errors.append(f"自动处理范围引用了不存在的规则 {rid}")
            continue
        r = by_id[rid]
        if r.executor is Executor.HUMAN_ONLY:
            errors.append(f"自动处理范围不能包含人工规则 {rid}（不自动承诺人工项）")
        elif r.capability is not Capability.SUPPORTED:
            errors.append(f"自动处理范围不能包含能力为 {r.capability.value} 的规则 {rid}")

    # 规则来源必须能在原文定位（防暗加要求的程序校验）。当规则绑定了
    # 上传资料时，再校验稳定 source_id 和位置，避免“看起来有引用”但
    # 实际指向了名单或另一份资料。
    if source_text.strip():
        source_sections = _source_sections(source_text)
        for r in blueprint.rules:
            src = (r.requirement_source or "").strip()
            if not src:
                errors.append(f"规则 {r.id} 缺少要求来源")
            elif r.source_material_id:
                section = source_sections.get(r.source_material_id)
                if section is None:
                    errors.append(
                        f"规则 {r.id} 引用了不存在的来源资料 {r.source_material_id}"
                    )
                else:
                    if (not _source_text_unverifiable(section)
                            and len(src) >= 8 and src not in section):
                        errors.append(
                            f"规则 {r.id} 的来源引用无法在资料 {r.source_material_id} 中定位，疑似暗加要求"
                        )
                    if not r.source_locator.strip():
                        errors.append(
                            f"规则 {r.id} 已绑定来源资料 {r.source_material_id}，但缺少 source_locator"
                        )
            elif src not in source_text and len(src) >= 8:
                errors.append(f"规则 {r.id} 的来源引用无法在原始要求中定位，疑似暗加要求")
    return errors


def _source_sections(source_text: str) -> dict[str, str]:
    """从持久化的来源文本中切出带稳定 id 的资料正文。"""
    marker = re.compile(
        r"【来源资料\s+\d+\s+·\s+.*?\s+·\s+.*?\s+·\s+id=([^】]+)】"
    )
    matches = list(marker.finditer(source_text))
    sections: dict[str, str] = {}
    for index, match in enumerate(matches):
        start = match.end()
        end = matches[index + 1].start() if index + 1 < len(matches) else len(source_text)
        sections[match.group(1).strip()] = source_text[start:end].strip()
    return sections


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
    prior_source: str = "",
    source_materials: Optional[list[dict]] = None,
    source_documents: Optional[list[DocumentInput]] = None,
) -> DraftResult:
    """需求 Agent 主入口：自然语言要求 → 蓝图草案。"""
    normalized_materials = normalize_source_materials(source_materials)
    if not requirement_text.strip() and not normalized_materials and current_draft is None:
        return DraftResult(
            blueprint=Blueprint(),
            warnings=["输入为空：不生成虚构要求，请填写原始要求或选择模板"],
        )
    client = client or get_client()
    source_documents = list(source_documents or [])
    effective_materials = normalized_materials
    direct_input_succeeded = False
    if normalized_materials and not client.configured:
        input_provenance = _source_provenance(
            normalized_materials,
            status="not_configured",
            detail="未配置模型密钥，未发送给外部模型。",
        )
    elif normalized_materials:
        input_provenance = _source_provenance(
            normalized_materials, method="text", status="used",
            detail="使用草案中的文字资料作为模型输入。",
        )
    else:
        input_provenance = []
    system = REVISION_SYSTEM_PROMPT if current_draft is not None else SYSTEM_PROMPT
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": _build_user_prompt(requirement_text, template, answered, current_draft, instruction, normalized_materials)},
    ]
    try:
        if source_documents and client.direct_documents_enabled:
            fallback_reason = "原始文件直传不可用，已进入降级。"
            try:
                payload = client.chat_json_documents(messages, source_documents)
                direct_input_succeeded = True
            except LLMInputUnsupported as exc:
                if settings.llm_input_mode == "direct":
                    return DraftResult(
                        blueprint=current_draft or Blueprint(),
                        warnings=[f"原始文件直传不可用（{exc}）；当前配置禁止文字/OCR 降级。"],
                        source_materials=source_material_summaries(normalized_materials),
                        input_provenance=[p.model_copy(update={
                            "method": "direct_model", "status": "failed",
                            "detail": "原始文件直传被 provider 拒绝，未进入文字/OCR 降级。",
                        }) for p in _source_provenance(normalized_materials)],
                    )
                # auto 模式才进入本地文字解析/OCR，避免 direct 约束被偷偷绕过。
                payload = None
                fallback_reason = "原始文件直传不可用（provider 不支持），已进入降级。"
            except LLMError:
                if settings.llm_input_mode == "direct":
                    input_provenance = [p.model_copy(update={
                        "method": "direct_model", "status": "failed",
                        "detail": "原始文件直传调用失败，未进入文字/OCR 降级。",
                    }) for p in _source_provenance(normalized_materials)]
                    raise
                payload = None
                fallback_reason = "原始文件直传调用失败，已进入降级。"
            if payload is None:
                fallback_materials, fallback_provenance = _fallback_inputs(
                    normalized_materials, source_documents,
                    allow_ocr=settings.llm_input_mode in {"auto", "ocr"},
                )
                input_provenance = [p.model_copy(update={
                    "status": "fallback",
                    "detail": f"{fallback_reason} {p.detail}",
                }) for p in fallback_provenance]
                # Preserve the text actually used by the fallback model call so
                # source validation and the immutable blueprint snapshot do not
                # fall back to an unread placeholder.
                effective_materials = fallback_materials
                fallback_messages = [
                    {"role": "system", "content": system},
                    {"role": "user", "content": _build_user_prompt(requirement_text, template, answered, current_draft, instruction, fallback_materials)},
                ]
                payload = client.chat_json(fallback_messages)
            elif direct_input_succeeded:
                input_provenance = _source_provenance(
                    normalized_materials,
                    method="direct_model",
                    status="used",
                    detail="已将原始文件交给配置的模型；文件/页码定位仍需人工核对。",
                )
        elif source_documents and client.configured:
            # Explicit text/ocr mode (or a test/provider client without a direct
            # input implementation) still prepares the configured local fallback.
            effective_materials, fallback_provenance = _fallback_inputs(
                normalized_materials, source_documents,
                allow_ocr=settings.llm_input_mode in {"auto", "ocr"},
            )
            input_provenance = [p.model_copy(update={
                "status": "used",
                "detail": ("按当前输入模式使用本地文字/OCR 输入。 " + p.detail),
            }) for p in fallback_provenance]
            fallback_messages = [
                {"role": "system", "content": system},
                {"role": "user", "content": _build_user_prompt(requirement_text, template, answered, current_draft, instruction, effective_materials)},
            ]
            payload = client.chat_json(fallback_messages)
        else:
            payload = client.chat_json(messages)
        result = _parse_draft(payload)
    except LLMUnavailable as e:
        return DraftResult(
            blueprint=current_draft or Blueprint(),
            warnings=[f"需求 Agent 暂不可用（{e}）。已保留当前草案，请手动编辑或稍后重试。"],
            source_materials=source_material_summaries(normalized_materials),
            input_provenance=input_provenance,
        )
    except LLMError as e:
        # 网关返回无法解析/结构不合法：保留当前草案并明示，绝不把坏数据当草案
        if client.configured:
            input_provenance = [p.model_copy(update={
                "status": "failed",
                "detail": "模型调用失败，未形成可用草案。",
            }) for p in input_provenance]
        return DraftResult(
            blueprint=current_draft or Blueprint(),
            warnings=[f"需求 Agent 返回无法解析（{e}）。已保留当前草案，请手动编辑或稍后重试。"],
            source_materials=source_material_summaries(normalized_materials),
            input_provenance=input_provenance,
        )
    result.source_materials = source_material_summaries(normalized_materials)
    result.input_provenance = input_provenance
    source_text = build_source_text(requirement_text, instruction, answered, effective_materials)
    result._effective_source_text = source_text
    validation_source = ((prior_source + chr(10) + source_text).strip()
                         if prior_source.strip() else source_text)
    result.warnings.extend(validate_blueprint(result.blueprint, validation_source))
    result.warnings.extend(blueprint_advisories(result.blueprint, validation_source))
    result.warnings.extend(source_material_advisories(result.blueprint, validation_source))
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
