"""大模型网关客户端（OpenAI 兼容）。

方案约束：
- 模型不可用时收件仍可用，语义检查显示未完成（第 6/15 节）——调用方必须处理 LLMUnavailable。
- 每次审核有调用预算；预算耗尽明确记录未完成项并转人工，不能虚构全通过（第 4 节）。
- 文件内容只作为数据，不作为指令（第 16 节）——本客户端只发送程序构造的消息。
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

import httpx

from .config import settings


class LLMError(Exception):
    """网关调用失败（网络/HTTP/解析）。"""


class LLMUnavailable(LLMError):
    """模型或网关不可用。业务侧应降级：保留收件，标记检查未完成。"""


class LLMBudgetExceeded(LLMError):
    """本次运行预算耗尽。"""


class Budget:
    """单次审核运行的调用预算。"""

    def __init__(self, max_calls: Optional[int] = None) -> None:
        self.max_calls = max_calls if max_calls is not None else settings.max_llm_calls_per_run
        self.used = 0

    def spend(self) -> None:
        if self.used >= self.max_calls:
            raise LLMBudgetExceeded(f"LLM 调用预算已耗尽（{self.max_calls} 次）")
        self.used += 1


class LLMClient:
    """OpenAI 兼容 /chat/completions 客户端。"""

    def __init__(
        self,
        base_url: Optional[str] = None,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        timeout: Optional[float] = None,
        max_retries: Optional[int] = None,
    ) -> None:
        self.base_url = (base_url if base_url is not None else settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model if model is not None else settings.llm_model
        self.timeout = timeout if timeout is not None else settings.llm_timeout_seconds
        self.max_retries = max_retries if max_retries is not None else settings.llm_max_retries

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def _post(self, payload: dict) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                with httpx.Client(timeout=self.timeout) as client:
                    resp = client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                if resp.status_code >= 500:
                    raise LLMUnavailable(f"网关 {resp.status_code}: {resp.text[:200]}")
                if resp.status_code in (401, 403):
                    raise LLMError(f"网关鉴权失败 {resp.status_code}（检查 API Key）")
                if resp.status_code == 429:
                    raise LLMUnavailable("网关限流 429")
                resp.raise_for_status()
                return resp.json()
            except LLMUnavailable:
                raise
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_exc = e
                if attempt < self.max_retries:
                    time.sleep(2 ** attempt)
                    continue
                raise LLMUnavailable(f"网关连接失败: {e}") from e
            except httpx.HTTPStatusError as e:
                raise LLMError(f"网关 HTTP 错误: {e}") from e
        raise LLMUnavailable(f"网关重试后仍不可用: {last_exc}")

    def chat(self, messages: list[dict], temperature: float = 0.2) -> str:
        if not self.configured:
            raise LLMUnavailable("未配置 FORMFLOW_LLM_API_KEY")
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        data = self._post(payload)
        try:
            return data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError(f"网关响应结构异常: {data!r:.300}") from e

    def chat_json(self, messages: list[dict], temperature: float = 0.1) -> Any:
        """要求模型返回 JSON；容忍 ```json 代码块包裹。解析失败抛 LLMError。"""
        content = self.chat(messages, temperature=temperature)
        text = content.strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text[:4].lower() == "json":
                text = text[4:]
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise LLMError(f"模型未返回 JSON: {content[:200]}")
        try:
            return json.loads(text[start : end + 1])
        except json.JSONDecodeError as e:
            raise LLMError(f"JSON 解析失败: {e}; 原文: {content[:200]}") from e


# 模块级默认客户端（便于替换为测试桩）
_default_client: Optional[LLMClient] = None


def get_client() -> LLMClient:
    global _default_client
    if _default_client is None:
        _default_client = LLMClient()
    return _default_client


def set_client(client: Optional[LLMClient]) -> None:
    """测试注入。"""
    global _default_client
    _default_client = client
