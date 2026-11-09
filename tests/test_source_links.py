from __future__ import annotations

import httpx

from app.services import source_links


def test_validate_url_rejects_local_and_credential_urls(monkeypatch):
    monkeypatch.setattr(source_links, "_public_host", lambda host: host == "public.example")
    assert source_links.validate_url("https://public.example/notice") == "https://public.example/notice"
    for value in (
        "http://localhost/notice",
        "http://public.example/notice#section",
        "https://user:pass@public.example/notice",
    ):
        try:
            source_links.validate_url(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"expected URL rejection: {value}")


def test_fetch_link_extracts_bounded_visible_text(monkeypatch):
    monkeypatch.setattr(source_links, "_public_host", lambda host: True)
    transport = httpx.MockTransport(lambda request: httpx.Response(
        200,
        headers={"content-type": "text/html; charset=utf-8"},
        text="<html><script>secret()</script><body>通知正文 <b>截止周五</b></body></html>",
        request=request,
    ))
    with httpx.Client(transport=transport) as client:
        text, status = source_links.fetch_link("https://public.example/notice", client=client)
    assert text == "通知正文 截止周五"
    assert "已读取" in status


def test_fetch_link_keeps_body_within_prompt_budget(monkeypatch):
    monkeypatch.setattr(source_links, "_public_host", lambda host: True)
    transport = httpx.MockTransport(lambda request: httpx.Response(
        200,
        headers={"content-type": "text/plain"},
        content=b"x" * 20_000,
        request=request,
    ))
    with httpx.Client(transport=transport) as client:
        text, _status = source_links.fetch_link("https://public.example/notice", client=client)
    assert len(text) <= source_links.MAX_CHARS


def test_fetch_link_does_not_follow_redirects(monkeypatch):
    monkeypatch.setattr(source_links, "_public_host", lambda host: True)
    transport = httpx.MockTransport(lambda request: httpx.Response(
        302,
        headers={"location": "https://public.example/other"},
        request=request,
    ))
    with httpx.Client(transport=transport) as client:
        text, status = source_links.fetch_link("https://public.example/notice", client=client)
    assert text == ""
    assert "未跟随重定向" in status


def test_enrich_links_preserves_failed_link_as_explicit_context(monkeypatch):
    monkeypatch.setattr(source_links, "fetch_link", lambda _url: ("", "链接未读取：页面没有可用文字"))
    items = [{"id": "link-1", "name": "https://public.example/notice", "kind": "attachment", "content": "参考链接"}]
    enriched = source_links.enrich_links(items)
    assert "链接未读取" in enriched[0]["content"]
