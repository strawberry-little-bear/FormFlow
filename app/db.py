"""数据库引擎与会话管理（SQLAlchemy 2.x）。"""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = settings.database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    eng = create_engine(url, connect_args=connect_args, future=True)
    if url.startswith("sqlite"):
        # 多进程并发（API 与 Worker 同时读写）：WAL 让读者不阻塞写者；
        # busy_timeout 让偶发写冲突等待而非立刻抛 database is locked。
        @event.listens_for(eng, "connect")
        def _sqlite_concurrency(dbapi_conn, _):
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA journal_mode=WAL")
            cur.execute("PRAGMA busy_timeout=30000")
            cur.execute("PRAGMA synchronous=NORMAL")
            cur.close()
    return eng


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI 依赖：请求级会话。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """建表 + 轻量迁移（SQLite 缺列时补齐，不引入 Alembic）。"""
    from . import models  # noqa: F401  确保模型已注册

    if settings.database_url.startswith("sqlite"):
        db_path = settings.database_url.split("///", 1)[1]
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)
    if settings.database_url.startswith("sqlite"):
        _add_missing_columns()
        _link_legacy_exemptions()


# 已有本地库升级用：新列 → (表, 列, 定义)。SQLite 不支持 ADD COLUMN IF NOT EXISTS，
# 先查 PRAGMA table_info 再补，重复执行安全。
_SQLITE_COLUMNS = {
    "submissions": [("draft_fields_json", "TEXT DEFAULT '{}'")],
    "exemptions": [("decision_id", "INTEGER REFERENCES manual_decisions(id)")],
    "manual_decisions": [("eligibility", "VARCHAR(16)"), ("eligibility_members_hash", "VARCHAR(64)"),
                         ("revokes_decision_id", "INTEGER REFERENCES manual_decisions(id)")],
    "check_runs": [("execution_mode", "VARCHAR(24) DEFAULT 'live'")],
}


def _add_missing_columns() -> None:
    from sqlalchemy import text

    with engine.begin() as conn:
        for table, columns in _SQLITE_COLUMNS.items():
            existing = {row[1] for row in conn.execute(
                text(f"PRAGMA table_info({table})")).fetchall()}
            if not existing:
                continue
            for name, ddl in columns:
                if name not in existing:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))


def _link_legacy_exemptions() -> None:
    """Link only unambiguous legacy pairs; never attach standalone exceptions by name."""
    from sqlalchemy import select
    from .models import Exemption, ManualDecision
    from .timeutils import as_utc

    with Session(engine) as db:
        exemptions = db.scalars(select(Exemption).where(
            Exemption.kind == "exempt", Exemption.decision_id.is_(None))).all()
        decisions = db.scalars(select(ManualDecision).where(
            ManualDecision.decision == "exempt")).all()
        linked = set(db.scalars(select(Exemption.decision_id).where(
            Exemption.decision_id.is_not(None))))
        candidates = {}
        for e in exemptions:
            candidates[e.id] = [d for d in decisions if d.id not in linked
                and (e.task_id, e.subject_id, e.reason.strip(), e.decided_by) ==
                    (d.task_id, d.subject_id, d.reason.strip(), d.operator_id)
                and e.decided_at and d.created_at
                and abs((as_utc(e.decided_at) - as_utc(d.created_at)).total_seconds()) < 2]
        for e in exemptions:
            matches = candidates[e.id]
            if len(matches) == 1 and sum(
                    any(d.id == matches[0].id for d in rows)
                    for rows in candidates.values()) == 1:
                e.decision_id = matches[0].id
        db.commit()
