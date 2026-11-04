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


def new_salt() -> str:
    """生成随机 salt（每个账号独立，替换此前的静态 salt）。"""
    return secrets.token_hex(16)


def hash_password(password: str, salt: str) -> str:
    """PBKDF2-HMAC-SHA256，10 万次迭代。"""
    return hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), 100_000
    ).hex()


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    if not salt or not expected_hash:
        return False
    return hmac.compare_digest(hash_password(password, salt), expected_hash)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)
