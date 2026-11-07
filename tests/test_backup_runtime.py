from __future__ import annotations

from pathlib import Path

import pytest

from app.config import settings
from scripts import backup_runtime


def test_runtime_data_dir_accepts_configured_sqlite_layout(tmp_path, monkeypatch):
    data = tmp_path / "data"
    monkeypatch.setattr(settings, "database_url", f"sqlite:///{data / 'formflow.db'}")
    monkeypatch.setattr(settings, "storage_dir", data / "storage")

    assert backup_runtime.runtime_data_dir() == data.resolve()


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
