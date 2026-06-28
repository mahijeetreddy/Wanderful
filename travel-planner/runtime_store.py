from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


DB_PATH = Path(".crewai_runtime") / "wanderful.db"


def init_runtime_store() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            create table if not exists api_cache (
                cache_key text primary key,
                provider text not null,
                response_json text not null,
                expires_at text not null,
                created_at text not null
            )
            """
        )
        conn.execute(
            """
            create table if not exists plan_jobs (
                id text primary key,
                status text not null,
                progress text not null,
                form_json text not null,
                options_json text not null default '{}',
                itinerary text not null default '',
                error text not null default '',
                created_at text not null,
                updated_at text not null
            )
            """
        )


def get_cached_response(cache_key: str) -> Any | None:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        row = conn.execute(
            "select response_json from api_cache where cache_key = ? and expires_at > ?",
            (cache_key, now),
        ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["response_json"])
    except json.JSONDecodeError:
        return None


def set_cached_response(cache_key: str, provider: str, response: Any, ttl_seconds: int) -> None:
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(seconds=max(1, ttl_seconds))
    with _connect() as conn:
        conn.execute(
            """
            insert into api_cache (cache_key, provider, response_json, expires_at, created_at)
            values (?, ?, ?, ?, ?)
            on conflict(cache_key) do update set
                provider=excluded.provider,
                response_json=excluded.response_json,
                expires_at=excluded.expires_at,
                created_at=excluded.created_at
            """,
            (
                cache_key,
                provider,
                json.dumps(response),
                expires_at.isoformat(),
                now.isoformat(),
            ),
        )


def create_plan_job(job_id: str, form: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        conn.execute(
            """
            insert into plan_jobs (id, status, progress, form_json, created_at, updated_at)
            values (?, 'queued', 'Queued trip planning job.', ?, ?, ?)
            """,
            (job_id, json.dumps(form), now, now),
        )
    return get_plan_job(job_id) or {}


def update_plan_job(
    job_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    options: dict[str, Any] | None = None,
    itinerary: str | None = None,
    error: str | None = None,
) -> None:
    current = get_plan_job(job_id)
    if not current:
        return
    next_values = {
        "status": status or current["status"],
        "progress": progress or current["progress"],
        "options_json": json.dumps(options if options is not None else current.get("options", {})),
        "itinerary": itinerary if itinerary is not None else current.get("itinerary", ""),
        "error": error if error is not None else current.get("error", ""),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    with _connect() as conn:
        conn.execute(
            """
            update plan_jobs
            set status = ?, progress = ?, options_json = ?, itinerary = ?, error = ?, updated_at = ?
            where id = ?
            """,
            (
                next_values["status"],
                next_values["progress"],
                next_values["options_json"],
                next_values["itinerary"],
                next_values["error"],
                next_values["updated_at"],
                job_id,
            ),
        )


def get_plan_job(job_id: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            """
            select id, status, progress, form_json, options_json, itinerary, error, created_at, updated_at
            from plan_jobs
            where id = ?
            """,
            (job_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": row["id"],
        "status": row["status"],
        "progress": row["progress"],
        "form": _json_object(row["form_json"]),
        "options": _json_object(row["options_json"]),
        "itinerary": row["itinerary"],
        "error": row["error"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value or "{}")
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
