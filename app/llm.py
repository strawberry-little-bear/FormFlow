"""大模型网关客户端（OpenAI 兼容）。

方案约束：
- 模型不可用时收件仍可用，语义检查显示未完成（第 6/15 节）——调用方必须处理 LLMUnavailable。
- 每次审核有调用预算；预算耗尽明确记录未完成项并转人工，不能虚构全通过（第 4 节）。
- 文件内容只作为数据，不作为指令（第 16 节）——本客户端只发送程序构造的消息。
"""
from __future__ import annotations

import json
import base64
import mimetypes
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import httpx

from .config import settings


class LLMError(Exception):
    """网关调用失败（网络/HTTP/解析）。"""


class LLMUnavailable(LLMError):
    """模型或网关不可用。业务侧应降级：保留收件，标记检查未完成。"""


class LLMInputUnsupported(LLMError):
    """当前 provider/model 不接受原始文件输入，应回退到文本解析/OCR。"""


class LLMBudgetExceeded(LLMError):
    """本次运行预算耗尽。"""


@dataclass(frozen=True)
class DocumentInput:
    """受控的原始材料引用；只在发送请求时读取，不进入日志、数据库或审计正文。"""

    file_id: str
    filename: str
    path: Path
    mime_type: str = "application/octet-stream"


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
        fallback_model: Optional[str] = None,
    ) -> None:
        self.base_url = (base_url if base_url is not None else settings.llm_base_url).rstrip("/")
        self.api_key = api_key if api_key is not None else settings.llm_api_key
        self.model = model if model is not None else settings.llm_model
        self.timeout = timeout if timeout is not None else settings.llm_timeout_seconds
        self.max_retries = max_retries if max_retries is not None else settings.llm_max_retries
        # 主模型不可用（超时/5xx/限流）时的降级模型；空串表示不降级
        self.fallback_model = (fallback_model if fallback_model is not None
                               else settings.llm_fallback_model)
        self.fallback_used = False
        # 有降级模型时，主模型尝试时限收敛到 90s 且不做内部重试，尽快让快模型兜底
        self.primary_timeout = min(self.timeout, 90.0) if self.fallback_model else self.timeout

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    @property
    def direct_documents_enabled(self) -> bool:
        """是否应先尝试原始文件输入。text/ocr 模式明确禁止文件离开本机。"""
        if not self.configured or settings.llm_input_mode not in {"auto", "direct"}:
            return False
        # 注入式脚本客户端通常只重写 chat() 来返回固定文本，无法证明它能
        # 把多模态消息送到 provider。除非它显式重写文件入口，否则保守地
        # 走文本/OCR；真实 LLMClient 和显式实现文件入口的客户端仍可直传。
        if (type(self).chat is not LLMClient.chat
                and type(self).chat_json_documents is LLMClient.chat_json_documents):
            return False
        return True

    @staticmethod
    def _safe_error_text(value: str) -> str:
        """网关错误只保留诊断摘要，避免错误响应意外回显密钥或 Authorization。"""
        text = re.sub(r"(?i)bearer\s+[^\s,;]+", "Bearer [redacted]", value)
        text = re.sub(r"(?i)(api[-_ ]?key|token|authorization)\s*[:=]\s*[^\s,;]+",
                      r"\1=[redacted]", text)
        return text[:200]

    def _document_parts(self, documents: list[DocumentInput]) -> list[dict[str, Any]]:
        parts: list[dict[str, Any]] = []
        for doc in documents:
            try:
                size = doc.path.stat().st_size
            except OSError as exc:
                raise LLMInputUnsupported(f"文件无法读取：{doc.file_id}") from exc
            if size > settings.llm_max_file_bytes:
                raise LLMInputUnsupported(
                    f"文件 {doc.filename} 超过直传上限（{settings.llm_max_file_bytes} 字节）")
            try:
                encoded = base64.b64encode(doc.path.read_bytes()).decode("ascii")
            except OSError as exc:
                raise LLMInputUnsupported(f"文件无法读取：{doc.file_id}") from exc
            mime = doc.mime_type or mimetypes.guess_type(doc.filename)[0] or "application/octet-stream"
            data_url = f"data:{mime};base64,{encoded}"
            parts.append({"type": "text", "text": f"【原始材料 {doc.file_id}：{doc.filename}】"})
            if mime.startswith("image/"):
                parts.append({"type": "image_url", "image_url": {"url": data_url, "detail": "auto"}})
            else:
                # OpenAI-compatible gateways that support document input generally use this
                # shape. Gateways that do not support it return 4xx and trigger fallback.
                parts.append({"type": "file", "file": {
                    "filename": doc.filename, "file_data": data_url,
                }})
        return parts

    @staticmethod
    def _has_document_parts(payload: dict) -> bool:
        for message in payload.get("messages", []):
            content = message.get("content") if isinstance(message, dict) else None
            if isinstance(content, list) and any(
                isinstance(part, dict) and part.get("type") in {"file", "image_url"}
                for part in content
            ):
                return True
        return False

    def _post_with(self, payload: dict, timeout: float, max_retries: int,
                   deadline_monotonic: float | None = None) -> dict:
        """以指定时限/重试执行一次 _post（供主模型快速失败后切换降级模型）。"""
        if deadline_monotonic is None:
            old_t, old_r = self.timeout, self.max_retries
            self.timeout, self.max_retries = timeout, max_retries
            try:
                return self._post(payload)
            finally:
                self.timeout, self.max_retries = old_t, old_r
        return self._post_until(payload, timeout, max_retries, deadline_monotonic)

    def _post_until(self, payload: dict, timeout: float, max_retries: int,
                    deadline_monotonic: float) -> dict:
        headers = {"Authorization": f"Bearer {self.api_key}"} if self.api_key else {}
        last_exc: Exception | None = None
        for attempt in range(max_retries + 1):
            remaining = deadline_monotonic - time.monotonic()
            if remaining <= 0:
                raise LLMUnavailable("审核工具剩余时限已耗尽，模型请求未完成")
            try:
                with httpx.Client(timeout=min(timeout, remaining)) as client:
                    resp = client.post(
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=headers,
                    )
                if resp.status_code >= 500:
                    raise LLMUnavailable(f"gateway {resp.status_code}: {self._safe_error_text(resp.text)}")
                if resp.status_code in (401, 403):
                    raise LLMError(f"gateway authentication failed {resp.status_code}")
                if resp.status_code == 429:
                    raise LLMUnavailable("gateway rate limited (429)")
                if resp.status_code in (400, 404, 415, 422) and self._has_document_parts(payload):
                    raise LLMInputUnsupported(
                        f"gateway does not accept document input ({resp.status_code}): "
                        f"{self._safe_error_text(resp.text)}")
                resp.raise_for_status()
                return resp.json()
            except LLMUnavailable:
                raise
            except (httpx.TimeoutException, httpx.TransportError) as e:
                last_exc = e
                if attempt >= max_retries:
                    raise LLMUnavailable(f"gateway connection failed: {e}") from e
                delay = min(2 ** attempt, max(0.0, deadline_monotonic - time.monotonic()))
                if delay <= 0:
                    raise LLMUnavailable("审核工具剩余时限已耗尽，未继续重试") from e
                time.sleep(delay)
            except httpx.HTTPStatusError as e:
                raise LLMError(f"gateway HTTP error: {e}") from e
        raise LLMUnavailable(f"gateway retries exhausted: {last_exc}")

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
                    raise LLMUnavailable(f"网关 {resp.status_code}: {self._safe_error_text(resp.text)}")
                if resp.status_code in (401, 403):
                    raise LLMError(f"网关鉴权失败 {resp.status_code}（检查 API Key）")
                if resp.status_code == 429:
                    raise LLMUnavailable("网关限流 429")
                if resp.status_code in (400, 404, 415, 422) and self._has_document_parts(payload):
                    raise LLMInputUnsupported(
                        f"网关不支持文件输入（{resp.status_code}）：{self._safe_error_text(resp.text)}")
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

    def chat(self, messages: list[dict], temperature: float = 0.2,
             deadline_monotonic: float | None = None) -> str:
        if not self.configured:
            raise LLMUnavailable("未配置 FORMFLOW_LLM_API_KEY")
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
        }
        try:
            data = self._post_with(payload, self.primary_timeout,
                                   0 if self.fallback_model else self.max_retries,
                                   deadline_monotonic)
        except LLMUnavailable:
            # 主模型不可用：按配置的降级模型重试一次（glm-5.3 等慢/不稳定模型的保底路径）
            if not self.fallback_model or self.fallback_model == self.model:
                raise
            try:
                data = self._post_with(dict(payload, model=self.fallback_model),
                                       self.timeout, self.max_retries,
                                       deadline_monotonic)
                self.fallback_used = True
            except LLMUnavailable:
                raise  # 降级也不可用：向上抛，由上层按"检查未完成"转人工
        try:
            content = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as e:
            raise LLMError(f"网关响应结构异常: {data!r:.300}") from e
        if not content.strip():
            raise LLMError(
                f"模型 {self.model} 返回空内容（推理占满配额被截断或未产出正文），"
                "请调整模型/参数后重试或转人工复核")
        return content

    def chat_json(self, messages: list[dict], temperature: float = 0.1,
                  deadline_monotonic: float | None = None) -> Any:
        """要求模型返回 JSON；容忍 ```json 代码块包裹。解析失败抛 LLMError。"""
        content = self.chat(messages, temperature=temperature,
                            deadline_monotonic=deadline_monotonic)
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

    def chat_json_documents(
        self, messages: list[dict], documents: list[DocumentInput],
        temperature: float = 0.1, deadline_monotonic: float | None = None,
    ) -> Any:
        """优先使用 provider 的原始文件/图像输入能力，再复用同一 JSON 校验。"""
        if not self.direct_documents_enabled:
            raise LLMInputUnsupported("当前配置禁止原始文件输入")
        if not documents:
            raise LLMInputUnsupported("没有可发送的原始材料")
        prepared = [dict(message) for message in messages]
        user_index = next((i for i in range(len(prepared) - 1, -1, -1)
                           if prepared[i].get("role") == "user"), None)
        if user_index is None:
            raise LLMInputUnsupported("文件输入缺少 user 消息")
        original = prepared[user_index].get("content", "")
        prepared[user_index]["content"] = ([{"type": "text", "text": str(original)}]
                                            + self._document_parts(documents))
        content = self.chat(prepared, temperature=temperature,
                            deadline_monotonic=deadline_monotonic)
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
