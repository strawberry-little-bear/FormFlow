"""Published baselines, historical versions and stale drafts must be explicit."""
import pytest
from sqlalchemy.orm import Session
from app.db import engine
from app.models import Task
from app.schemas import Blueprint, DraftResult, FieldDef
from app.services import tasks
from tests.conftest import make_task


def draft(db,task,label):
    return tasks.save_draft(db,task,DraftResult(blueprint=Blueprint(fields=[FieldDef(id="name",label=label)])))


def test_design_recovers_published_baseline_and_aggregate_difference(db_session):
    task=make_task(db_session)
    first=draft(db_session,task,"姓名")
    tasks.publish(db_session,task,first.id)
    second=draft(db_session,task,"联系人姓名")
    view=tasks.get_design(db_session,task)
    assert view["published"]["id"]==first.id
    assert view["published"]["blueprint"]["fields"][0]["label"]=="姓名"
    assert view["publish_impact"]["fields"]["changed"]==["name"]
    assert view["blueprint_version_id"]==second.id
    assert view["task"]["timezone"]=="Asia/Shanghai"


def test_historical_version_returns_published_baseline_and_impact(db_session):
    task=make_task(db_session)
    first=draft(db_session,task,"姓名")
    tasks.publish(db_session,task,first.id)
    second=draft(db_session,task,"联系人姓名")
    view=tasks.get_blueprint_version(db_session,task,second.id)
    assert view["published"]["id"]==first.id
    assert view["published"]["version"]==first.version
    assert view["published"]["blueprint"]["fields"][0]["label"]=="姓名"
    assert view["publish_impact"]["fields"]["changed"]==["name"]


def test_newer_draft_prevents_publishing_stale_preview(db_session):
    task=make_task(db_session)
    old=draft(db_session,task,"姓名")
    new=draft(db_session,task,"联系人")
    with pytest.raises(tasks.PublishConflict,match="草案已有新版本"):
        tasks.publish(db_session,task,old.id,expected_published_id=0)
    assert task.current_blueprint_id is None
    tasks.publish(db_session,task,new.id,expected_published_id=0)


def test_historical_published_blueprint_cannot_roll_current_version_back(db_session):
    task=make_task(db_session)
    old=draft(db_session,task,"姓名")
    tasks.publish(db_session,task,old.id)
    new=draft(db_session,task,"联系人")
    tasks.publish(db_session,task,new.id)
    with pytest.raises(tasks.PublishBlocked,match="历史已发布"):
        tasks.publish(db_session,task,old.id)
    assert task.current_blueprint_id==new.id
    assert tasks.publish(db_session,task,new.id).id==new.id


def test_published_baseline_is_refreshed_even_for_a_cached_session(db_session):
    task=make_task(db_session)
    first=draft(db_session,task,"姓名")
    tasks.publish(db_session,task,first.id)
    second=draft(db_session,task,"联系人")
    db_session.commit()
    with Session(engine) as reviewer:
        cached=reviewer.get(Task,task.id)
        assert cached.current_blueprint_id==first.id
        tasks.publish(db_session,task,second.id)
        db_session.commit()
        with pytest.raises(tasks.PublishConflict,match="已发布版本已变化"):
            tasks.publish(reviewer,cached,second.id,expected_published_id=first.id)
        reviewer.rollback()


def test_publish_api_returns_conflict_and_owned_design_has_owner_scope(db_session):
    from fastapi.testclient import TestClient
    from sqlalchemy import select
    from app.main import app
    from app.models import Account
    from tests.test_authz import _register
    with TestClient(app) as client:
        owner=_register(client,"design-cache-owner")
        account=db_session.scalar(select(Account).where(Account.username=="design-cache-owner"))
        task=make_task(db_session);task.created_by=account.id
        bp=draft(db_session,task,"姓名");db_session.commit()
        view=client.get(f"/api/tasks/{task.id}/design",headers=owner).json()
        assert view["task"]["owner_id"]==account.id and view["published"] is None
        path=f"/api/tasks/{task.id}/blueprints/{bp.id}/publish"
        assert client.post(path,headers=owner).status_code==422
        result=client.post(path,headers=owner,data={"expected_published_id":999})
        assert result.status_code==409
        assert client.post(path,headers=owner,data={"expected_published_id":0}).status_code==200
        assert client.post(f"/api/tasks/{task.id}/blueprints/99999/publish",headers=owner,data={"expected_published_id":bp.id}).status_code==404
