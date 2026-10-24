"""Task-scoped Agent runtime manifest contract and authorization."""
from __future__ import annotations

from fastapi.testclient import TestClient

from app.config import settings
from app.main import app


def _register(client: TestClient, username: str):
    client.post("/api/accounts", data={"username": username, "password": "pw123456"})
    result = client.post("/api/auth/login", data={"username": username, "password": "pw123456"})
    assert result.status_code == 200, result.text
    return {"Authorization": f"Bearer {result.json()['token']}"}


def test_agent_runtime_manifest_is_owner_scoped_and_descriptive(db_session):
    with TestClient(app) as client:
        owner = _register(client, "runtime-owner")
        other = _register(client, "runtime-other")
        created = client.post("/api/tasks", data={"name": "运行时展示"}, headers=owner)
        assert created.status_code == 200, created.text
        task_id = created.json()["task_id"]

        assert client.get(f"/api/tasks/{task_id}/agent-runtime").status_code == 401
        assert client.get(f"/api/tasks/{task_id}/agent-runtime", headers=other).status_code == 404

        response = client.get(f"/api/tasks/{task_id}/agent-runtime", headers=owner)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["task_id"] == task_id
        assert payload["model"]["mode"] in {"online", "offline"}
        assert payload["mcp"]["external_adapter_configured"] is False
        assert payload["mcp"]["adapters"] == []
        assert payload["harness"]["idempotency"] == "required"
        assert payload["harness"]["result_limit_bytes"] == 16384
        assert payload["harness"]["semantic_model_calls_per_run"] == settings.max_llm_calls_per_run
        assert payload["harness"]["parsed_pages_per_run"] == settings.max_pages_per_run
        assert {tool["name"] for tool in payload["tools"]} == {
            "review.deterministic_rule", "review.semantic_rule"
        }
        review = next(skill for skill in payload["skills"] if skill["name"] == "review_one_submission")
        assert set(review["allowed_tools"]) == {tool["name"] for tool in payload["tools"]}
        requirements = next(skill for skill in payload["skills"] if skill["name"] == "requirements_draft")
        assert requirements["allowed_tools"] == []
        assert requirements["execution"] == "application_service"
        assert requirements["request_idempotency"] == "task_account_request_id"
        assert requirements["version_conflict"] == "fail_closed"
        assert requirements["human_gate"]


def test_agent_runtime_manifest_reports_published_rule_scope(db_session):
    from app.db import engine
    from app.models import Account, BlueprintVersion, Task
    from app.security import hash_password, new_salt
    from app.schemas import Blueprint
    from sqlalchemy.orm import Session

    with Session(engine) as session:
        salt = new_salt()
        account = Account(username="runtime-seeded", password_hash=hash_password("pw123456", salt), password_salt=salt)
        session.add(account)
        session.flush()
        task = Task(name="有规则任务", created_by=account.id, status="collecting")
        session.add(task)
        session.flush()
        blueprint = Blueprint.model_validate({
            "task_scope": {"name": "有规则任务", "description": "", "template": "", "mode": "roster", "subject_kind": "individual"},
            "fields": [], "slots": [],
            "rules": [{"id": "r1", "statement": "填写姓名", "requirement_source": "填写姓名", "executor": "deterministic", "capability": "supported", "severity": "blocking", "depends_on": [], "check": {"kind": "field_required", "field": "name"}},
                      {"id": "r2", "statement": "说明理由", "requirement_source": "说明理由", "executor": "semantic", "capability": "supported", "severity": "advisory", "depends_on": [], "check": None}],
            "time_policy": {"timezone": "Asia/Shanghai"}, "auto_scope": ["r1", "r2"],
            "manual_acceptance": True, "eligibility_required": False, "delivery": {}, "governance": {},
        })
        version = BlueprintVersion(task_id=task.id, version=1, blueprint_json=blueprint.model_dump_json(), status="published")
        session.add(version)
        session.flush()
        task.current_blueprint_id = version.id
        session.commit()
        task_id = task.id
        account_id = account.id

    with TestClient(app) as client:
        result = client.post("/api/auth/login", data={"username": "runtime-seeded", "password": "pw123456"})
        assert result.status_code == 200, result.text
        headers = {"Authorization": f"Bearer {result.json()['token']}"}
        payload = client.get(f"/api/tasks/{task_id}/agent-runtime", headers=headers).json()
        assert payload["scope"] == {"published_blueprint": True, "deterministic_rules": 1, "semantic_rules": 1, "human_rules": 0}
        assert payload["harness"]["max_invocations"] == 2
