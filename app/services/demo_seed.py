"""演示数据种子（BP-C-001 团课报告，全部虚构）。

对应方案第 13 节样例的「初始虚构状态」：
名册 5 − 免交 1 = 应交 4；正式 3 + 未正式 1 = 应交 4；当前验收 1；
待补正 1、待人工 1 和检查未完成 1 不是互斥分组。

语义规则使用脚本化桩（ScriptedLLM），不依赖真实网关，保证演示状态可复现。
"""
from __future__ import annotations

import json
import shutil
import warnings
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import SAWarning
from sqlalchemy.orm import Session

from ..db import Base
from ..llm import LLMClient
from ..models import Account
from ..schemas import (
    Blueprint,
    FieldDef,
    RuleDef,
    SlotDef,
    TimePolicy,
)
from ..security import hash_password, new_salt, utcnow
from . import tasks as task_service
from .checks import create_run, execute_run
from .decisions import record_decision
from .submissions import attach_file, formal_submit, get_or_create_draft, save_draft

TERM = "2026 秋季第 1 期"
DEMO_TASK_NAME = "2026 秋季第 1 期团课报告（演示）"
DEMO_USERNAME = "demo"

# 脚本化桩：按规则语句关键词返回预定结论（quote 必须能在材料原文定位）
_SCRIPTS = {
    "期次": {  # 李四的文件里是错误期次
        "李四": {"result": "issue",
                 "explanation": "报告所写期次与任务期次不一致",
                 "evidence": [{"locator": "p.1", "quote": "期次：2026 秋季第 2 期"}]},
        "__default__": {"result": "satisfied",
                        "explanation": "报告期次与任务期次一致",
                        "evidence": [{"locator": "p.1", "quote": f"期次：{TERM}"}]},
    },
    "姓名": {
        "王五": {"result": "unknown",
                 "explanation": "姓名与名册存在同音异形可能，需人工核实",
                 "evidence": []},
        "__default__": {"result": "satisfied",
                        "explanation": "姓名清晰且与名册一致",
                        "evidence": [{"locator": "p.1", "quote": "姓名："}]},
    },
}


class ScriptedLLM(LLMClient):
    """按【规则】语句与材料内容匹配预定响应的离线演示桩。"""

    is_simulation = True

    def __init__(self) -> None:
        super().__init__(api_key="seed-stub")

    def chat(self, messages, temperature=0.2):
        user = messages[-1]["content"]
        subject_name = ""
        for name in ("张三", "李四", "王五", "赵六"):
            if name in user:
                subject_name = name
                break
        for key, table in _SCRIPTS.items():
            if f"【规则】{key}" in user or key in user.split("【规则】")[-1][:40]:
                payload = table.get(subject_name) or table["__default__"]
                if payload.get("evidence"):
                    for ev in payload["evidence"]:
                        if ev["quote"].endswith("："):
                            ev["quote"] = ev["quote"] + subject_name
                return json.dumps(payload, ensure_ascii=False)
        return json.dumps({"result": "satisfied", "explanation": "默认通过", "evidence": []},
                          ensure_ascii=False)


def _report_text(name: str, term: str = TERM) -> str:
    return (f"姓名：{name}\n期次：{term}\n活动内容：{name}参加了本期团课，内容充实。\n"
            f"个人收获：通过本期团课，{name}对主题有了更系统的理解。")


def demo_blueprint() -> Blueprint:
    """BP-C-001 演示蓝图（虚构）。"""
    return Blueprint(
        task_scope={"name": "团课报告收集（演示）", "template": "class_report",
                    "mode": "roster", "subject_kind": "individual"},
        fields=[
            FieldDef(id="name", label="姓名", required=True, purpose="与名册核对"),
            FieldDef(id="term", label="期次", required=True, purpose="核对报告期次"),
            FieldDef(id="class_name", label="班级", required=True, purpose="按班级整理"),
        ],
        slots=[SlotDef(id="report", label="团课报告", formats=["txt", "pdf", "docx"],
                       max_count=1, max_size_mib=10, max_pages=20)],
        rules=[
            RuleDef(id="r_fields_name", statement="姓名已填写",
                    requirement_source="原始要求：包含本人姓名",
                    executor="deterministic", check={"kind": "field_required", "field": "name"}),
            RuleDef(id="r_report_presence", statement="已提交团课报告材料",
                    requirement_source="原始要求：接受一份 PDF 或 DOCX",
                    executor="deterministic", check={"kind": "slot_presence", "slot": "report"}),
            RuleDef(id="r_report_constraints", statement="材料数量/格式符合槽位要求",
                    requirement_source="原始要求：一份、最大 10 MiB、20 页",
                    executor="deterministic",
                    check={"kind": "slot_constraints", "slot": "report"}),
            RuleDef(id="r_term_match", statement=f"报告期次须为 {TERM}",
                    requirement_source="原始要求：2026 秋季第 1 期团课报告",
                    executor="semantic"),
            RuleDef(id="r_name_clear", statement="姓名清晰可读且与名册一致",
                    requirement_source="原始要求：含本人姓名",
                    executor="semantic"),
            RuleDef(id="r_final_review", statement="组织者终验报告质量",
                    requirement_source="原始要求：组织者最终人工验收",
                    executor="human_only", capability="needs_human"),
        ],
        time_policy=TimePolicy(
            timezone="Asia/Shanghai",
            open_at=utcnow() - timedelta(days=1),
            first_deadline=utcnow() + timedelta(days=6),
            correction_deadline=utcnow() + timedelta(days=13),
        ),
        delivery={"group_by": "class_name", "naming": "{subject_id}_{field:name}"},
    )


def reset_demo(db: Session, *, task_name: str = DEMO_TASK_NAME,
               username: str = DEMO_USERNAME) -> int:
    """删除历史演示数据（按外键图传递闭包），让种子可重复执行。

    返回删除的任务数；磁盘上的附件文件一并清理。
    """
    meta = Base.metadata
    with warnings.catch_warnings():
        # tasks<->blueprint_versions<->revisions 存在外键环（设计使然），
        # sorted_tables 会告警；SQLite 默认不强制 FK，删除顺序不影响正确性。
        warnings.simplefilter("ignore", SAWarning)
        sorted_tables = list(meta.sorted_tables)
        fk_map = {
            t.name: {c.name: list(c.foreign_keys)[0].column.table.name
                     for c in t.columns if c.foreign_keys}
            for t in sorted_tables
        }
    task_t, acct_t = meta.tables["tasks"], meta.tables["accounts"]
    to_delete: dict[str, set[int]] = {}
    task_ids = set(db.execute(
        select(task_t.c.id).where(task_t.c.name == task_name)).scalars())
    acct_ids = set(db.execute(
        select(acct_t.c.id).where(acct_t.c.username == username)).scalars())
    if task_ids:
        to_delete["tasks"] = task_ids
    if acct_ids:
        to_delete["accounts"] = acct_ids

    # 传递闭包：沿外键反向收集所有关联行
    changed = True
    while changed:
        changed = False
        for tname, cols in fk_map.items():
            for col, target in cols.items():
                if target not in to_delete:
                    continue
                t = meta.tables[tname]
                ids = set(db.execute(
                    select(t.c.id).where(t.c[col].in_(to_delete[target]))).scalars())
                bucket = to_delete.setdefault(tname, set())
                if not ids <= bucket:
                    bucket |= ids
                    changed = True

    # 先清理磁盘附件目录，再按逆拓扑序删行（子表先删）
    file_t = meta.tables["file_objects"]
    file_ids = to_delete.get("file_objects", set())
    if file_ids:
        from .. import storage
        for fid in db.execute(
                select(file_t.c.file_id).where(file_t.c.id.in_(file_ids))).scalars():
            d = storage.file_dir(fid)
            if d.is_dir():
                shutil.rmtree(d, ignore_errors=True)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", SAWarning)
        for table in reversed(sorted_tables):
            ids = to_delete.get(table.name)
            if ids:
                db.execute(table.delete().where(table.c.id.in_(ids)))
    db.commit()
    return len(task_ids)


def seed_demo(db: Session, *, username: str = "demo", password: str = "demo1234") -> dict:
    """写入演示数据，返回摘要（含一次性明文凭证）。可重复执行。"""
    reset_demo(db, task_name=DEMO_TASK_NAME, username=username)
    salt = new_salt()
    acct = Account(username=username, password_hash=hash_password(password, salt),
                   password_salt=salt)
    db.add(acct)
    db.flush()

    task = task_service.create_task(db, name=DEMO_TASK_NAME,
                                    mode="roster", subject_kind="individual",
                                    timezone_="Asia/Shanghai", created_by=acct.id)
    bp = demo_blueprint()
    task.open_at = bp.time_policy.open_at
    task.first_deadline = bp.time_policy.first_deadline
    task.correction_deadline = bp.time_policy.correction_deadline
    task.timezone = bp.time_policy.timezone

    from ..models import BlueprintVersion

    bpv = BlueprintVersion(task_id=task.id, version=1,
                           blueprint_json=bp.model_dump_json(), status="published")
    db.add(bpv)
    db.flush()
    task.current_blueprint_id = bpv.id
    task.status = "collecting"

    roster_entries = task_service.add_roster(db, task, [
        {"name": "张三", "ref": "一班"},
        {"name": "李四", "ref": "一班"},
        {"name": "王五", "ref": "二班"},
        {"name": "赵六", "ref": "二班"},
        {"name": "孙七", "ref": "二班"},
    ])
    entries_by_name = {e.name: e for e in roster_entries}

    credentials = {}
    for name in ("张三", "李四", "王五", "赵六"):
        subject = task_service.ensure_subject(db, task, name)
        entries_by_name[name].subject_id = subject.id
        credentials[name] = task_service.issue_grant(db, task, subject)

    from ..models import RosterEntry
    for entry in db.scalars(select(RosterEntry).where(RosterEntry.task_id == task.id)):
        entry.subject_id = task_service.ensure_subject(db, task, entry.name).id
    db.flush()

    # 孙七：免交（名册 5 − 免交 1 = 应交 4）
    sunqi = task_service.ensure_subject(db, task, "孙七")
    entries_by_name["孙七"].subject_id = sunqi.id
    db.flush()
    record_decision(db, task, sunqi, decision="exempt",
                    reason="因病免交，已核实（演示数据）", operator_id=acct.id)

    stub = ScriptedLLM()
    # 三个正式提交
    for name, term in (("张三", TERM), ("李四", "2026 秋季第 2 期"), ("王五", TERM)):
        subject = task_service.ensure_subject(db, task, name)
        submission = get_or_create_draft(db, task, subject.id)
        content = _report_text(name, term).encode("utf-8")
        fo = attach_file(db, submission, slot="report",
                         original_name=f"{name}_报告.txt", content=content,
                         sha256="", mime="text/plain")
        rev = formal_submit(db, task, submission,
                            fields={"name": name, "term": term, "class_name": "一班" if name != "王五" else "二班"},
                            slot_file_ids={"report": [fo.file_id]},
                            idempotency_key=f"seed-{name}")
        run = create_run(db, task, rev)
        execute_run(db, run, stub)

    # 赵六：只有草稿，未正式提交
    zhao = task_service.ensure_subject(db, task, "赵六")
    submission = get_or_create_draft(db, task, zhao.id)
    save_draft(db, submission, {"name": "赵六", "term": TERM, "class_name": "二班"}, None)

    # 张三：人工终验 + 验收当前版本
    zhangsan = task_service.ensure_subject(db, task, "张三")
    record_decision(db, task, zhangsan, decision="confirm_pass", scope_rule_id="r_final_review",
                    reason="已人工阅读全文，报告质量合格（演示数据）", operator_id=acct.id)
    record_decision(db, task, zhangsan, decision="accept_current",
                    reason="材料齐全、规则通过、人工终验完成（演示数据）", operator_id=acct.id)

    db.commit()
    return {
        "account": {"username": username, "password": password},
        "task_id": task.id,
        "credentials": credentials,
    }
