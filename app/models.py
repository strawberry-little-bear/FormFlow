"""领域模型。

对应方案第 15 节"逻辑实体"与第 7 节"状态分层"：
任务、提交与文件、检查运行、规则结果、验收与资格、名单例外等
事实分层记录，页面再计算摘要；不设万能状态。
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base

# ---------------------------------------------------------------- 状态常量
# 任务生命周期（表 7）
TASK_DRAFT = "draft"                # 草稿
TASK_COLLECTING = "collecting"      # 收集中
TASK_CORRECTING = "correcting"      # 补正中
TASK_CLOSED = "closed"              # 关闭（只读）
TASK_ARCHIVED = "archived"          # 归档（非删除）
TASK_CANCELLED = "cancelled"        # 取消

# 提交与文件
SUBMISSION_DRAFT = "draft"
SUBMISSION_FORMAL = "formal"
SUBMISSION_WITHDRAWN = "withdrawn"

FILE_UPLOADING = "uploading"
FILE_RECEIVED = "received"
FILE_PROCESSING = "processing"
FILE_READY = "ready"
FILE_FAILED = "failed"

# 检查运行
RUN_QUEUED = "queued"
RUN_RUNNING = "running"
RUN_RETRY_WAIT = "retry_wait"
RUN_SUCCESS = "success"
RUN_FAILED = "failed"
RUN_SUPERSEDED = "superseded"

# 规则结果（表 7）
RESULT_SATISFIED = "satisfied"          # 满足
RESULT_ISSUE = "issue"                  # 问题
RESULT_UNKNOWN = "unknown"              # 无法判断
RESULT_NOT_APPLICABLE = "not_applicable"  # 不适用
RESULT_FAILED = "failed"                # 技术失败

# 验收与资格
ACCEPTANCE_PENDING = "pending"
ACCEPTANCE_ACCEPTED = "accepted"
ACCEPTANCE_NOT_ACCEPTED = "not_accepted"

ELIG_NOT_ASSESSED = "not_assessed"
ELIG_PENDING = "pending"
ELIG_ELIGIBLE = "eligible"
ELIG_INELIGIBLE = "ineligible"

# 名单例外
EXEMPTION_ACTIVE = "active"
EXEMPTION_REVOKED = "revoked"
EXEMPTION_EXPIRED = "expired"

# 提交者解释 / 申请复核（第 10 节“提交者的申诉路径”）
NOTE_PENDING = "pending"          # 待组织者处理
NOTE_WITHDRAWN = "withdrawn"      # 提交者自行撤回（只改状态，不删历史）

# 人工决定类型（表 11）
DECISION_CONFIRM_ISSUE = "confirm_issue"
DECISION_CORRECT_FALSE_POSITIVE = "correct_false_positive"
DECISION_APPROVE_EXCEPTION = "approve_exception"
DECISION_EXEMPT = "exempt"
DECISION_ELIGIBILITY = "eligibility"
DECISION_REVOKE = "revoke"
DECISION_ACCEPT_CURRENT = "accept_current"


class Account(Base):
    """组织者账号。密码加盐哈希，salt 随机且每账号独立。"""

    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(128))
    password_salt: Mapped[str] = mapped_column(String(64), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuthSession(Base):
    """组织者登录会话（持久化：服务重启不失效，方案 G1"重启不丢"）。

    只存 token 哈希，不存明文；支持过期与撤销。
    """

    __tablename__ = "auth_sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)


class Task(Base):
    """收集任务。双截止、时区、名单/开放、个人/团队。"""

    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    mode: Mapped[str] = mapped_column(String(16), default="roster")        # roster/open
    subject_kind: Mapped[str] = mapped_column(String(16), default="individual")  # individual/team
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Shanghai")
    open_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    first_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    correction_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default=TASK_DRAFT)
    current_blueprint_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("blueprint_versions.id"), nullable=True
    )
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class BlueprintVersion(Base):
    """任务蓝图的固定版本。发布时冻结；实质变更必须显式新版本。"""

    __tablename__ = "blueprint_versions"
    __table_args__ = (UniqueConstraint("task_id", "version", name="uq_blueprint_version"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    blueprint_json: Mapped[str] = mapped_column(Text)   # 结构化蓝图（JSON）
    source_text: Mapped[str] = mapped_column(Text, default="")  # 组织者原始输入汇总（V01：发布时复核规则来源，不暗加规则）
    status: Mapped[str] = mapped_column(String(16), default="draft")  # draft/published
    created_by_agent: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    published_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class Subject(Base):
    """提交主体：个人或团队。稳定 ID 不作为权限密钥。"""

    __tablename__ = "subjects"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="individual")
    display_name: Mapped[str] = mapped_column(String(200))
    eligibility: Mapped[str] = mapped_column(String(16), default=ELIG_NOT_ASSESSED)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    members: Mapped[list["Member"]] = relationship(back_populates="subject")


class Member(Base):
    """团队成员（团队主体）。"""

    __tablename__ = "members"
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    extra_json: Mapped[str] = mapped_column(Text, default="{}")
    subject: Mapped["Subject"] = relationship(back_populates="members")


class RosterEntry(Base):
    """名册条目（名单制任务的应交分母来源）。"""

    __tablename__ = "roster_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    ref: Mapped[str] = mapped_column(String(128), default="")  # 学号等引用信息
    subject_id: Mapped[Optional[int]] = mapped_column(ForeignKey("subjects.id"), nullable=True)


class Exemption(Base):
    """免交/特殊截止等名单例外。主体级、按任务生效；不等于材料已验收。"""

    __tablename__ = "exemptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="exempt")  # exempt/special_deadline
    status: Mapped[str] = mapped_column(String(16), default=EXEMPTION_ACTIVE)
    new_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    reason: Mapped[str] = mapped_column(Text, default="")
    decided_by: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AccessGrant(Base):
    """提交者持有凭证：绑定稳定主体 ID，可撤销、可过期。只存哈希。"""

    __tablename__ = "access_grants"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Submission(Base):
    """提交（草稿/正式/撤回）。一个主体在同一任务下一个提交记录。"""

    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("task_id", "subject_id", name="uq_submission"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    state: Mapped[str] = mapped_column(String(16), default=SUBMISSION_DRAFT)
    draft_version: Mapped[int] = mapped_column(Integer, default=1)
    current_revision_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revisions.id"), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )


class Revision(Base):
    """一次固定的正式提交版本。服务端记录收件时刻；带幂等键与内容摘要。"""

    __tablename__ = "revisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    fields_json: Mapped[str] = mapped_column(Text, default="{}")
    slot_file_ids_json: Mapped[str] = mapped_column(Text, default="{}")
    idempotency_key: Mapped[Optional[str]] = mapped_column(String(128), nullable=True, index=True)
    payload_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    receipt: Mapped[str] = mapped_column(String(64), unique=True)  # 稳定回执号
    formal_submitted_at: Mapped[datetime] = mapped_column(DateTime)  # 服务端成功时刻
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class FileObject(Base):
    """上传文件。以稳定 ID 区分，同名不代表同文件。"""

    __tablename__ = "file_objects"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id"), index=True)
    slot: Mapped[str] = mapped_column(String(64), default="")
    original_name: Mapped[str] = mapped_column(String(255))
    safe_name: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64))
    size: Mapped[int] = mapped_column(Integer, default=0)
    mime: Mapped[str] = mapped_column(String(128), default="")
    status: Mapped[str] = mapped_column(String(16), default=FILE_RECEIVED)
    parse_error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ParseIndex(Base):
    """文件解析索引：文本/页数与覆盖记录，供审核 Agent 只读使用。"""

    __tablename__ = "parse_indexes"
    id: Mapped[int] = mapped_column(primary_key=True)
    file_id: Mapped[str] = mapped_column(ForeignKey("file_objects.file_id"), index=True)
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    text_pages: Mapped[int] = mapped_column(Integer, default=0)
    visual_pages: Mapped[int] = mapped_column(Integer, default=0)
    unread_pages: Mapped[int] = mapped_column(Integer, default=0)
    failed_pages: Mapped[int] = mapped_column(Integer, default=0)
    method: Mapped[str] = mapped_column(String(32), default="text")  # text/ocr/none
    text_path: Mapped[str] = mapped_column(String(512), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class CheckRun(Base):
    """绑定明确 Revision 的一次检查运行。"""

    __tablename__ = "check_runs"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    revision_id: Mapped[int] = mapped_column(ForeignKey("revisions.id"), index=True)
    blueprint_version_id: Mapped[int] = mapped_column(ForeignKey("blueprint_versions.id"))
    status: Mapped[str] = mapped_column(String(16), default=RUN_QUEUED)
    llm_calls_used: Mapped[int] = mapped_column(Integer, default=0)
    pages_read: Mapped[int] = mapped_column(Integer, default=0)
    budget_exhausted: Mapped[bool] = mapped_column(Boolean, default=False)
    # V08 覆盖缺口：file_id -> {total,text,unread,failed,method,name}，供复核与提交者看到“哪些页没读到”
    coverage_json: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class RuleResult(Base):
    """逐规则结果：结论强度分层，unknown 不等于通过。"""

    __tablename__ = "rule_results"
    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("check_runs.id"), index=True)
    rule_id: Mapped[str] = mapped_column(String(64))
    result: Mapped[str] = mapped_column(String(16))
    severity: Mapped[str] = mapped_column(String(16), default="blocking")  # blocking/advisory
    explanation: Mapped[str] = mapped_column(Text, default="")
    next_step: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class Evidence(Base):
    """证据对象：文件 ID 与版本、页码/段落/字段路径、原文或裁切、提取方式。"""

    __tablename__ = "evidences"
    id: Mapped[int] = mapped_column(primary_key=True)
    rule_result_id: Mapped[int] = mapped_column(ForeignKey("rule_results.id"), index=True)
    file_id: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    locator: Mapped[str] = mapped_column(String(255), default="")  # p.3 / field:name
    quote: Mapped[str] = mapped_column(Text, default="")
    method: Mapped[str] = mapped_column(String(32), default="")    # text/ocr/field/manual
    method_version: Mapped[str] = mapped_column(String(32), default="")


class ManualDecision(Base):
    """人工决定：确认问题/纠正误报/批准例外/免交/资格/撤销/当前版本验收。"""

    __tablename__ = "manual_decisions"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    revision_id: Mapped[Optional[int]] = mapped_column(ForeignKey("revisions.id"), nullable=True)
    decision: Mapped[str] = mapped_column(String(32))
    scope_rule_id: Mapped[str] = mapped_column(String(64), default="")  # 规则或资格作用域
    expected_current_revision: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revisions.id"), nullable=True
    )
    operator_id: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    reason: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    revoked: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class SubmitterNote(Base):
    """提交者解释/申请复核（第 10 节：补交或解释）。

    解释不改变任何机器结论，也不替代组织者决定；
    它只作为组织者核对原文、纠正误报或批准例外的输入，
    并可作为下一轮语义检查的上下文。
    只追加不删除：撤回只改状态，历史保留。
    """

    __tablename__ = "submitter_notes"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    subject_id: Mapped[int] = mapped_column(ForeignKey("subjects.id"), index=True)
    revision_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("revisions.id"), nullable=True
    )  # 提交时的当前正式版本；新版本不自动继承
    rule_id: Mapped[str] = mapped_column(String(64), default="")  # 空 = 针对整体提交
    content: Mapped[str] = mapped_column(Text)
    idempotency_key: Mapped[str] = mapped_column(String(64), default="", index=True)
    status: Mapped[str] = mapped_column(String(16), default=NOTE_PENDING)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class DeliverySnapshot(Base):
    """交付快照：一次导出的固定纳入集合及配置。历史包内容清单不变。"""

    __tablename__ = "delivery_snapshots"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    blueprint_version_id: Mapped[int] = mapped_column(ForeignKey("blueprint_versions.id"))
    manifest_json: Mapped[str] = mapped_column(Text)
    kind: Mapped[str] = mapped_column(String(16), default="formal")  # formal/preview
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class ExportJob(Base):
    """导出作业：CSV 与 ZIP 必须引用同一快照。"""

    __tablename__ = "export_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    snapshot_id: Mapped[int] = mapped_column(ForeignKey("delivery_snapshots.id"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued/running/success/failed
    csv_path: Mapped[str] = mapped_column(String(512), default="")
    zip_path: Mapped[str] = mapped_column(String(512), default="")
    error: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class NotificationIntent(Base):
    """通知意图。首版只记录"已复制"，不宣称已发送/送达。"""

    __tablename__ = "notification_intents"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("tasks.id"), index=True)
    targets_json: Mapped[str] = mapped_column(Text, default="[]")
    content: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="copied")  # copied
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("accounts.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


class AuditEvent(Base):
    """审计事件：关键操作留痕。"""

    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[Optional[int]] = mapped_column(ForeignKey("tasks.id"), nullable=True)
    actor: Mapped[str] = mapped_column(String(128), default="")
    action: Mapped[str] = mapped_column(String(64))
    entity: Mapped[str] = mapped_column(String(64), default="")
    payload_json: Mapped[str] = mapped_column(Text, default="{}")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
