from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from config import settings
from database import Base, engine, ensure_local_column, session_scope
from models import PasswordResetToken, SavedTrip, User, UserPreference


def init_auth_store() -> None:
    # Alembic owns production migrations. create_all keeps local SQLite setup frictionless.
    if not settings.production:
        Base.metadata.create_all(engine)
        ensure_local_column("users", "status", "varchar(20) not null default 'active'")
        ensure_local_column("users", "role", "varchar(20) not null default 'user'")
        ensure_local_column("users", "approved_at", "datetime")
        ensure_local_column("users", "approved_by", "integer")
        ensure_local_column("users", "updated_at", "datetime")
        ensure_local_column("saved_trips", "structured_json", "text not null default '{}'")
    if settings.admin_emails:
        with session_scope() as db:
            users = db.scalars(select(User).where(User.email.in_(settings.admin_emails))).all()
            for user in users:
                user.role = "admin"
                user.status = "active"
                user.approved_at = user.approved_at or datetime.now(timezone.utc)


def create_user(name: str, email: str, password: str) -> dict[str, Any]:
    normalized_email = email.strip().lower()
    admin = normalized_email in settings.admin_emails
    user = User(
        name=name.strip(),
        email=normalized_email,
        password_hash=generate_password_hash(password),
        status="active" if admin else "pending",
        role="admin" if admin else "user",
        approved_at=datetime.now(timezone.utc) if admin else None,
    )
    try:
        with session_scope() as db:
            db.add(user)
            db.flush()
            user_id = user.id
    except IntegrityError as exc:
        raise ValueError("An account with this email already exists.") from exc
    return get_user(user_id) or {}


def authenticate_user(email: str, password: str) -> dict[str, Any] | None:
    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if user is None or not check_password_hash(user.password_hash, password):
            return None
        return _user_dict(user)


def change_user_password(user_id: int, current_password: str, new_password: str) -> None:
    with session_scope() as db:
        user = db.get(User, user_id)
        if user is None or not check_password_hash(user.password_hash, current_password):
            raise ValueError("Current password is incorrect.")
        user.password_hash = generate_password_hash(new_password)


def get_user(user_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        user = db.get(User, user_id)
        return _user_dict(user) if user else None


def delete_user_account(user_id: int) -> bool:
    with session_scope() as db:
        user = db.get(User, user_id)
        if not user:
            return False
        db.delete(user)
        return True


def list_pending_users() -> list[dict[str, Any]]:
    with session_scope() as db:
        users = db.scalars(
            select(User).where(User.status == "pending").order_by(User.created_at.asc())
        ).all()
        return [_user_dict(user) for user in users]


def set_user_status(admin_id: int, user_id: int, status: str) -> dict[str, Any]:
    if status not in {"active", "rejected"}:
        raise ValueError("Unsupported account status.")
    with session_scope() as db:
        admin = db.get(User, admin_id)
        user = db.get(User, user_id)
        if not admin or admin.role != "admin":
            raise PermissionError("Admin access required.")
        if not user:
            raise ValueError("User not found.")
        user.status = status
        user.approved_by = admin_id
        user.approved_at = datetime.now(timezone.utc) if status == "active" else None
        db.flush()
        return _user_dict(user)


def list_saved_trips(user_id: int) -> list[dict[str, Any]]:
    with session_scope() as db:
        trips = db.scalars(
            select(SavedTrip)
            .where(SavedTrip.user_id == user_id)
            .order_by(SavedTrip.updated_at.desc())
        ).all()
        return [_trip_dict(trip) for trip in trips]


def create_saved_trip(user_id: int, payload: dict[str, Any]) -> dict[str, Any]:
    trip = SavedTrip(
        user_id=user_id,
        name=str(payload["name"])[:200],
        destination=str(payload["destination"])[:200],
        date_range=str(payload["dateRange"])[:100],
        form_json=_dict(payload.get("form")),
        itinerary=str(payload["itinerary"]),
        options_json=_dict(payload.get("options")),
        structured_json=_dict(payload.get("structuredItinerary")),
        result_tab=str(payload.get("resultTab") or "itinerary")[:30],
    )
    with session_scope() as db:
        db.add(trip)
        db.flush()
        trip_id = trip.id
    return get_saved_trip(user_id, trip_id) or {}


def delete_saved_trip(user_id: int, trip_id: int) -> bool:
    with session_scope() as db:
        trip = db.scalar(
            select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id)
        )
        if not trip:
            return False
        db.delete(trip)
        return True


def get_saved_trip(user_id: int, trip_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(
            select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id)
        )
        return _trip_dict(trip) if trip else None


def get_user_preferences(user_id: int) -> dict[str, Any]:
    with session_scope() as db:
        preference = db.get(UserPreference, user_id)
        if not preference:
            return _empty_preferences()
        return {
            "budget_style": preference.budget_style or "",
            "travel_style": preference.travel_style or "",
            "likes": preference.likes_json or [],
            "dislikes": preference.dislikes_json or [],
            "home_airport": preference.home_airport or "",
            "preferred_currency": preference.preferred_currency or "USD",
            "date_of_birth": preference.date_of_birth or "",
            "age": preference.age,
            "updated_at": preference.updated_at.isoformat() if preference.updated_at else None,
        }


def upsert_user_preferences(user_id: int, preferences: dict[str, Any]) -> dict[str, Any]:
    with session_scope() as db:
        value = db.get(UserPreference, user_id)
        if not value:
            value = UserPreference(user_id=user_id)
            db.add(value)
        value.budget_style = str(preferences.get("budget_style") or "").strip()[:80]
        value.travel_style = str(preferences.get("travel_style") or "").strip()[:120]
        value.likes_json = _coerce_string_list(preferences.get("likes"))
        value.dislikes_json = _coerce_string_list(preferences.get("dislikes"))
        value.home_airport = str(preferences.get("home_airport") or "").strip().upper()[:16]
        value.preferred_currency = str(preferences.get("preferred_currency") or "USD").upper()[:3]
        value.date_of_birth = _normalize_dob(preferences.get("date_of_birth"))
        value.age = _normalize_age(preferences.get("age"))
    return get_user_preferences(user_id)


def create_password_reset(email: str, ttl_minutes: int = 30) -> str | None:
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == email.strip().lower()))
        if not user:
            return None
        db.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=token_hash,
                expires_at=datetime.now(timezone.utc) + timedelta(minutes=ttl_minutes),
            )
        )
    return raw_token


def consume_password_reset(raw_token: str, new_password: str) -> bool:
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    now = datetime.now(timezone.utc)
    with session_scope() as db:
        token = db.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == token_hash,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        if not token:
            return False
        user = db.get(User, token.user_id)
        if not user:
            return False
        user.password_hash = generate_password_hash(new_password)
        token.used_at = now
        return True


def _user_dict(user: User) -> dict[str, Any]:
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "status": user.status,
        "role": user.role,
        "approved_at": user.approved_at.isoformat() if user.approved_at else None,
        "created_at": user.created_at.isoformat() if user.created_at else None,
    }


def _trip_dict(trip: SavedTrip) -> dict[str, Any]:
    return {
        "id": str(trip.id),
        "name": trip.name,
        "destination": trip.destination,
        "dateRange": trip.date_range,
        "savedAt": trip.updated_at.isoformat(),
        "form": trip.form_json or {},
        "itinerary": trip.itinerary,
        "options": trip.options_json or {},
        "structuredItinerary": trip.structured_json or {},
        "resultTab": trip.result_tab,
    }


def _empty_preferences() -> dict[str, Any]:
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


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _coerce_string_list(value: Any) -> list[str]:
    values = value.split(",") if isinstance(value, str) else value if isinstance(value, list) else []
    return [str(item).strip() for item in values if str(item).strip()][:20]


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
    return age if 0 <= age <= 130 else None
