from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from config import settings


class Base(DeclarativeBase):
    pass


engine_kwargs = {"pool_pre_ping": True, "future": True}
if settings.database_url.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False, autoflush=False)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def ensure_local_column(table: str, column: str, definition: str) -> None:
    if not settings.database_url.startswith("sqlite"):
        return
    inspector = inspect(engine)
    if table not in inspector.get_table_names():
        return
    columns = {value["name"] for value in inspector.get_columns(table)}
    if column in columns:
        return
    with engine.begin() as connection:
        connection.execute(text(f"alter table {table} add column {column} {definition}"))
