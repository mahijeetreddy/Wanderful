from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

from database import Base


EXPECTED_TABLES = {
    "alembic_version",
    "evaluation_results",
    "guidebooks",
    "journal_entries",
    "password_reset_tokens",
    "plan_jobs",
    "saved_trips",
    "trip_shares",
    "travel_documents",
    "user_preferences",
    "users",
}


def _run_alembic(database_path: Path, *arguments: str) -> subprocess.CompletedProcess[str]:
    database_url = f"sqlite:///{database_path.as_posix()}"
    environment = os.environ.copy()
    environment.update(
        {
            "APP_ENV": "test",
            "DATABASE_URL": database_url,
            "MIGRATION_DATABASE_URL": database_url,
        }
    )

    return subprocess.run(
        [sys.executable, "-m", "alembic", *arguments],
        cwd=Path(__file__).resolve().parents[1],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_alembic_builds_fresh_schema(tmp_path: Path):
    database_path = tmp_path / "migration-test.db"
    database_url = f"sqlite:///{database_path.as_posix()}"

    result = _run_alembic(database_path, "upgrade", "head")

    assert result.returncode == 0, result.stderr
    schema_check = _run_alembic(database_path, "check")
    assert schema_check.returncode == 0, schema_check.stdout + schema_check.stderr
    engine = create_engine(database_url)
    try:
        inspector = inspect(engine)
        assert set(inspector.get_table_names()) == EXPECTED_TABLES
        with engine.connect() as connection:
            revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "20260920_05"
    finally:
        engine.dispose()


def test_alembic_adopts_tables_created_by_legacy_development_startup(tmp_path: Path):
    database_path = tmp_path / "legacy-schema.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    engine = create_engine(database_url)
    try:
        Base.metadata.create_all(engine)
        with engine.begin() as connection:
            connection.exec_driver_sql("create table alembic_version (version_num varchar(32) not null)")
            connection.exec_driver_sql("insert into alembic_version values ('20260628_01')")
    finally:
        engine.dispose()

    result = _run_alembic(database_path, "upgrade", "head")

    assert result.returncode == 0, result.stderr
    engine = create_engine(database_url)
    try:
        with engine.connect() as connection:
            revision = connection.exec_driver_sql("select version_num from alembic_version").scalar_one()
        assert revision == "20260920_05"
    finally:
        engine.dispose()
