"""蓝图与 API 的结构化 Schema。

对应方案表 2（蓝图模块）与第 3 节（规则能力必须可见）：
每条规则必须带来源与能力标签，不能把无法执行的要求包装成自动能力。
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------- 枚举
class Executor(str, Enum):
    """规则执行者。能确定性计算的规则不交给模型。"""

    DETERMINISTIC = "deterministic"    # 确定性检查（程序）
    SEMANTIC = "semantic"              # 语义检查（Agent）
    CROSS_MATERIAL = "cross_material"  # 跨材料一致性（Agent）
    HUMAN_ONLY = "human_only"          # 仅人工项


class Capability(str, Enum):
    """规则能力标签（第 3 节）。"""

    SUPPORTED = "supported"            # 已支持
    NEEDS_HUMAN = "needs_human"        # 需人工
    NEEDS_CLARIFICATION = "needs_clarification"  # 需澄清


class FieldType(str, Enum):
    TEXT = "text"
    ENUM = "enum"
    DATE = "date"
    NUMBER = "number"


# ---------------------------------------------------------------- 蓝图模块
class FieldDef(BaseModel):
    """信息字段：稳定 ID，改名不改变 ID。"""

    id: str = Field(description="稳定字段 ID，如 name / term / track")
    label: str
    type: FieldType = FieldType.TEXT
    options: list[str] = Field(default_factory=list)
    required: bool = True
    required_condition: Optional[str] = Field(
        default=None, description="必填条件表达式，如 track==physical"
    )
    purpose: str = ""
    visibility: str = "organizer"  # organizer / submitter


class SlotDef(BaseModel):
    """材料槽位：格式、数量、大小与页数、条件必交。"""

    id: str
    label: str
    formats: list[str] = Field(default_factory=list)
    max_count: int = 1
    max_size_mib: Optional[float] = None
    max_pages: Optional[int] = None
    required_condition: Optional[str] = None


class RuleDef(BaseModel):
    """检查规则：来源、确认状态、执行者、阻塞级别。"""

    id: str
    statement: str = Field(description="规则表述")
    requirement_source: str = Field(description="原始要求出处（引用原文，不得暗加）")
    executor: Executor
    capability: Capability = Capability.SUPPORTED
    severity: str = "blocking"  # blocking / advisory
    depends_on: list[str] = Field(default_factory=list)
    clarification_question: Optional[str] = None
    check: Optional[dict] = Field(
        default=None,
        description="确定性检查规格（executor=deterministic 时由程序执行）",
    )


class TimePolicy(BaseModel):
    timezone: str = "Asia/Shanghai"
    open_at: Optional[datetime] = None
    first_deadline: Optional[datetime] = None       # 首次截止
    correction_deadline: Optional[datetime] = None  # 补正截止（仅已正式提交者可用）


class Blueprint(BaseModel):
    """任务蓝图：同一任务的结构化规则来源。"""

    task_scope: dict = Field(default_factory=dict)   # 名称/说明/模板/模式
    fields: list[FieldDef] = Field(default_factory=list)
    slots: list[SlotDef] = Field(default_factory=list)
    rules: list[RuleDef] = Field(default_factory=list)
    time_policy: TimePolicy = Field(default_factory=TimePolicy)
    auto_scope: list[str] = Field(default_factory=list)  # 自动处理范围（规则 ID）
    manual_acceptance: bool = True
    eligibility_required: bool = False
    delivery: dict = Field(default_factory=dict)     # 分组/命名/导出字段
    governance: dict = Field(default_factory=dict)   # 用途/模型处理/留存


class Clarification(BaseModel):
    """高影响澄清问题：已知信息不重复追问。"""

    question: str
    why: str = ""
    affects_rule_ids: list[str] = Field(default_factory=list)


class DraftResult(BaseModel):
    """需求 Agent 输出：结构化草案 + 待澄清 + 发布摘要。"""

    blueprint: Blueprint
    clarifications: list[Clarification] = Field(default_factory=list)
    publish_summary: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------- 审核结果
class EvidenceOut(BaseModel):
    file_id: Optional[str] = None
    locator: str = ""
    quote: str = ""
    method: str = ""


class RuleResultOut(BaseModel):
    rule_id: str
    result: str  # satisfied/issue/unknown/not_applicable/failed
    explanation: str = ""
    next_step: str = ""
    evidence: list[EvidenceOut] = Field(default_factory=list)
