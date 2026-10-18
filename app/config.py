"""FormFlow 收齐啦 - 应用配置。

所有配置来自环境变量（本地开发用 .env，已被 gitignore）。
密钥绝不写入代码或提交到仓库。
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent


class Settings:
    """运行配置。密钥仅从环境读取。"""

    def __init__(self) -> None:
        # 大模型网关（OpenAI 兼容接口）
        self.llm_base_url: str = os.environ.get(
            "FORMFLOW_LLM_BASE_URL", "https://aigw.saurlax.com/v1"
        ).rstrip("/")
        self.llm_api_key: str = os.environ.get("FORMFLOW_LLM_API_KEY", "")
        self.llm_model: str = os.environ.get("FORMFLOW_LLM_MODEL", "glm-5.3")

        self.database_url: str = os.environ.get(
            "FORMFLOW_DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'formflow.db'}"
        )
        self.storage_dir: Path = Path(
            os.environ.get("FORMFLOW_STORAGE_DIR", str(BASE_DIR / "data" / "storage"))
        )

        # 审核预算（方案第 4 节：每次审核需有页数/OCR/调用/重试/费用预算）
        self.max_pages_per_run: int = int(os.environ.get("FORMFLOW_MAX_PAGES_PER_RUN", "40"))
        self.max_llm_calls_per_run: int = int(os.environ.get("FORMFLOW_MAX_LLM_CALLS_PER_RUN", "30"))
        self.llm_timeout_seconds: float = float(os.environ.get("FORMFLOW_LLM_TIMEOUT_SECONDS", "60"))
        self.llm_max_retries: int = int(os.environ.get("FORMFLOW_LLM_MAX_RETRIES", "2"))

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)


settings = Settings()
