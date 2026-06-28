from __future__ import annotations

import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from werkzeug.security import check_password_hash, generate_password_hash


DB_PATH = Path(".crewai_runtime") / "wanderful.db"


def init_auth_store() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with _connect() as conn:
        conn.execute(
            """
            create table if not exists users (
                id integer primary key autoincrement,
                name text not null,
                email text not null unique,
                password_hash text not null,
                created_at text not null
            )
            """
        )
        conn.execute(
            """
            create table if not exists saved_trips (
                id integer primary key autoincrement,
                user_id integer not null,
                name text not null,
                destination text not null,
                date_range text not null,
                form_json text not null,
                itinerary text not null,
                options_json text not null,
                result_tab text not null,
                created_at text not null,
                updated_at text not null,
                foreign key (user_id) references users(id) on delete cascade
            )
            """
        )
        conn.execute(
            """
            create table if not exists user_preferences (
                user_id integer primary key,
                budget_style text,
                travel_style text,
                likes_json text not null default '[]',
                dislikes_json text not null default '[]',
                home_airport text,
                preferred_currency text,
                date_of_birth text,
                age integer,
                updated_at text not null,
                foreign key (user_id) references users(id) on delete cascade
            )
            """
        )
        _ensure_column(conn, "user_preferences", "date_of_birth", "text")
        _ensure_column(conn, "user_preferences", "age", "integer")


def create_user(name: str, email: str, password: str) -> dict[str, Any]:
    normalized_email = email.strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    try:
        with _connect() as conn:
            cursor = conn.execute(
                """
                insert into users (name, email, password_hash, created_at)
                values (?, ?, ?, ?)
                """,
                (name.strip(), normalized_email, generate_password_hash(password), now),
            )
            user_id = int(cursor.lastrowid)
    except sqlite3.IntegrityError as exc:
        raise ValueError("An account with this email already exists.") from exc
    return {"id": user_id, "name": name.strip(), "email": normalized_email}


def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "select id, name, email, password_hash from users where email = ?",
            (email.strip().lower(),),
        ).fetchone()
    if row is None or not check_password_hash(str(row["password_hash"]), password):
        return None
    return {"id": int(row["id"]), "name": row["name"], "email": row["email"]}


def change_user_password(user_id: int, current_password: str, new_password: str) -> None:
    with _connect() as conn:
        row = conn.execute(
            "select password_hash from users where id = ?",
            (user_id,),
        ).fetchone()
        if row is None or not check_password_hash(str(row["password_hash"]), current_password):
            raise ValueError("Current password is incorrect.")
        conn.execute(
            "update users set password_hash = ? where id = ?",
            (generate_password_hash(new_password), user_id),
        )


def get_user(user_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            "select id, name, email from users where id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return {"id": int(row["id"]), "name": row["name"], "email": row["email"]}


def list_saved_trips(user_id: int) -> list[dict[str, Any]]:
    with _connect() as conn:
        rows = conn.execute(
            """
            select id, name, destination, date_range, form_json, itinerary, options_json,
                   result_tab, created_at, updated_at
            from saved_trips
            where user_id = ?
            order by updated_at desc
            """,
            (user_id,),
        ).fetchall()
    return [_trip_from_row(row) for row in rows]


def create_saved_trip(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    with _connect() as conn:
        cursor = conn.execute(
            """
            insert into saved_trips (
                user_id, name, destination, date_range, form_json, itinerary,
                options_json, result_tab, created_at, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                str(payload["name"]),
                str(payload["destination"]),
                str(payload["dateRange"]),
                json.dumps(payload["form"]),
                str(payload["itinerary"]),
                json.dumps(payload.get("options") or {}),
                str(payload.get("resultTab") or "itinerary"),
                now,
                now,
            ),
        )
        trip_id = int(cursor.lastrowid)
    return get_saved_trip(user_id, trip_id) or {}


def delete_saved_trip(user_id: int, trip_id: int) -> bool:
    with _connect() as conn:
        cursor = conn.execute(
            "delete from saved_trips where id = ? and user_id = ?",
            (trip_id, user_id),
        )
    return cursor.rowcount > 0


def get_saved_trip(user_id: int, trip_id: int) -> dict[str, Any] | None:
    with _connect() as conn:
        row = conn.execute(
            """
            select id, name, destination, date_range, form_json, itinerary, options_json,
                   result_tab, created_at, updated_at
            from saved_trips
            where id = ? and user_id = ?
            """,
            (trip_id, user_id),
        ).fetchone()
    return _trip_from_row(row) if row else None


def get_user_preferences(user_id: int) -> dict[str, Any]:
    with _connect() as conn:
        row = conn.execute(
            """
            select budget_style, travel_style, likes_json, dislikes_json,
                   home_airport, preferred_currency, date_of_birth, age, updated_at
            from user_preferences
            where user_id = ?
            """,
            (user_id,),
        ).fetchone()
    if not row:
        return {
            "budget_style": "",
            "travel_style": "",
            "likes": [],
            "dislikes": [],
            "home_airport": "",
            "preferred_currency": "USD",
            "date_of_birth": "",
            "age": None,
            "updated_at": None,
        }
    return {
        "budget_style": row["budget_style"] or "",
        "travel_style": row["travel_style"] or "",
        "likes": _json_list(row["likes_json"]),
        "dislikes": _json_list(row["dislikes_json"]),
        "home_airport": row["home_airport"] or "",
        "preferred_currency": row["preferred_currency"] or "USD",
        "date_of_birth": row["date_of_birth"] or "",
        "age": row["age"],
        "updated_at": row["updated_at"],
    }


def upsert_user_preferences(user_id: int, preferences: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc).isoformat()
    likes = _coerce_string_list(preferences.get("likes"))
    dislikes = _coerce_string_list(preferences.get("dislikes"))
    values = (
        user_id,
        str(preferences.get("budget_style") or "").strip(),
        str(preferences.get("travel_style") or "").strip(),
        json.dumps(likes),
        json.dumps(dislikes),
        str(preferences.get("home_airport") or "").strip().upper(),
        str(preferences.get("preferred_currency") or "USD").strip().upper()[:3],
        _normalize_dob(preferences.get("date_of_birth")),
        _normalize_age(preferences.get("age")),
        now,
    )
    with _connect() as conn:
        conn.execute(
            """
            insert into user_preferences (
                user_id, budget_style, travel_style, likes_json, dislikes_json,
                home_airport, preferred_currency, date_of_birth, age, updated_at
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(user_id) do update set
                budget_style=excluded.budget_style,
                travel_style=excluded.travel_style,
                likes_json=excluded.likes_json,
                dislikes_json=excluded.dislikes_json,
                home_airport=excluded.home_airport,
                preferred_currency=excluded.preferred_currency,
                date_of_birth=excluded.date_of_birth,
                age=excluded.age,
                updated_at=excluded.updated_at
            """,
            values,
        )
    return get_user_preferences(user_id)


def _trip_from_row(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "destination": row["destination"],
        "dateRange": row["date_range"],
        "savedAt": row["updated_at"],
        "form": _json_object(row["form_json"]),
        "itinerary": row["itinerary"],
        "options": _json_object(row["options_json"]),
        "resultTab": row["result_tab"],
    }


def _json_object(value: str) -> dict[str, Any]:
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _json_list(value: str) -> list[str]:
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return _coerce_string_list(parsed)


def _coerce_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        raw_items = value.split(",")
    elif isinstance(value, list):
        raw_items = value
    else:
        raw_items = []
    return [str(item).strip() for item in raw_items if str(item).strip()][:20]


def _normalize_dob(value: Any) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    try:
        datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return ""
    return raw


def _normalize_age(value: Any) -> int | None:
    try:
        age = int(value)
    except (TypeError, ValueError):
        return None
    if age < 0 or age > 130:
        return None
    return age


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, column_type: str) -> None:
    columns = {row["name"] for row in conn.execute(f"pragma table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"alter table {table} add column {column} {column_type}")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn
