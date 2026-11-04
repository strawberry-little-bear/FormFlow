import json
import sqlite3
import zipfile
from contextlib import closing

import pytest

from scripts import backup_demo


def _demo(tmp_path):
    demo = tmp_path / "demo"
    storage = demo / "storage" / "files"
    storage.mkdir(parents=True)
    db_path = demo / "formflow.db"
    with closing(sqlite3.connect(db_path)) as db:
        with db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("CREATE TABLE sample (value TEXT)")
            db.execute("INSERT INTO sample VALUES ('kept')")
    (storage / "private.bin").write_bytes(b"private attachment")
    return demo


def test_backup_verify_and_restore_round_trip(tmp_path):
    demo = _demo(tmp_path)
    archive = tmp_path / "backup.zip"
    services = demo / "services.json"

    backup_demo.create_backup(demo, archive, services)
    manifest = backup_demo.verify_backup(archive)
    restored = backup_demo.restore_backup(archive, tmp_path / "restored")

    assert len(manifest["files"]) == 2
    assert manifest["format"] == 1
    assert manifest["source"] == {"database": "formflow.db", "storage": "storage"}
    assert manifest["created_at"].endswith("+00:00")
    restored_files = {path.relative_to(restored).as_posix() for path in restored.rglob("*")
                      if path.is_file()}
    assert restored_files == {item["path"] for item in manifest["files"]}
    assert (restored / "storage" / "files" / "private.bin").read_bytes() == b"private attachment"
    with closing(sqlite3.connect(restored / "formflow.db")) as db:
        with db:
            assert db.execute("SELECT value FROM sample").fetchone() == ("kept",)


def test_backup_refuses_registered_running_services(tmp_path):
    demo = _demo(tmp_path)
    services = demo / "services.json"
    services.write_text('{"api": 123}', encoding="utf-8")

    with pytest.raises(backup_demo.BackupError, match="先运行.*--stop"):
        backup_demo.create_backup(demo, tmp_path / "backup.zip", services)
    assert not (tmp_path / "backup.zip").exists()


def test_create_does_not_overwrite_existing_backup(tmp_path):
    demo = _demo(tmp_path)
    archive = tmp_path / "backup.zip"
    archive.write_bytes(b"existing backup")

    with pytest.raises(backup_demo.BackupError, match="已存在"):
        backup_demo.create_backup(demo, archive, demo / "services.json")
    assert archive.read_bytes() == b"existing backup"


def test_verify_detects_tampered_payload(tmp_path):
    demo = _demo(tmp_path)
    archive = tmp_path / "backup.zip"
    backup_demo.create_backup(demo, archive, demo / "services.json")
    with zipfile.ZipFile(archive) as source:
        files = {name: source.read(name) for name in source.namelist()}
    files["storage/files/private.bin"] = b"changed"
    with zipfile.ZipFile(archive, "w") as output:
        for name, payload in files.items():
            output.writestr(name, payload)

    with pytest.raises(backup_demo.BackupError, match="校验失败"):
        backup_demo.verify_backup(archive)


def test_verify_rejects_incomplete_manifest(tmp_path):
    archive = tmp_path / "incomplete.zip"
    manifest = {
        "format": 1,
        "created_at": "2026-10-26T00:00:00+00:00",
        "source": {"database": "formflow.db", "storage": "storage"},
        "files": [{"path": "formflow.db", "size": 1, "sha256": "0" * 63}],
    }
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", json.dumps(manifest))
        output.writestr("formflow.db", b"x")

    with pytest.raises(backup_demo.BackupError, match="无效文件校验值"):
        backup_demo.verify_backup(archive)


def test_verify_rejects_manifest_without_timezone(tmp_path):
    archive = tmp_path / "naive-time.zip"
    manifest = {
        "format": 1,
        "created_at": "2026-10-26T00:00:00",
        "source": {"database": "formflow.db", "storage": "storage"},
        "files": [],
    }
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", json.dumps(manifest))

    with pytest.raises(backup_demo.BackupError, match="必须包含时区"):
        backup_demo.verify_backup(archive)


def test_restore_failure_removes_temporary_directory(tmp_path):
    demo = _demo(tmp_path)
    archive = tmp_path / "backup.zip"
    backup_demo.create_backup(demo, archive, demo / "services.json")
    with zipfile.ZipFile(archive) as source:
        files = {name: source.read(name) for name in source.namelist()}
    files["storage/files/private.bin"] = b"changed"
    with zipfile.ZipFile(archive, "w") as output:
        for name, payload in files.items():
            output.writestr(name, payload)

    target = tmp_path / "failed-restore"
    with pytest.raises(backup_demo.BackupError, match="校验失败"):
        backup_demo.restore_backup(archive, target)

    assert not target.exists()
    assert list(tmp_path.glob(".formflow-restore-*")) == []


def test_verify_rejects_path_traversal_without_writing_outside(tmp_path):
    archive = tmp_path / "unsafe.zip"
    outside = tmp_path / "outside.txt"
    manifest = {"format": 1, "files": [{"path": "../outside.txt", "size": 1,
                                         "sha256": "0" * 64}]}
    with zipfile.ZipFile(archive, "w") as output:
        output.writestr("manifest.json", json.dumps(manifest))
        output.writestr("../outside.txt", b"x")

    with pytest.raises(backup_demo.BackupError, match="不安全路径"):
        backup_demo.verify_backup(archive)
    assert not outside.exists()


def test_restore_refuses_to_overwrite_existing_directory(tmp_path):
    demo = _demo(tmp_path)
    archive = tmp_path / "backup.zip"
    backup_demo.create_backup(demo, archive, demo / "services.json")
    target = tmp_path / "existing"
    target.mkdir()
    marker = target / "keep.txt"
    marker.write_text("keep", encoding="utf-8")

    with pytest.raises(backup_demo.BackupError, match="不存在的新目录"):
        backup_demo.restore_backup(archive, target)
    assert marker.read_text(encoding="utf-8") == "keep"
