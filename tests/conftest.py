"""测试公共配置：隔离的临时数据库/存储 + 可编排的假 LLM。"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="formflow_test_")
os.environ["FORMFLOW_DATABASE_URL"] = f"sqlite:///{_TMP}/test.db"
os.environ["FORMFLOW_STORAGE_DIR"] = str(Path(_TMP) / "storage")
os.environ["FORMFLOW_LLM_API_KEY"] = "test-key"
os.environ["FORMFLOW_LLM_TIMEOUT_SECONDS"] = "5"

import pytest  # noqa: E402

from app.db import Base, engine, get_db  # noqa: E402
from app.llm import LLMClient  # noqa: E402
from app import models  # noqa: E402,F401


class StubLLM(LLMClient):
    """按脚本返回 JSON 的假客户端；记录调用次数。"""

    def __init__(self, responses=None, error=None):
        super().__init__(api_key="test-key")
        self.responses = list(responses or [])
        self.error = error
        self.calls = 0

    def chat(self, messages, temperature=0.2):
        self.calls += 1
        if self.error is not None:
            raise self.error
        if self.responses:
            r = self.responses.pop(0)
            if isinstance(r, Exception):
                raise r
            return r if isinstance(r, str) else json.dumps(r, ensure_ascii=False)
        return json.dumps({"result": "unknown", "explanation": "stub"}, ensure_ascii=False)


@pytest.fixture()
def db_session():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from sqlalchemy.orm import Session

    s = Session(engine)
    yield s
    s.close()


@pytest.fixture()
def stub_llm():
    return StubLLM()


def make_task(db, *, name="团课报告", mode="roster", subject_kind="individual",
              open_at=None, first_deadline=None, correction_deadline=None):
    t = models.Task(name=name, mode=mode, subject_kind=subject_kind,
                    open_at=open_at, first_deadline=first_deadline,
                    correction_deadline=correction_deadline, status="collecting")
    db.add(t)
    db.flush()
    return t


def publish_blueprint(db, task, blueprint):
    bp = models.BlueprintVersion(task_id=task.id, version=1,
                                 blueprint_json=blueprint.model_dump_json(),
                                 status="published")
    db.add(bp)
    db.flush()
    task.current_blueprint_id = bp.id
    return bp


def legacy_revision(db, submission, *, fields, files, key):
    """Seed an immutable pre-validation snapshot, never bypass the new submit API."""
    import secrets
    from app.security import utcnow
    from app.services.submissions import _payload_hash
    rev = models.Revision(submission_id=submission.id, version=1,
                          fields_json=json.dumps(fields, ensure_ascii=False),
                          slot_file_ids_json=json.dumps(files), idempotency_key=key,
                          payload_hash=_payload_hash(fields, files),
                          receipt="LEGACY-" + secrets.token_hex(8),
                          formal_submitted_at=utcnow())
    db.add(rev)
    db.flush()
    submission.current_revision_id = rev.id
    submission.state = "formal"
    return rev


def class_report_payload(client, headers):
    """Valid input for API tests about lifecycle/retry, not submission validation."""
    me = client.get("/api/me", headers=headers).json()
    files = {}
    if me.get("blueprint") and me["task"]["status"] == "collecting":
        draft = client.get("/api/me/draft", headers=headers).json()
        existing = draft.get("slot_file_ids", {}).get("report", [])
        if existing:
            files = {"report": [existing[0]["file_id"]]}
        else:
            upload = client.post("/api/me/files", headers=headers, data={"slot": "report"},
                                 files={"file": ("report.pdf", b"%PDF-1.4 test", "application/pdf")})
            assert upload.status_code == 200, upload.text
            files = {"report": [upload.json()["file_id"]]}
    return {"fields": {"name": "张三", "term": "2026 秋季第 1 期", "class_name": "一班"},
            "slot_file_ids": files}
