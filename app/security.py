"""安全与凭证。

方案第 2/16 节：提交者使用绑定稳定主体 ID 的可撤销持有凭证；
凭证不是实名认证；凭证可撤销、可过期；只存哈希，不存明文。
"""
from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import datetime, timezone


def generate_credential() -> str:
    """生成提交者持有凭证（明文只返回一次，服务端只存哈希）。"""
    return secrets.token_urlsafe(32)


def hash_credential(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def verify_credential(token: str, token_hash: str) -> bool:
    return hmac.compare_digest(hash_credential(token), token_hash)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
