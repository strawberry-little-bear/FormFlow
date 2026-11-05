"""需求 Agent 来源资料的持久化边界与页级定位。"""
from __future__ import annotations

from app.models import Account, SOURCE_UNREAD
from app.parsing import ParseResult
from app.services import source_materials

from tests.conftest import make_task


def test_source_materials_persist_page_markers_and_unread_pages(
        db_session, monkeypatch):
    account = Account(username="source-owner", password_hash="hash", password_salt="salt")
    db_session.add(account)
    db_session.flush()
    task = make_task(db_session, name="来源资料定位")

    monkeypatch.setattr(
        source_materials,
        "parse_file",
        lambda _path, allow_ocr=False: ParseResult(
            pages=["截止时间：11 月 8 日", "报名表字段：姓名"],
            page_numbers=[1, 3],
            unread_pages=1,
            unread_page_numbers=[2],
            method="text",
        ),
    )

    row = source_materials.create(
        db_session,
        task,
        account,
        kind="notice",
        original_name="通知.pdf",
        mime="application/pdf",
        content=b"%PDF-1.4 source fixture",
    )

    assert row.status == SOURCE_UNREAD
    assert "【第 1 页】" in row.extracted_text
    assert "【第 2 页：未读】" in row.extracted_text
    assert "【第 3 页】" in row.extracted_text
    assert "不能据此判断材料缺失" in row.extracted_text
