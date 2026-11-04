#!/usr/bin/env python
"""Create, verify, and restore isolated FormFlow demo data backups."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent.parent
DEMO_DIR = ROOT / "data" / "demo"
BACKUP_DIR = ROOT / "data" / "backups"
SERVICES_FILE = DEMO_DIR / "services.json"
DB_NAME = "formflow.db"
MANIFEST_NAME = "manifest.json"
MANIFEST_FORMAT = 1


class BackupError(ValueError):
    pass


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _check_database(path: Path) -> None:
    try:
        with closing(sqlite3.connect(f"file:{path.resolve().as_posix()}?mode=ro", uri=True)) as db:
            result = db.execute("PRAGMA quick_check(1)").fetchone()
    except sqlite3.Error as exc:
        raise BackupError(f"SQLite 数据库无法读取：{exc}") from exc
    if not result or result[0] != "ok":
        raise BackupError(f"SQLite 完整性检查失败：{result[0] if result else '无结果'}")


def _validate_manifest(manifest: object, names: set[str]) -> dict:
    if not isinstance(manifest, dict):
        raise BackupError("备份清单必须是对象")
    if manifest.get("format") != MANIFEST_FORMAT or not isinstance(manifest.get("files"), list):
        raise BackupError("备份清单格式不受支持")
    created_at = manifest.get("created_at")
    if not isinstance(created_at, str):
        raise BackupError("备份清单缺少创建时间")
    try:
        parsed_created_at = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise BackupError("备份清单创建时间无效") from exc
    if parsed_created_at.tzinfo is None or parsed_created_at.utcoffset() is None:
        raise BackupError("备份清单创建时间必须包含时区")
    source = manifest.get("source")
    if source != {"database": DB_NAME, "storage": "storage"}:
        raise BackupError("备份清单来源不受支持")

    expected: dict[str, dict] = {}
    for item in manifest["files"]:
        if not isinstance(item, dict):
            raise BackupError("备份清单包含无效文件项")
        name = item.get("path")
        size = item.get("size")
        digest = item.get("sha256")
        if not isinstance(name, str) or not isinstance(size, int) or size < 0:
            raise BackupError("备份清单包含无效文件大小")
        if (not isinstance(digest, str) or len(digest) != 64 or
                any(char not in "0123456789abcdef" for char in digest)):
            raise BackupError(f"备份清单包含无效文件校验值：{name}")
        if name in expected:
            raise BackupError(f"备份清单包含重复路径：{name}")
        expected[name] = item
    if set(names) != set(expected) | {MANIFEST_NAME}:
        raise BackupError("备份内容与文件清单不一致")
    return manifest


def _require_stopped(services_file: Path) -> None:
    if services_file.exists():
        raise BackupError(f"演示服务仍有启动器登记；先运行 python scripts/start_demo.py --stop：{services_file}")


def create_backup(demo_dir: Path, destination: Path, services_file: Path) -> Path:
    _require_stopped(services_file)
    db_path = demo_dir / DB_NAME
    storage_dir = demo_dir / "storage"
    if not db_path.is_file() or not storage_dir.is_dir():
        raise BackupError("演示数据库或附件目录不存在，无法备份")
    _check_database(db_path)
    if any(path.is_symlink() for path in [*storage_dir.rglob("*"), storage_dir]):
        raise BackupError("附件目录包含符号链接，拒绝打包")

    destination = destination.resolve()
    if destination == demo_dir.resolve() or demo_dir.resolve() in destination.parents:
        raise BackupError("备份文件不能写入演示数据目录")
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        raise BackupError(f"备份文件已存在：{destination}")

    with tempfile.TemporaryDirectory(prefix="formflow-backup-") as temp_name:
        temp_dir = Path(temp_name)
        staged_db = temp_dir / DB_NAME
        try:
            with closing(sqlite3.connect(db_path)) as source, closing(sqlite3.connect(staged_db)) as target:
                source.backup(target)
        except sqlite3.Error as exc:
            raise BackupError(f"SQLite 在线备份失败：{exc}") from exc
        _check_database(staged_db)

        files = [{"path": DB_NAME, "size": staged_db.stat().st_size, "sha256": _sha256(staged_db)}]
        storage_files = sorted(path for path in storage_dir.rglob("*") if path.is_file())
        for path in storage_files:
            files.append({"path": (Path("storage") / path.relative_to(storage_dir)).as_posix(),
                          "size": path.stat().st_size, "sha256": _sha256(path)})
        manifest = {
            "format": MANIFEST_FORMAT,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "source": {"database": DB_NAME, "storage": "storage"},
            "files": files,
        }
        staged_archive = temp_dir / "backup.zip"
        with zipfile.ZipFile(staged_archive, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.write(staged_db, DB_NAME)
            for path in storage_files:
                archive.write(path, (Path("storage") / path.relative_to(storage_dir)).as_posix())
            archive.writestr(MANIFEST_NAME, json.dumps(manifest, ensure_ascii=False, indent=2))
        try:
            with staged_archive.open("rb") as source, destination.open("xb") as output:
                shutil.copyfileobj(source, output)
        except OSError:
            destination.unlink(missing_ok=True)
            raise
    return destination


def _safe_archive_path(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if path.is_absolute() or not path.parts or any(part in {"", ".", ".."} for part in path.parts):
        raise BackupError(f"备份包含不安全路径：{name}")
    if "\\" in name or ":" in path.parts[0]:
        raise BackupError(f"备份包含不安全路径：{name}")
    return path


def _extract_verified(archive_path: Path, destination: Path) -> dict:
    try:
        with zipfile.ZipFile(archive_path) as archive:
            names = [info.filename for info in archive.infolist()]
            if len(names) != len(set(names)) or MANIFEST_NAME not in names:
                raise BackupError("备份文件缺少清单或包含重复路径")
            for name in names:
                _safe_archive_path(name)
            manifest = _validate_manifest(json.loads(archive.read(MANIFEST_NAME)), set(names))
            expected = {item["path"]: item for item in manifest["files"]}
            for name, item in expected.items():
                relative = _safe_archive_path(name)
                if name != DB_NAME and relative.parts[0] != "storage":
                    raise BackupError(f"备份包含清单外文件：{name}")
                target = destination.joinpath(*relative.parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(name) as source, target.open("wb") as output:
                    shutil.copyfileobj(source, output)
                if target.stat().st_size != item.get("size") or _sha256(target) != item.get("sha256"):
                    raise BackupError(f"备份文件校验失败：{name}")
            if DB_NAME not in expected:
                raise BackupError("备份中没有 SQLite 数据库")
            database_path = destination / DB_NAME
            _check_database(database_path)
            # A read-only integrity check can create empty WAL sidecars for a
            # database whose header enables WAL mode. They are not backup data.
            wal_path = Path(f"{database_path}-wal")
            shm_path = Path(f"{database_path}-shm")
            if not wal_path.exists() or wal_path.stat().st_size == 0:
                wal_path.unlink(missing_ok=True)
                shm_path.unlink(missing_ok=True)
            return manifest
    except (OSError, zipfile.BadZipFile, json.JSONDecodeError, KeyError, TypeError) as exc:
        if isinstance(exc, BackupError):
            raise
        raise BackupError(f"无法读取备份：{exc}") from exc


def verify_backup(archive_path: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="formflow-verify-") as temp_name:
        return _extract_verified(archive_path, Path(temp_name))


def restore_backup(archive_path: Path, target: Path) -> Path:
    target = target.resolve()
    if target.exists() or target.is_symlink():
        raise BackupError(f"恢复目标必须是不存在的新目录：{target}")
    target.parent.mkdir(parents=True, exist_ok=True)
    temp_path = Path(tempfile.mkdtemp(prefix=".formflow-restore-", dir=target.parent))
    try:
        _extract_verified(archive_path, temp_path)
        os.replace(temp_path, target)
    except BaseException:
        shutil.rmtree(temp_path, ignore_errors=True)
        raise
    return target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="演示数据库与附件备份、校验和恢复")
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create", help="备份已停止的本地演示环境")
    create.add_argument("--output", type=Path)
    verify = subparsers.add_parser("verify", help="校验备份并在临时目录实际恢复检查")
    verify.add_argument("archive", type=Path)
    restore = subparsers.add_parser("restore", help="恢复到一个新的目标目录，不覆盖现有数据")
    restore.add_argument("archive", type=Path)
    restore.add_argument("--target", required=True, type=Path)
    args = parser.parse_args(argv)

    try:
        if args.command == "create":
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
            output = args.output or BACKUP_DIR / f"formflow-demo-{stamp}.zip"
            result = create_backup(DEMO_DIR, output, SERVICES_FILE)
            print(f"备份已创建：{result}")
        elif args.command == "verify":
            manifest = verify_backup(args.archive)
            print(f"备份校验通过：{len(manifest['files'])} 个文件；SQLite 完整性正常")
        else:
            result = restore_backup(args.archive, args.target)
            print(f"已恢复到新目录：{result}")
    except BackupError as exc:
        print(f"备份操作失败：{exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
