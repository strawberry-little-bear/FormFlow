"""LLM 客户端与预算测试（不访问网络，用假客户端）。"""
from __future__ import annotations

import pytest

from app.llm import Budget, LLMBudgetExceeded, LLMClient, LLMError, LLMUnavailable


class FakeTransport:
    def __init__(self, content=None, status=200):
        self.content = content
        self.status = status
        self.calls = 0

    def __call__(self, request):
        self.calls += 1
        import httpx

        if self.status >= 500:
            return httpx.Response(self.status, json={"error": "boom"})
        return httpx.Response(200, json={
            "choices": [{"message": {"content": self.content}}]
        })


def make_client(content, status=200, max_retries=0):
    client = LLMClient(api_key="test-key")
    client._transport = FakeTransport(content, status)
    orig_post = client._post

    def post(payload):
        transport = client._transport
        if transport.status >= 500:
            raise LLMUnavailable("gateway 500")
        return {"choices": [{"message": {"content": transport.content}}]}

    client._post = post
    return client


def test_chat_returns_content():
    c = make_client("你好")
    assert c.chat([{"role": "user", "content": "hi"}]) == "你好"


def test_chat_json_tolerates_code_fence():
    c = make_client('```json\n{"a": 1}\n```')
    assert c.chat_json([{"role": "user", "content": "x"}]) == {"a": 1}


def test_chat_json_raises_on_garbage():
    c = make_client("not json at all")
    with pytest.raises(LLMError):
        c.chat_json([{"role": "user", "content": "x"}])


def test_unavailable_when_no_key():
    c = LLMClient(api_key="")
    with pytest.raises(LLMUnavailable):
        c.chat([{"role": "user", "content": "x"}])


def test_budget_blocks_after_limit():
    b = Budget(max_calls=2)
    b.spend()
    b.spend()
    with pytest.raises(LLMBudgetExceeded):
        b.spend()
