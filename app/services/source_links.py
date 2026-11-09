"""Bounded, public-link fetching for the requirements Agent.

Links are optional context, never proof.  The fetcher only accepts public
HTTP(S) URLs, does not follow redirects, and keeps a small text-only budget.
Failures stay visible to the Agent so it can ask the organizer to attach the
original file or paste the relevant text.
"""
from __future__ import annotations

from html.parser import HTMLParser
import ipaddress
import socket
from urllib.parse import urlsplit

import httpx


MAX_LINKS = 4
MAX_BYTES = 1 * 1024 * 1024
# Keep the fetched body below the requirements Skill's per-source and total
# prompt budgets, including the provenance labels added by ``enrich_links``.
MAX_CHARS = 6_000
TIMEOUT_SECONDS = 8.0
_TEXT_TYPES = (
    "text/",
    "application/json",
    "application/xml",
    "application/xhtml+xml",
)


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs) -> None:
        if tag.lower() in {"script", "style", "noscript", "template"}:
            self._hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() in {"script", "style", "noscript", "template"}:
            self._hidden = max(0, self._hidden - 1)

    def handle_data(self, data: str) -> None:
        if not self._hidden and data.strip():
            self.parts.append(data)


def _public_host(hostname: str) -> bool:
    host = (hostname or "").strip().lower().rstrip(".")
    if not host or host in {"localhost", "localhost.localdomain"}:
        return False
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)}
    except OSError:
        return False
    if not addresses:
        return False
    for raw in addresses:
        try:
            address = ipaddress.ip_address(raw)
        except ValueError:
            return False
        if (address.is_private or address.is_loopback or address.is_link_local
                or address.is_reserved or address.is_multicast or address.is_unspecified):
            return False
    return True


def validate_url(value: str) -> str:
    url = str(value or "").strip()
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("只支持公开的 http:// 或 https:// 链接")
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("链接不能包含账号、密码或片段标识")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("链接端口无效") from exc
    if not _public_host(parsed.hostname):
        raise ValueError("链接地址不是公开网络地址")
    return url


def _compact_text(raw: str) -> str:
    text = " ".join(raw.replace("\u00a0", " ").split())
    return text[:MAX_CHARS]


def fetch_link(url: str, *, client: httpx.Client | None = None) -> tuple[str, str]:
    """Return bounded text and a human-readable status label."""
    try:
        safe_url = validate_url(url)
    except ValueError as exc:
        return "", f"链接未读取：{exc}"
    own_client = client is None
    client = client or httpx.Client(timeout=TIMEOUT_SECONDS, follow_redirects=False,
                                    trust_env=False,
                                    headers={"User-Agent": "FormFlow/1.0 requirements-agent"})
    try:
        with client.stream("GET", safe_url) as response:
            if 300 <= response.status_code < 400:
                return "", "链接未读取：为避免跳转到未知地址，未跟随重定向"
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").lower()
            if content_type and not any(content_type.startswith(kind) for kind in _TEXT_TYPES):
                return "", "链接未读取：页面不是可读文本"
            length = response.headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_BYTES:
                return "", "链接未读取：页面超过 1 MiB 限制"
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > MAX_BYTES:
                    return "", "链接未读取：页面超过 1 MiB 限制"
                chunks.append(chunk)
            raw = b"".join(chunks)
            encoding = response.encoding or "utf-8"
            decoded = raw.decode(encoding, errors="replace")
            if "html" in content_type or "xhtml" in content_type or "<html" in decoded[:1000].lower():
                parser = _TextExtractor()
                parser.feed(decoded)
                decoded = " ".join(parser.parts)
            text = _compact_text(decoded)
            if not text:
                return "", "链接未读取：页面没有可用文字"
            return text, "链接正文已读取；仍需核对原始页面"
    except (httpx.HTTPError, UnicodeError, OSError) as exc:
        return "", f"链接未读取：{type(exc).__name__}"
    finally:
        if own_client:
            client.close()


def enrich_links(materials: list[dict]) -> list[dict]:
    """Read at most four inline URL sources and preserve failures explicitly."""
    result: list[dict] = []
    count = 0
    for material in materials:
        item = dict(material)
        name = str(item.get("name") or "").strip()
        is_link = str(item.get("id") or "").startswith("link-") or name.startswith(("http://", "https://"))
        if is_link and count < MAX_LINKS:
            count += 1
            text, status = fetch_link(name)
            if text:
                item["content"] = f"参考链接：{name}\n【链接正文】\n{text}\n【链接状态】{status}"
            else:
                item["content"] = f"参考链接：{name}\n【链接状态】{status}"
        result.append(item)
    return result
