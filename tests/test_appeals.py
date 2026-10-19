# -*- coding: utf-8 -*-
"""第 10 节“提交者的申诹路径”端到端：提交者解释 / 申请复核。

方案要求：提交者可查看问题、引用位置和建议改法，选择补交或解释；
组织者核对原文、纠正误报或批准有范围的例外。

红线：
- 解释不改变机器结论，也不替代组织者决定；
- 理由为空不允许提交；幂等键同键同内容返回同一记录、同键异内容报冲突；
- 撤回只改状态，历史不删除、不可篡改；
- 只读任务（关闭/归档/取消）不接受新的解释；
- 提交者解释与历史问题进入下一轮语义检查上下文，但不作为结论。
"""
from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import select

from app.models import RESULT_ISSUE, RESULT_SATISFIED, RuleResult, SubmitterNote
from app.services.checks import create_run, execute_run
from tests.conftest import StubLLM
from tests.test_authz import _grant_subject
from tests.test_v05_v07_v08_e2e import _attach, _run, _setup_api_task

SAMPLES = Path(__file__).resolve().parent.parent / "data" / "samples"
NAME_QUOTE = "姓名：张三"
TERM_QUOTE = "期次：2026 秋季第 1 期"


@pytest.fixture(scope="module", autouse=True)
def _ensure_samples():
    missing = [n for n in ("normal.pdf",) if not (SAMPLES / n).exists()]
    if missing:
        import scripts.make_samples as ms

        ms.main()


@pytest.fixture()
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:  # 触发 lifespan：init_db 建表
        yield c


class RecordingLLM(StubLLM):
    """记录每次调用的 messages：验证上下文透传（提交者解释/历史问题）。"""

    def __init__(self, responses=None):
        super().__init__(responses)
        self.seen: list[list[dict]] = []

    def chat(self, messages, temperature=0.2):
        self.seen.append(messages)
        return super().chat(messages, temperature)


def _appeal(client, hsub, *, rule_id="C-R02", content, key):
    return client.post("/api/me/appeals", headers=hsub,
                       json={"rule_id": rule_id, "content": content,
                             "idempotency_key": key})


def _issue_run(db, task, submission, key="k-ap-issue"):
    """正式提交 + 一轮检查：C-R02 判 issue（阻塞），C-R03 通过。"""
    f = _attach(db, submission, "normal.pdf")
    rev, run, results = _run(db, task, submission,
                             {"name": "张三", "term": "2026 秋季第 1 期",
                              "class_name": "一班"},
                             key, [f.file_id],
                             StubLLM(responses=[
                                 {"result": "issue",
                                  "explanation": "报告封面姓名与登记姓名不一致",
                                  "next_step": "核对报告封面姓名，与登记姓名一致后重新正式提交",
                                  "evidence": [{"quote": NAME_QUOTE, "locator": "p.1"}]},
                                 {"result": "satisfied", "explanation": "期次一致",
                                  "evidence": [{"quote": TERM_QUOTE, "locator": "p.1"}]},
                             ]))
    assert results["C-R02"].result == RESULT_ISSUE
    return rev, run, results, f.file_id


def test_appeal_visible_to_both_sides_until_organizer_handles(client, db_session,
                                                              monkeypatch):
    """提交者提交解释后：本人与组织者都可见；组织者对该规则做决定后才算已处理。"""
    task, subject, submission, headers = _setup_api_task(
        client, db_session, monkeypatch, "org-ap1", "张三", disable_ocr=False)
    rev, run, results, _fid = _issue_run(db_session, task, submission)
    db_session.commit()

    sid, cred = _grant_subject(client, headers, task.id, "张三")
    assert sid == subject.id
    hsub = {"Authorization": "Bearer " + cred}

    # 提交解释 / 申请复核（针对阻塞规则 C-R02）
    r = _appeal(client, hsub, key="ap-1",
                content="姓名与登记一致，报告封面第 1 页写的就是张三")
    assert r.status_code == 200, r.text
    note_id = r.json()["note_id"]
    assert r.json()["status"] == "pending"
    assert r.json()["revision_id"] == rev.id

    # 提交者视角：可见、待处理；解释不改变机器结论
    body = client.get("/api/me/results", headers=hsub).json()
    assert body["summary"] == "待补正"
    assert body["buckets"]["blocking"] == ["C-R02"]
    appeals = body["appeals"]
    assert len(appeals) == 1
    assert appeals[0]["id"] == note_id
    assert appeals[0]["status"] == "pending"
    assert appeals[0]["handled"] is False
    assert appeals[0]["content"] == "姓名与登记一致，报告封面第 1 页写的就是张三"

    # 组织者视角：复核页能看到该主体待处理解释
    org_view = client.get(f"/api/tasks/{task.id}/subjects/{sid}/findings",
                          headers=headers).json()
    assert [n["id"] for n in org_view["notes"]] == [note_id]
    assert org_view["notes"][0]["handled"] is False

    # 组织者核对原文后做决定（纠正误报，作用于 C-R02）→ 解释才算已处理
    r = client.post(f"/api/tasks/{task.id}/subjects/{sid}/decisions",
                    data={"decision": "correct_false_positive",
                          "reason": "核对纸质原件后确认姓名无误",
                          "scope_rule_id": "C-R02"}, headers=headers)
    assert r.status_code == 200, r.text

    mine = client.get("/api/me/appeals", headers=hsub).json()["notes"]
    assert mine[0]["handled"] is True
    org_view = client.get(f"/api/tasks/{task.id}/subjects/{sid}/findings",
                          headers=headers).json()
    assert org_view["notes"][0]["handled"] is True


def test_appeal_validation_and_idempotency(client, db_session, monkeypatch):
    """空理由/越权规则拒绝；幂等键同键同内容同一记录、同键异内容冲突。"""
    task, subject, submission, headers = _setup_api_task(
        client, db_session, monkeypatch, "org-ap2", "张三", disable_ocr=False)
    _issue_run(db_session, task, submission)
    db_session.commit()
    sid, cred = _grant_subject(client, headers, task.id, "张三")
    hsub = {"Authorization": "Bearer " + cred}

    # 空内容拒绝（与决定同源约束：理由不能为空）
    r = _appeal(client, hsub, content="   ", key="ap-empty")
    assert r.status_code == 422
    # 缺少幂等键拒绝
    r = client.post("/api/me/appeals", headers=hsub,
                    json={"rule_id": "C-R02", "content": "有内容但没键"})
    assert r.status_code == 422
    # 规则不属于当前蓝图：不能针对不存在的规则申请复核
    r = _appeal(client, hsub, rule_id="C-R99", content="质疑不存在的规则", key="ap-norule")
    assert r.status_code == 422
    assert "C-R99" in r.json()["detail"]

    # 正常提交（阻塞规则）
    r1 = _appeal(client, hsub, key="ap-ok", content="封面姓名确为张三")
    assert r1.status_code == 200, r1.text
    note_id = r1.json()["note_id"]

    # 同键同内容：幂等返回同一记录，不重复计数
    r2 = _appeal(client, hsub, key="ap-ok", content="封面姓名确为张三")
    assert r2.status_code == 200
    assert r2.json()["note_id"] == note_id

    # 同键不同内容：冲突
    r3 = _appeal(client, hsub, key="ap-ok", content="换了个说法再提交")
    assert r3.status_code == 409
    # 同键同内容但换了作用域规则：也是冲突
    r4 = _appeal(client, hsub, key="ap-ok", rule_id="C-R03", content="封面姓名确为张三")
    assert r4.status_code == 409

    # 不指定规则的整体说明也允许
    r5 = _appeal(client, hsub, rule_id="", content="整体补充说明一次", key="ap-global")
    assert r5.status_code == 200, r5.text
    assert r5.json()["rule_id"] == ""

    notes = db_session.scalars(select(SubmitterNote)).all()
    assert len(notes) == 2  # 只有 ap-ok 与 ap-global 落库


def test_appeal_withdraw_only_own_pending(client, db_session, monkeypatch):
    """撤回只改状态：只能撤回本人未撤回的解释；他人键/他人解释都动不了。"""
    task, subject, submission, headers = _setup_api_task(
        client, db_session, monkeypatch, "org-ap3", "张三", disable_ocr=False)
    _issue_run(db_session, task, submission)
    db_session.commit()
    sid, cred = _grant_subject(client, headers, task.id, "张三")
    hsub = {"Authorization": "Bearer " + cred}
    _sid2, cred2 = _grant_subject(client, headers, task.id, "李四")
    hsub2 = {"Authorization": "Bearer " + cred2}

    r = _appeal(client, hsub, key="ap-w1", content="临时想法，先撤回")
    assert r.status_code == 200, r.text
    note_id = r.json()["note_id"]

    # 他人冒用同一幂等键：冲突（幂等键属于其他提交）
    r = _appeal(client, hsub2, key="ap-w1", content="临时想法，先撤回")
    assert r.status_code == 409
    # 他人不能撤回本人的解释
    r = client.post(f"/api/me/appeals/{note_id}/withdraw", headers=hsub2)
    assert r.status_code == 422

    # 本人撤回：只改状态，历史保留
    r = client.post(f"/api/me/appeals/{note_id}/withdraw", headers=hsub)
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "withdrawn"
    note = db_session.get(SubmitterNote, note_id)
    assert note is not None and note.status == "withdrawn"

    # 不能重复撤回
    r = client.post(f"/api/me/appeals/{note_id}/withdraw", headers=hsub)
    assert r.status_code == 422

    # 撤回后组织者不再看到（待处理列表不含已撤回）
    org_view = client.get(f"/api/tasks/{task.id}/subjects/{sid}/findings",
                          headers=headers).json()
    assert org_view["notes"] == []
    # 提交者自己仍可查到历史（含已撤回），但 handled 恒为 False
    mine = client.get("/api/me/appeals", headers=hsub).json()["notes"]
    assert [n["status"] for n in mine] == ["withdrawn"]
    assert mine[0]["handled"] is False


def test_appeal_rejected_when_task_readonly(client, db_session, monkeypatch):
    """只读任务（已关闭）不接受新的解释；历史解释仍可读取。"""
    task, subject, submission, headers = _setup_api_task(
        client, db_session, monkeypatch, "org-ap4", "张三", disable_ocr=False)
    _issue_run(db_session, task, submission)
    db_session.commit()
    sid, cred = _grant_subject(client, headers, task.id, "张三")
    hsub = {"Authorization": "Bearer " + cred}

    r = _appeal(client, hsub, key="ap-ro", content="关闭前先留下解释")
    assert r.status_code == 200, r.text

    task.status = "closed"
    db_session.commit()
    r = _appeal(client, hsub, key="ap-ro2", content="关闭后还能解释吗")
    assert r.status_code == 409
    assert "只读" in r.json()["detail"]

    # 只读不禁读：提交者仍能看到此前的解释
    mine = client.get("/api/me/appeals", headers=hsub).json()["notes"]
    assert len(mine) == 1
    assert mine[0]["content"] == "关闭前先留下解释"


def test_appeal_and_history_issues_feed_next_check_context(client, db_session, monkeypatch):
    """补正提交的下一轮语义检查：看到历史问题与提交者解释作为上下文，
    但解释不作为结论——结论仍由模型独立给出。"""
    task, subject, submission, headers = _setup_api_task(
        client, db_session, monkeypatch, "org-ap5", "张三", disable_ocr=False)
    _issue_run(db_session, task, submission)
    db_session.commit()
    sid, cred = _grant_subject(client, headers, task.id, "张三")
    hsub = {"Authorization": "Bearer " + cred}

    r = _appeal(client, hsub, rule_id="C-R02", key="ap-ctx",
                content="封面是打印体张三，与登记姓名一致")
    assert r.status_code == 200, r.text
    db_session.commit()

    # 补交更正材料，形成新版本并重跑检查
    f2 = _attach(db_session, submission, "normal.pdf")
    stub2 = RecordingLLM(responses=[
        {"result": "satisfied", "explanation": "姓名一致",
         "evidence": [{"quote": NAME_QUOTE, "locator": "p.1"}]},
        {"result": "satisfied", "explanation": "期次一致",
         "evidence": [{"quote": TERM_QUOTE, "locator": "p.1"}]},
    ])
    rev2, run2, results2 = _run(db_session, task, submission,
                                {"name": "张三", "term": "2026 秋季第 1 期",
                                 "class_name": "一班"},
                                "k-ap-fix", [f2.file_id], stub2, correction=True)
    db_session.commit()
    assert rev2.version == 2

    assert stub2.seen, "语义检查应调用模型"
    user_text = "\n".join(m["content"] for msgs in stub2.seen
                          for m in msgs if m["role"] == "user")
    assert "【提交者解释】" in user_text
    assert "封面是打印体张三，与登记姓名一致" in user_text
    assert "【历史问题】" in user_text
    assert "C-R02" in user_text
    assert "报告封面姓名与登记姓名不一致" in user_text

    # 解释只是上下文：结论由模型独立给出（此处 satisfied）
    r02 = results2["C-R02"]
    assert r02.result == RESULT_SATISFIED
    r03 = results2["C-R03"]
    assert r03.result == RESULT_SATISFIED
