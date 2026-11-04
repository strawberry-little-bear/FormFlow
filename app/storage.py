"""私有文件存储。

方案第 16 节：原文件、预览、解析产物全部受控；
核验真实类型；文件名做安全处理，防路径穿越与同名覆盖。
所有文件以稳定 ID 命名存放，保留原名映射。
"""
from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

from .config import settings

_UNSAFE = re.compile(r"[^A-Za-z0-9._\-一-龥]")


def ensure_storage() -> Path:
    root = Path(settings.storage_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


def safe_name(original: str) -> str:
    """把用户提供的文件名收敛为安全名，防路径穿越。"""
    name = Path(original).name  # 去掉任何目录成分
    name = _UNSAFE.sub("_", name)
    name = name.strip("._") or "file"
    return name[:120]


def new_file_id() -> str:
    return uuid.uuid4().hex


def file_dir(file_id: str) -> Path:
    root = ensure_storage()
    d = root / file_id[:2] / file_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def save_original(file_id: str, filename: str, content: bytes) -> tuple[Path, str]:
    """保存原件，返回 (路径, sha256)。原件不改写。"""
    d = file_dir(file_id)
    path = d / f"original_{safe_name(filename)}"
    path.write_bytes(content)
    return path, sha256_bytes(content)


def sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def save_artifact(file_id: str, kind: str, content: bytes, suffix: str = ".txt") -> Path:
    """保存解析产物等派生文件（kind 如 parsed_text / preview）。"""
    d = file_dir(file_id)
    path = d / f"{safe_name(kind)}{suffix}"
    path.write_bytes(content)
    return path


def read_original(file_id: str, filename: str) -> bytes:
    return (file_dir(file_id) / f"original_{safe_name(filename)}").read_bytes()
