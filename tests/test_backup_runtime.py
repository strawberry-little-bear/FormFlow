from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys

import pytest

from app.config import settings
from scripts import backup_runtime


def test_backup_runtime_script_runs_from_repository_root():
    """The documented script entry point must import the application package."""
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [sys.executable, "scripts/backup_runtime.py", "--help"],
        cwd=root,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )

    assert result.returncode == 0
    assert "备份、校验和恢复" in result.stdout
    assert "env-file" in result.stdout


def test_runtime_data_dir_accepts_configured_sqlite_layout(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{data / 'formflow.db'}")
    monkeypatch.setattr(settings, "storage_dir", data / "storage")

    assert backup_runtime.runtime_data_dir() == data.resolve()


def test_runtime_data_dir_accepts_an_explicit_settings_object(tmp_path):
    data = tmp_path / "data"
    from app.config import Settings

    old = {
        "FORMFLOW_DATABASE_URL": os.environ.get("FORMFLOW_DATABASE_URL"),
        "FORMFLOW_STORAGE_DIR": os.environ.get("FORMFLOW_STORAGE_DIR"),
    }
    try:
        os.environ["FORMFLOW_DATABASE_URL"] = f"sqlite:///{data / 'formflow.db'}"
        os.environ["FORMFLOW_STORAGE_DIR"] = str(data / "storage")
        config = Settings()
    finally:
        for key, value in old.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    assert backup_runtime.runtime_data_dir(config) == data.resolve()


def test_runtime_data_dir_rejects_non_sqlite(monkeypatch):
    monkeypatch.setattr(settings, "database_url", "postgresql://localhost/formflow")
    with pytest.raises(backup_runtime.BackupError, match="只支持 SQLite"):
        backup_runtime.runtime_data_dir()


def test_runtime_data_dir_rejects_storage_outside_database_dir(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{data / 'formflow.db'}")
    monkeypatch.setattr(settings, "storage_dir", tmp_path / "storage")

    with pytest.raises(backup_runtime.BackupError, match="必须是数据库目录下的 storage"):
        backup_runtime.runtime_data_dir()
