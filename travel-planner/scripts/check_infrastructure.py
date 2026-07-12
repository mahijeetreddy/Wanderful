from __future__ import annotations

import sys

from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from redis import Redis
from sqlalchemy import create_engine, text

from config import settings


def check_database() -> tuple[bool, str]:
    engine = create_engine(settings.database_url, pool_pre_ping=True, future=True)
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
            current = MigrationContext.configure(connection).get_current_revision()
        expected = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        if current != expected:
            return False, f"database migration is {current or 'missing'}; expected {expected}"
        return True, f"database connected; migration {current}"
    finally:
        engine.dispose()


def check_redis() -> tuple[bool, str]:
    if not settings.redis_url:
        return False, "REDIS_URL is not configured"
    client = Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=5,
        socket_timeout=5,
    )
    try:
        client.ping()
        key = "wanderful:readiness-check"
        client.set(key, "ok", ex=30)
        if client.get(key) != "ok":
            return False, "Redis write/read verification failed"
        client.delete(key)
        return True, "Redis connected; write/read/delete verified"
    finally:
        client.close()


def main() -> int:
    checks = (("Neon/PostgreSQL", check_database), ("Upstash/Redis", check_redis))
    failed = False
    for label, check in checks:
        try:
            ok, detail = check()
        except Exception as exc:
            ok, detail = False, f"{type(exc).__name__}: {exc}"
        print(f"[{'PASS' if ok else 'FAIL'}] {label}: {detail}")
        failed = failed or not ok
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
