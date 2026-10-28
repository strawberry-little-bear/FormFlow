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


def test_demo_health_identifies_current_runtime_contract():
    with TestClient(app) as client:
        response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "formflow",
        "agent_runtime_contract_version": 1,
    }


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
        assert payload["contract_version"] == 1
        assert payload["task_id"] == task_id
        assert payload["model"]["mode"] in {"online", "offline"}
        assert payload["mcp"]["external_adapter_configured"] is False
        assert payload["mcp"]["external_adapter_available"] is True
        assert payload["mcp"]["adapters"][0]["tools"] == [
            "list_my_tasks", "get_task_collection_progress", "get_task_next_step",
            "get_task_agent_runtime",
        ]
        assert "网页内置 Agent 不调用外部 MCP" in payload["mcp"]["boundary"]
        assert "不读取逐人名单或材料" in payload["mcp"]["boundary"]
        assert payload["harness"]["idempotency"] == "required"
        assert payload["harness"]["idempotency_scope"] == "harness_instance"
        assert payload["harness"]["recovery_delivery"] == "at_least_once"
        assert "模型请求可能重复" in payload["harness"]["recovery_note"]
        assert payload["harness"]["result_limit_bytes"] == 16384
        assert payload["harness"]["semantic_model_calls_per_run"] == settings.max_llm_calls_per_run
        assert payload["harness"]["parsed_pages_per_run"] == settings.max_pages_per_run
        assert payload["contract_self_test"]["status"] == "passed"
        assert payload["contract_self_test"]["passed"] == payload["contract_self_test"]["total"] == 5
        assert "没有调用模型" in payload["contract_self_test"]["note"]
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


def test_mcp_snapshot_is_owner_scoped_and_redacted(db_session):
    with TestClient(app) as client:
        owner = _register(client, "snapshot-owner")
        other = _register(client, "snapshot-other")
        created = client.post("/api/tasks", data={"name": "MCP 快照展示"}, headers=owner)
        assert created.status_code == 200, created.text
        task_id = created.json()["task_id"]

        assert client.get(f"/api/tasks/{task_id}/mcp-snapshot").status_code == 401
        assert client.get(f"/api/tasks/{task_id}/mcp-snapshot", headers=other).status_code == 404

        response = client.get(f"/api/tasks/{task_id}/mcp-snapshot", headers=owner)
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["read_only"] is True
        assert payload["source"] == "server_mcp_bridge"
        assert [call["tool"] for call in payload["calls"]] == [
            "list_my_tasks", "get_task_collection_progress", "get_task_next_step",
            "get_task_agent_runtime",
        ]
        assert payload["execution"]["status"] == "completed"
        assert payload["execution"]["trigger"] == "page_load"
        assert payload["execution"]["transport"] == "mcp_compatible"
        assert payload["execution"]["token_forwarded_to_browser"] is False
        assert [step["tool"] for step in payload["execution"]["replay"]] == [
            "list_my_tasks", "get_task_collection_progress", "get_task_next_step",
            "get_task_agent_runtime",
        ]
        assert payload["execution"]["replay_budget"]["tool_calls"] == 4
        assert payload["execution"]["replay"][1]["detail"]
        assert payload["intent"]["actor"] == "showcase_agent"
        assert all(call["scope"] == "organizer_session" for call in payload["calls"])
        assert payload["task"] == {
            "id": task_id, "name": "MCP 快照展示", "status": "draft", "mode": "roster",
        }
        assert "organizer-session" not in response.text
        assert '"Authorization"' not in response.text
        assert '"owner_token"' not in response.text
        assert "逐人名单" in payload["boundary"]

        run = client.post(f"/api/tasks/{task_id}/mcp-demo", headers=owner)
        assert run.status_code == 200, run.text
        run_payload = run.json()
        assert run_payload["execution"]["trigger"] == "agent_request"
        assert run_payload["execution"]["correlation_id"].startswith("mcp-")
        assert run_payload["intent"]["excluded"] == [
            "participant_rows", "material_body", "review_evidence", "session_token",
        ]
        assert client.post(f"/api/tasks/{task_id}/mcp-demo", headers=other).status_code == 404


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
        costs = {tool["name"]: tool["budget_cost"] for tool in payload["tools"]}
        assert payload["harness"]["max_cost"] == (
            payload["scope"]["deterministic_rules"] * costs["review.deterministic_rule"]
            + payload["scope"]["semantic_rules"] * costs["review.semantic_rule"]
        )
