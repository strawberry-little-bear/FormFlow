import warnings

from sqlalchemy import create_engine, inspect

from app.db import Base
from app import models  # noqa: F401 - register application tables


def test_sqlite_schema_keeps_cyclic_foreign_keys_without_drop_warning():
    engine = create_engine("sqlite://")
    try:
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            Base.metadata.create_all(engine)
            foreign_keys = {
                table: {fk["constrained_columns"][0]: fk["referred_table"]
                        for fk in inspect(engine).get_foreign_keys(table)}
                for table in ("tasks", "submissions")
            }
            Base.metadata.drop_all(engine)

        assert foreign_keys["tasks"]["current_blueprint_id"] == "blueprint_versions"
        assert foreign_keys["submissions"]["current_revision_id"] == "revisions"
        assert not [warning for warning in caught if "Can't sort tables for DROP" in str(warning.message)]
    finally:
        engine.dispose()