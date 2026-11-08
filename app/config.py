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
        self.environment: str = os.environ.get("FORMFLOW_ENV", "development").strip().lower()
        if self.environment not in {"development", "demo", "production", "test"}:
            self.environment = "development"
        # Public account creation is convenient for a local demo, but should be
        # explicitly disabled on an internet-facing deployment.
        self.allow_registration: bool = _env_bool(
            "FORMFLOW_ALLOW_REGISTRATION", self.environment != "production"
        )
        # 大模型网关（OpenAI 兼容接口）；公开默认值只使用占位 provider。
        self.llm_base_url: str = os.environ.get(
            "FORMFLOW_LLM_BASE_URL", "https://your-provider.example/v1"
        ).rstrip("/")
        # Direct process deployments can use the environment variable. Docker
        # deployments can mount a file secret so compose config never expands
        # the key into its output.
        self.llm_api_key_file: Path | None = _env_path("FORMFLOW_LLM_API_KEY_FILE")
        self.llm_api_key: str = os.environ.get("FORMFLOW_LLM_API_KEY", "").strip()
        if not self.llm_api_key and self.llm_api_key_file:
            self.llm_api_key = _read_secret_file(self.llm_api_key_file)
        self.llm_model: str = os.environ.get("FORMFLOW_LLM_MODEL", "your-model")
        # auto 优先把原始文件交给支持文件输入的模型；不支持时回退到文本解析/OCR。
        # text/ocr 可用于明确禁止原始材料离开本机，direct 则在不支持时直接报未完成。
        self.llm_input_mode: str = os.environ.get("FORMFLOW_LLM_INPUT_MODE", "auto").strip().lower()
        if self.llm_input_mode not in {"auto", "direct", "text", "ocr"}:
            self.llm_input_mode = "auto"
        self.llm_max_file_bytes: int = int(
            os.environ.get("FORMFLOW_LLM_MAX_FILE_BYTES", str(20 * 1024 * 1024))
        )
        # Bound multipart uploads before they are copied into memory. Blueprint
        # limits may be stricter; this is the deployment-wide safety ceiling.
        self.max_upload_bytes: int = max(
            1, int(os.environ.get("FORMFLOW_MAX_UPLOAD_BYTES", str(50 * 1024 * 1024)))
        )
        # 主模型不可用时的降级模型（如 step-3.7-flash）；留空则不降级。
        self.llm_fallback_model: str = os.environ.get("FORMFLOW_LLM_FALLBACK_MODEL", "")

        self.database_url: str = os.environ.get(
            "FORMFLOW_DATABASE_URL", f"sqlite:///{BASE_DIR / 'data' / 'formflow.db'}"
        )
        self.storage_dir: Path = Path(
            os.environ.get("FORMFLOW_STORAGE_DIR", str(BASE_DIR / "data" / "storage"))
        )
        self.worker_heartbeat_file: Path = Path(
            os.environ.get("FORMFLOW_WORKER_HEARTBEAT_FILE", str(self.storage_dir / ".worker-heartbeat"))
        )

        # 解析预算（第 16 节：限制页数、资源与解析时间）
        self.max_ocr_pages_per_file: int = int(os.environ.get("FORMFLOW_MAX_OCR_PAGES_PER_FILE", "20"))
        self.ocr_time_budget_seconds: float = float(os.environ.get("FORMFLOW_OCR_TIME_BUDGET_SECONDS", "120"))
        # 审核预算（方案第 4 节：每次审核需有页数/OCR/调用/重试/费用预算）
        self.max_pages_per_run: int = int(os.environ.get("FORMFLOW_MAX_PAGES_PER_RUN", "40"))
        self.max_llm_calls_per_run: int = int(os.environ.get("FORMFLOW_MAX_LLM_CALLS_PER_RUN", "30"))
        # 默认 300s；主模型较慢且无降级时可按 provider 能力调大。
        self.llm_timeout_seconds: float = float(os.environ.get("FORMFLOW_LLM_TIMEOUT_SECONDS", "300"))
        self.llm_max_retries: int = int(os.environ.get("FORMFLOW_LLM_MAX_RETRIES", "2"))
        # 组织者会话默认保留 7 天；显式设置可缩短公网部署的 token 有效期。
        self.session_ttl_seconds: int = max(
            300, int(os.environ.get("FORMFLOW_SESSION_TTL_SECONDS", str(7 * 24 * 60 * 60)))
        )

    @property
    def llm_configured(self) -> bool:
        return bool(self.llm_api_key)


def _env_bool(name: str, default: bool) -> bool:
    """Parse a boolean environment value without treating arbitrary text as true."""
    raw = os.environ.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    return default


def _env_path(name: str) -> Path | None:
    raw = os.environ.get(name, "").strip()
    return Path(raw) if raw else None


def _read_secret_file(path: Path) -> str:
    """Read a local secret without including its value in errors."""
    try:
        return path.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeError):
        return ""


settings = Settings()
