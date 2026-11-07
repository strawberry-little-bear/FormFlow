"""LLM 客户端与预算测试（不访问网络，用假客户端）。"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.llm import (
    Budget,
    DocumentInput,
    LLMBudgetExceeded,
    LLMClient,
    LLMError,
    LLMInputUnsupported,
    LLMUnavailable,
)


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


def test_document_parts_encode_images_and_files(tmp_path, monkeypatch):
    monkeypatch.setattr("app.config.settings.llm_max_file_bytes", 1024)
    image = Path(tmp_path) / "scan.png"
    image.write_bytes(b"png-bytes")
    pdf = Path(tmp_path) / "report.pdf"
    pdf.write_bytes(b"pdf-bytes")
    c = LLMClient(api_key="k")

    parts = c._document_parts([
        DocumentInput("img", "scan.png", image, "image/png"),
        DocumentInput("pdf", "report.pdf", pdf, "application/pdf"),
    ])

    assert [part["type"] for part in parts] == ["text", "image_url", "text", "file"]
    assert parts[1]["image_url"]["url"].startswith("data:image/png;base64,")
    assert parts[3]["file"]["file_data"].startswith("data:application/pdf;base64,")


def test_document_4xx_is_input_unsupported_but_regular_4xx_is_llm_error(monkeypatch, tmp_path):
    import httpx

    class ResponseClient:
        def __init__(self, *, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, *_args, **_kwargs):
            return httpx.Response(
                415,
                text="file input is not supported",
                request=httpx.Request("POST", "https://example.test/v1/chat/completions"),
            )

    monkeypatch.setattr("app.llm.httpx.Client", ResponseClient)
    c = LLMClient(api_key="k", max_retries=0)
    image = Path(tmp_path) / "scan.png"
    image.write_bytes(b"png")
    messages = [{"role": "user", "content": "review"}]

    with pytest.raises(LLMInputUnsupported):
        c.chat_json_documents(messages, [DocumentInput("img", "scan.png", image, "image/png")])
    with pytest.raises(LLMError):
        c.chat(messages)


def test_document_size_limit_fails_before_request(monkeypatch, tmp_path):
    monkeypatch.setattr("app.config.settings.llm_max_file_bytes", 2)
    path = Path(tmp_path) / "report.pdf"
    path.write_bytes(b"too-large")
    c = LLMClient(api_key="k")

    with pytest.raises(LLMInputUnsupported, match="超过直传上限"):
        c.chat_json_documents(
            [{"role": "user", "content": "review"}],
            [DocumentInput("pdf", "report.pdf", path, "application/pdf")],
        )


def test_real_http_document_payload_keeps_key_in_header_only(monkeypatch, tmp_path):
    """验证真实 LLMClient 的 provider 请求契约，而不是只测注入式 chat 桩。"""
    import json
    import httpx

    image = Path(tmp_path) / "scan.png"
    image.write_bytes(b"png-bytes")
    pdf = Path(tmp_path) / "报名表.pdf"
    pdf.write_bytes(b"pdf-bytes")
    captured = {}

    class CapturingClient:
        def __init__(self, *, timeout):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, *, json, headers):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return httpx.Response(
                200,
                json={"choices": [{"message": {"content": '{"result":"unknown"}'}}]},
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr("app.llm.httpx.Client", CapturingClient)
    client = LLMClient(
        base_url="https://provider.example/v1",
        api_key="secret-provider-key",
        model="vision-model",
        max_retries=0,
    )
    payload = client.chat_json_documents(
        [{"role": "user", "content": "逐项核验材料"}],
        [
            DocumentInput("img-1", "scan.png", image, "image/png"),
            DocumentInput("pdf-1", "报名表.pdf", pdf, "application/pdf"),
        ],
    )

    assert payload == {"result": "unknown"}
    assert captured["url"] == "https://provider.example/v1/chat/completions"
    assert captured["headers"] == {"Authorization": "Bearer secret-provider-key"}
    request_json = captured["json"]
    assert request_json["model"] == "vision-model"
    content = request_json["messages"][-1]["content"]
    assert [part["type"] for part in content] == [
        "text", "text", "image_url", "text", "file",
    ]
    assert content[2]["image_url"]["url"].startswith("data:image/png;base64,")
    assert content[4]["file"]["filename"] == "报名表.pdf"
    assert content[4]["file"]["file_data"].startswith("data:application/pdf;base64,")
    assert "secret-provider-key" not in json.dumps(request_json, ensure_ascii=False)


def test_provider_error_summary_redacts_api_key_and_authorization(monkeypatch):
    import httpx

    class ErrorClient:
        def __init__(self, *, timeout):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def post(self, url, *, json, headers):
            return httpx.Response(
                500,
                text="authorization=secret-provider-key api_key:secret-provider-key",
                request=httpx.Request("POST", url),
            )

    monkeypatch.setattr("app.llm.httpx.Client", ErrorClient)
    client = LLMClient(api_key="secret-provider-key", max_retries=0)

    with pytest.raises(LLMUnavailable) as exc_info:
        client.chat([{"role": "user", "content": "review"}])
    message = str(exc_info.value)
    assert "secret-provider-key" not in message
    assert "[redacted]" in message
