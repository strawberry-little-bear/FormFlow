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


# ===== 降级模型（fallback）测试 =====

def _install_behavior(client, behavior):
    """用可控行为替换 client._post；behavior(payload) -> dict 或抛 LLMUnavailable。

    记录每次调用的 (model, timeout, max_retries)，用于验证主模型快速失败策略。
    """
    calls = []

    def post(payload):
        calls.append((payload["model"], client.timeout, client.max_retries))
        return behavior(payload)

    client._post = post
    return calls


def _primary_down_fallback_ok(payload):
    if payload["model"] == "m-primary":
        raise LLMUnavailable("主模型超时")
    return {"choices": [{"message": {"content": "兜底结果"}}]}


def _always_down(payload):
    raise LLMUnavailable("网关不可用")


def test_primary_unavailable_falls_back_to_fast_model():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="m-fallback")
    calls = _install_behavior(c, _primary_down_fallback_ok)
    assert c.chat([{"role": "user", "content": "x"}]) == "兜底结果"
    assert c.fallback_used is True
    assert [m for m, _, _ in calls] == ["m-primary", "m-fallback"]


def test_primary_unavailable_without_fallback_raises():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="")
    calls = _install_behavior(c, _always_down)
    with pytest.raises(LLMUnavailable):
        c.chat([{"role": "user", "content": "x"}])
    assert len(calls) == 1
    assert c.fallback_used is False


def test_fallback_also_unavailable_raises_for_manual_review():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="m-fallback")
    calls = _install_behavior(c, _always_down)
    with pytest.raises(LLMUnavailable):
        c.chat([{"role": "user", "content": "x"}])
    assert len(calls) == 2  # 主模型与降级模型各试过一次，均失败后上抛转人工
    assert c.fallback_used is False


def test_empty_content_raises_llm_error():
    for empty in ("", "   ", None):
        c = make_client(empty)
        with pytest.raises(LLMError):
            c.chat([{"role": "user", "content": "x"}])


def test_primary_attempt_converges_when_fallback_configured():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="m-fallback",
                  timeout=300, max_retries=2)
    assert c.primary_timeout == 90.0
    calls = _install_behavior(c, lambda p: {"choices": [{"message": {"content": "ok"}}]})
    c.chat([{"role": "user", "content": "x"}])
    # 有降级模型时主模型快速失败：时限收敛到 90s、不做内部重试
    assert calls[0] == ("m-primary", 90.0, 0)


def test_primary_timeout_full_when_no_fallback():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="",
                  timeout=300, max_retries=2)
    assert c.primary_timeout == 300


def test_fallback_attempt_uses_full_timeout_and_retries():
    c = LLMClient(api_key="k", model="m-primary", fallback_model="m-fallback",
                  timeout=300, max_retries=2)
    calls = _install_behavior(c, _primary_down_fallback_ok)
    c.chat([{"role": "user", "content": "x"}])
    assert calls[1] == ("m-fallback", 300, 2)


def test_expired_deadline_skips_http_request(monkeypatch):
    import time

    def unexpected_client(*_args, **_kwargs):
        raise AssertionError("expired request must not create an HTTP client")

    monkeypatch.setattr("app.llm.httpx.Client", unexpected_client)
    c = LLMClient(api_key="k", fallback_model="")
    with pytest.raises(LLMUnavailable, match="时限已耗尽"):
        c.chat_json([], deadline_monotonic=time.monotonic() - 1)


def test_expired_primary_deadline_skips_fallback(monkeypatch):
    import httpx

    clock = [100.0]
    calls = []

    class FailingClient:
        def __init__(self, *, timeout):
            calls.append(timeout)

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            clock[0] = 102.0
            raise httpx.ConnectError("primary unavailable")

    monkeypatch.setattr("app.llm.time.monotonic", lambda: clock[0])
    monkeypatch.setattr("app.llm.httpx.Client", FailingClient)
    monkeypatch.setattr("app.llm.time.sleep", lambda _seconds: None)
    c = LLMClient(api_key="k", model="primary", fallback_model="fallback",
                  timeout=20, max_retries=1)

    with pytest.raises(LLMUnavailable, match="时限已耗尽"):
        c.chat([], deadline_monotonic=101.0)

    assert calls == [1.0]
