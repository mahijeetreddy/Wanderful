"""Verify additive upgrades on an EMPTY, local, disposable PostgreSQL database.

Example: python scripts/verify_postgres_migrations.py --database-url
postgresql+psycopg://postgres@127.0.0.1:55439/wanderful_migration
Does not delete databases, rows, or files, and refuses remote/nonempty targets.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import MetaData, Table, create_engine, inspect, select, text
from sqlalchemy.engine import make_url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database-url", required=True)
    args = parser.parse_args()
    url = make_url(args.database_url)
    if url.get_backend_name() != "postgresql" or url.host not in {"127.0.0.1", "localhost", "::1"} or not (url.database or "").startswith("wanderful_migration"):
        raise SystemExit("Refusing target: use a local disposable wanderful_migration database.")
    engine = create_engine(url)
    if inspect(engine).get_table_names():
        raise SystemExit("Refusing nonempty database. Create a new disposable database instead.")
    environment = {**os.environ, "APP_ENV": "test", "DATABASE_URL": args.database_url, "MIGRATION_DATABASE_URL": args.database_url}
    root = Path(__file__).resolve().parents[1]

    def alembic(*command):
        result = subprocess.run([sys.executable, "-m", "alembic", *command], cwd=root, env=environment, capture_output=True, text=True, timeout=90)
        if result.returncode:
            raise RuntimeError(result.stdout + result.stderr)

    alembic("upgrade", "20260920_05")
    tables = MetaData()
    users = Table("users", tables, autoload_with=engine)
    trips = Table("saved_trips", tables, autoload_with=engine)
    timestamp = datetime.now(timezone.utc)
    expenses = {"expenses": [{"id": "legacy-expense", "amount": 19.95, "paid_by": "Owner", "split_count": 2}]}
    historical = {"flights": [{"id": "flight-1", "total_price": 500}], "hotels": [{"id": "hotel-1", "estimated_total": 420}]}
    with engine.begin() as connection:
        user_id = connection.execute(users.insert().values(name="Fixture owner", email="migration@example.test", password_hash="not-a-real-password", status="active", role="user", created_at=timestamp, updated_at=timestamp).returning(users.c.id)).scalar_one()
        trip_id = connection.execute(trips.insert().values(user_id=user_id, name="Historical trip", destination="Lisbon", date_range="May", form_json={"currency_code": "USD"}, itinerary="Original itinerary", options_json=historical, structured_json={}, result_tab="flights", constraints_json={}, live_state_json={}, budget_state_json=expenses, disruption_history_json=[], created_at=timestamp, updated_at=timestamp).returning(trips.c.id)).scalar_one()
    alembic("upgrade", "head")
    alembic("check")
    with engine.connect() as connection:
        row = connection.execute(select(trips).where(trips.c.id == trip_id)).mappings().one()
        assert row["itinerary"] == "Original itinerary"
        assert row["options_json"] == historical
        assert row["budget_state_json"] == expenses
        assert connection.execute(text("select revision from saved_trips where id = :trip_id"), {"trip_id": trip_id}).scalar_one() == 1
    assert {"search_sessions", "offer_snapshots", "trip_selections"} <= set(inspect(engine).get_table_names())
    engine.dispose()
    print(json.dumps({"result": "passed", "database": "local disposable PostgreSQL", "checks": ["legacy schema creation", "additive upgrade", "schema drift", "saved trip preservation", "legacy expenses preservation", "positional IDs not reinterpreted", "revision backfill"]}))


if __name__ == "__main__":
    main()
