"""API 鉴权与归属校验测试（方案第 16 节：稳定 ID 不替代授权校验；G1 重启不丢）。"""
from __future__ import annotations

from datetime import timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import storage
from app.db import Base, engine
from app.main import app
from app.models import AccessGrant, Account, AuthSession, ExportJob, Subject, Task
from app.security import utcnow
from app.schemas import Blueprint, FieldDef
from tests.conftest import publish_blueprint


@pytest.fixture()
def client():
    with TestClient(app) as c:  # 触发 lifespan：init_db 建表
        yield c


def _register(client, username, password="pw123456"):
    r = client.post("/api/accounts", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/login", data={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _mk_task(client, headers, name="团课报告"):
    r = client.post("/api/tasks", data={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["task_id"]


def test_login_requires_valid_password(client, db_session):
    _register(client, "alice")
    assert client.post("/api/auth/login",
                       data={"username": "alice", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login",
                       data={"username": "ghost", "password": "x"}).status_code == 401


def test_password_salt_is_per_account_random(client, db_session):
    _register(client, "a1", "same-pw")
    _register(client, "a2", "same-pw")
    s = Session(engine)
    h1 = s.scalar(select(Account).where(Account.username == "a1"))
    h2 = s.scalar(select(Account).where(Account.username == "a2"))
    assert h1.password_salt and h1.password_salt != h2.password_salt
    assert h1.password_hash != h2.password_hash
    s.close()


def test_session_persisted_in_db(client, db_session):
    """会话落库（G1 重启不丢）：不再依赖进程内存 dict。"""
    from app.api import routes as routes_module

    headers = _register(client, "org1")
    s = Session(engine)
    sessions = s.scalars(select(AuthSession)).all()
    assert len(sessions) == 1
    s.close()
    assert not hasattr(routes_module, "_sessions")
    # 同一 token 继续可用（等价于重启后从 DB 恢复会话）
    task_id = _mk_task(client, headers)
    r = client.get(f"/api/tasks/{task_id}/workbench", headers=headers)
    assert r.status_code == 200


def test_expired_session_rejected(client, db_session):
    headers = _register(client, "org2")
    s = Session(engine)
    sess = s.scalars(select(AuthSession)).one()
    sess.expires_at = utcnow() - timedelta(hours=1)
    s.commit()
    s.close()
    r = client.get("/api/tasks/1/workbench", headers=headers)
    assert r.status_code == 401


def test_cross_organizer_task_access_denied(client, db_session):
    """组织者 B 不能读写组织者 A 的任务（稳定 ID 不替代授权校验）。"""
    ha = _register(client, "owner-a")
    hb = _register(client, "owner-b")
    task_id = _mk_task(client, ha)
    probes = [
        ("get", f"/api/tasks/{task_id}/workbench", None, None),
        ("get", f"/api/tasks/{task_id}/blueprint", None, None),
        ("post", f"/api/tasks/{task_id}/draft/template", None, {"template": "class_report"}),
        ("post", f"/api/tasks/{task_id}/roster", [], None),
        ("post", f"/api/tasks/{task_id}/grants", None, {"subject_name": "x"}),
        ("post", f"/api/tasks/{task_id}/snapshots", None, {}),
    ]
    for method, path, json_body, form in probes:
        kwargs = {"headers": hb}
        if json_body is not None:
            kwargs["json"] = json_body
        if form is not None:
            kwargs["data"] = form
        r = getattr(client, method)(path, **kwargs)
        assert r.status_code == 404, f"{path} -> {r.status_code}: {r.text}"
    r = client.get(f"/api/tasks/{task_id}/workbench", headers=ha)
    assert r.status_code == 200


def test_decision_rejects_foreign_subject(client, db_session):
    """决定接口必须校验主体属于该任务，防止跨任务越权。"""
    ha = _register(client, "owner-a")
    hb = _register(client, "owner-b")
    task_a = _mk_task(client, ha, "任务A")
    task_b = _mk_task(client, hb, "任务B")
    r = client.post(f"/api/tasks/{task_b}/grants", data={"subject_name": "小王"}, headers=hb)
    subject_b = r.json()["subject_id"]
    # A 对「自己的任务 + B 的主体」做决定 -> 404（不泄露主体存在性）
    r = client.post(f"/api/tasks/{task_a}/subjects/{subject_b}/decisions",
                    data={"decision": "accept_current", "reason": "越权尝试"}, headers=ha)
    assert r.status_code == 404
    # B 对自己的主体、但无正式提交 -> 业务规则 422（区别于越权）
    r = client.post(f"/api/tasks/{task_b}/subjects/{subject_b}/decisions",
                    data={"decision": "accept_current", "reason": "无正式提交"}, headers=hb)
    assert r.status_code == 422


def test_export_snapshot_requires_ownership(client, db_session):
    ha = _register(client, "owner-a")
    hb = _register(client, "owner-b")
    task_id = _mk_task(client, ha)
    task = db_session.get(Task, task_id)
    publish_blueprint(db_session, task,
                      Blueprint(fields=[FieldDef(id="name", label="姓名")], rules=[]))
    db_session.commit()
    r = client.post(f"/api/tasks/{task_id}/snapshots", headers=ha)
    assert r.status_code == 200, r.text
    snap_id = r.json()["snapshot_id"]
    assert client.get(f"/api/tasks/{task_id}/snapshots", headers=hb).status_code == 404
    assert client.get(f"/api/snapshots/{snap_id}", headers=hb).status_code == 404
    snapshot_detail = client.get(f"/api/snapshots/{snap_id}", headers=ha)
    assert snapshot_detail.status_code == 200
    assert snapshot_detail.json()["snapshot_id"] == snap_id
    newer = client.post(f"/api/tasks/{task_id}/snapshots", data={"kind": "preview"}, headers=ha)
    assert newer.status_code == 200, newer.text
    first_page = client.get(f"/api/tasks/{task_id}/snapshots?limit=1", headers=ha).json()
    assert [item["snapshot_id"] for item in first_page["snapshots"]] == [newer.json()["snapshot_id"]]
    assert first_page["has_more"] is True and first_page["next_offset"] == 1
    second_page = client.get(f"/api/tasks/{task_id}/snapshots?limit=1&offset=1", headers=ha).json()
    assert [item["snapshot_id"] for item in second_page["snapshots"]] == [snap_id]
    r = client.post(f"/api/snapshots/{snap_id}/export", headers=hb)
    assert r.status_code == 404  # 他人快照不可导出
    r = client.post(f"/api/snapshots/{snap_id}/export", headers=ha)
    assert r.status_code == 200
    assert r.json()["status"] == "success"
    job = db_session.get(ExportJob, r.json()["job_id"])
    history = client.get(f"/api/tasks/{task_id}/snapshots", headers=ha).json()["snapshots"]
    original_history = next(item for item in history if item["snapshot_id"] == snap_id)
    assert original_history["exports"][0]["status"] == "success"
    assert original_history["exports"][0]["csv_available"] is True
    Path(job.csv_path).unlink()
    history = client.get(f"/api/tasks/{task_id}/snapshots", headers=ha).json()["snapshots"]
    original_history = next(item for item in history if item["snapshot_id"] == snap_id)
    assert original_history["exports"][0]["csv_available"] is False
    assert original_history["exports"][0]["zip_available"] is True
    assert client.get(f"/api/exports/{job.id}/csv", headers=ha).status_code == 410
    assert client.get(f"/api/exports/{job.id}/zip", headers=ha).status_code == 200
    job.status = "failed"
    job.csv_path = ""
    job.zip_path = ""
    db_session.commit()
    history = client.get(f"/api/tasks/{task_id}/snapshots", headers=ha).json()["snapshots"]
    original_history = next(item for item in history if item["snapshot_id"] == snap_id)
    assert original_history["exports"][0]["status"] == "failed"
    assert not original_history["exports"][0]["csv_available"]
    assert client.get(f"/api/exports/{job.id}/csv", headers=ha).status_code == 409
    assert client.get(f"/api/exports/{job.id}/zip", headers=ha).status_code == 409


# ---------------------------------------------------------------- V21 越权回归
def _grant_subject(client, headers, task_id, name):
    r = client.post(f"/api/tasks/{task_id}/grants",
                    data={"subject_name": name}, headers=headers)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["subject_id"], body["credential"]


def test_revoked_credential_rejected_on_all_submitter_paths(client, db_session):
    """V21：凭证撤销后，提交者全部路径拒绝访问（401），不是静默可用。"""
    ha = _register(client, "org-r")
    task_id = _mk_task(client, ha)
    sid, cred = _grant_subject(client, ha, task_id, "张三")
    hsub = {"Authorization": "Bearer " + cred}
    assert client.get("/api/me", headers=hsub).status_code == 200

    s = Session(engine)
    grant = s.scalars(select(AccessGrant)).one()
    grant.revoked = True
    s.commit()
    s.close()

    probes = [
        ("get", "/api/me", None),
        ("post", "/api/me/draft", {"fields": {"name": "x"}, "expected_version": None}),
        ("get", "/api/me/draft", None),
        ("delete", "/api/me/files/does-not-matter", None),
        ("get", "/api/me/receipt", None),
        ("get", "/api/me/results", None),
        ("post", "/api/me/submit", {"fields": {}, "slot_file_ids": {},
                                    "idempotency_key": "k-revoked"}),
    ]
    for method, path, body in probes:
        r = client.request(method, path, headers=hsub, json=body)
        assert r.status_code == 401, f"{path} -> {r.status_code}: {r.text}"


def test_expired_credential_rejected(client, db_session):
    """V21：过期凭证同样拒绝（401）。"""
    ha = _register(client, "org-e")
    task_id = _mk_task(client, ha)
    sid, cred = _grant_subject(client, ha, task_id, "李四")
    hsub = {"Authorization": "Bearer " + cred}
    assert client.get("/api/me", headers=hsub).status_code == 200

    s = Session(engine)
    grant = s.scalars(select(AccessGrant)).one()
    grant.expires_at = utcnow() - timedelta(hours=1)
    s.commit()
    s.close()
    assert client.get("/api/me", headers=hsub).status_code == 401


def test_cross_task_subject_id_guessing_denied(client, db_session):
    """V21：猜主体 ID 访问别的地盘——checks/retry/findings/decisions 全部 404。"""
    ha = _register(client, "owner-a")
    hb = _register(client, "owner-b")
    task_a = _mk_task(client, ha, "任务A")
    task_b = _mk_task(client, hb, "任务B")
    sid_a, _ = _grant_subject(client, ha, task_a, "甲")
    sid_b, _ = _grant_subject(client, hb, task_b, "乙")

    probes = [
        ("post", f"/api/tasks/{task_a}/subjects/{sid_b}/checks", None, None),
        ("post", f"/api/tasks/{task_a}/subjects/{sid_b}/checks/retry", None, None),
        ("get", f"/api/tasks/{task_a}/subjects/{sid_b}/findings", None, None),
        ("post", f"/api/tasks/{task_a}/subjects/{sid_b}/decisions",
         None, {"decision": "confirm_issue", "reason": "越权试探"}),
        ("post", f"/api/tasks/{task_a}/subjects/{sid_a}/decisions/99999/revoke",
         None, {"reason": "越权试探"}),
        ("post", f"/api/tasks/{task_a}/subjects/999999/checks", None, None),
    ]
    for method, path, json_body, form in probes:
        kwargs = {"headers": hb}
        if json_body is not None:
            kwargs["json"] = json_body
        if form is not None:
            kwargs["data"] = form
        r = client.request(method, path, **kwargs)
        assert r.status_code == 404, f"{path} -> {r.status_code}: {r.text}"
    # 自己的路径不受影响
    r = client.get(f"/api/tasks/{task_b}/subjects/{sid_b}/findings", headers=hb)
    assert r.status_code == 200


def test_foreign_export_download_denied(client, db_session):
    """V21：猜导出作业 ID 下载他人的 CSV/ZIP —— 404，不泄露存在性。"""
    from app.schemas import FieldDef
    ha = _register(client, "owner-a")
    hb = _register(client, "owner-b")
    task_id = _mk_task(client, ha)
    task = db_session.get(Task, task_id)
    publish_blueprint(db_session, task,
                      Blueprint(fields=[FieldDef(id="name", label="姓名")], rules=[]))
    db_session.commit()
    r = client.post(f"/api/tasks/{task_id}/snapshots", headers=ha)
    assert r.status_code == 200, r.text
    snap_id = r.json()["snapshot_id"]
    r = client.post(f"/api/snapshots/{snap_id}/export", headers=ha)
    assert r.status_code == 200, r.text
    job_id = r.json()["job_id"]

    assert client.get(f"/api/exports/{job_id}/csv", headers=hb).status_code == 404
    assert client.get(f"/api/exports/{job_id}/zip", headers=hb).status_code == 404
    assert client.get(f"/api/exports/{job_id}/csv", headers=ha).status_code == 200
    assert client.get(f"/api/exports/{job_id}/zip", headers=ha).status_code == 200


def test_draft_roundtrip_over_api(client, db_session):
    """草稿经 API 保存后可恢复字段与文件；删除草稿文件也走同一凭证。"""
    ha = _register(client, "org-draft")
    task_id = _mk_task(client, ha)
    sid, cred = _grant_subject(client, ha, task_id, "张三")
    hsub = {"Authorization": "Bearer " + cred}

    r = client.post("/api/me/draft", headers=hsub,
                    json={"fields": {"name": "张三", "term": "第 1 期"},
                          "expected_version": None})
    assert r.status_code == 200, r.text
    v1 = r.json()["draft_version"]

    r = client.get("/api/me/draft", headers=hsub)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fields"] == {"name": "张三", "term": "第 1 期"}
    assert body["draft_version"] == v1
    assert body["slot_file_ids"] == {}

    r = client.post("/api/me/files", headers=hsub,
                    data={"slot": "report"},
                    files={"file": ("报告.txt", b"hello", "text/plain")})
    assert r.status_code == 200, r.text
    file_id = r.json()["file_id"]
    original = storage.file_dir(file_id) / f"original_{storage.safe_name('报告.txt')}"
    assert original.is_file()
    r = client.get("/api/me/draft", headers=hsub)
    assert [f["file_id"] for f in r.json()["slot_file_ids"]["report"]] == [file_id]

    r = client.delete(f"/api/me/files/{file_id}", headers=hsub)
    assert r.status_code == 200, r.text
    assert r.json()["cleanup_pending"] is False
    assert not original.exists()
    r = client.get("/api/me/draft", headers=hsub)
    assert r.json()["slot_file_ids"] == {}

    # 版本冲突仍按 409 保留本地内容
    r = client.post("/api/me/draft", headers=hsub,
                    json={"fields": {"name": "李四"}, "expected_version": 99})
    assert r.status_code == 409
