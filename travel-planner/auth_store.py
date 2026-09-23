from __future__ import annotations

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from config import settings
from database import Base, engine, ensure_local_column, session_scope
from models import JournalEntry, PasswordResetToken, SavedTrip, TravelDocument, TripShare, TripSelection, User, UserPreference
from trip_intelligence import VALID_CONSTRAINTS, update_memory


def init_auth_store() -> None:
    # Alembic owns every PostgreSQL schema, including shared development databases.
    # create_all is intentionally limited to disposable/local SQLite databases.
    if settings.database_url.startswith("sqlite"):
        Base.metadata.create_all(engine)
        ensure_local_column("users", "status", "varchar(20) not null default 'active'")
        ensure_local_column("users", "role", "varchar(20) not null default 'user'")
        ensure_local_column("users", "approved_at", "datetime")
        ensure_local_column("users", "approved_by", "integer")
        ensure_local_column("users", "updated_at", "datetime")
        ensure_local_column("saved_trips", "structured_json", "text not null default '{}'")
        ensure_local_column("saved_trips", "revision", "integer not null default 1")
        ensure_local_column("saved_trips", "constraints_json", "text not null default '{}'")
        ensure_local_column("saved_trips", "live_state_json", "text not null default '{}'")
        ensure_local_column("saved_trips", "budget_state_json", "text not null default '{}'")
        ensure_local_column("saved_trips", "disruption_history_json", "text not null default '[]'")
        ensure_local_column("user_preferences", "memory_json", "text not null default '{}'")
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
        db.execute(update(User).where(User.approved_by == user_id).values(approved_by=None))
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
        shares = db.scalars(select(TripShare).where(TripShare.user_id == user_id)).all()
        tokens_by_trip = {share.saved_trip_id: share.token for share in shares}
        return [{**_trip_dict(trip, share_token=tokens_by_trip.get(trip.id)), "selections": _selection_dicts(db, trip.id)} for trip in trips]


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
        constraints_json=_dict(payload.get("constraints")),
        live_state_json=_dict(payload.get("liveState")),
        budget_state_json=_dict(payload.get("budgetState")),
        disruption_history_json=payload.get("disruptionHistory") if isinstance(payload.get("disruptionHistory"), list) else [],
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
        if not trip:
            return None
        share = db.scalar(select(TripShare).where(TripShare.saved_trip_id == trip_id))
        return {**_trip_dict(trip, share_token=share.token if share else None), "selections": _selection_dicts(db, trip.id)}


def update_trip_constraints(user_id: int, trip_id: int, constraints: dict[str, Any], expected_revision=None) -> dict[str, Any] | None:
    normalized = {
        str(key)[:120]: str(value)
        for key, value in constraints.items()
        if str(value) in VALID_CONSTRAINTS
    }
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        if expected_revision is not None:
            from trip_mutations import check_revision
            check_revision(trip, expected_revision)
        trip.constraints_json = normalized
    return get_saved_trip(user_id, trip_id)


def apply_trip_adjustment(user_id: int, trip_id: int, structured_itinerary: dict[str, Any], live_state: dict[str, Any], expected_revision=None) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        if expected_revision is not None:
            from trip_mutations import check_revision
            check_revision(trip, expected_revision)
        from models import TripHistory
        db.add(TripHistory(trip_id=trip.id, revision=trip.revision, payload={**_trip_dict(trip), "selections": _selection_dicts(db, trip.id)}))
        trip.structured_json = structured_itinerary
        trip.live_state_json = live_state
    return get_saved_trip(user_id, trip_id)


def update_trip_budget(user_id: int, trip_id: int, budget_state: dict[str, Any], expected_revision=None) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        if expected_revision is not None:
            from trip_mutations import check_revision
            check_revision(trip, expected_revision)
        from models import TripRecord
        if db.get(TripRecord, (trip_id, "legacy-import")):
            raise ValueError("This trip uses individual ledger records. Refresh the app to edit expenses safely.")
        trip.budget_state_json = budget_state
    return get_saved_trip(user_id, trip_id)


def list_travel_documents(user_id: int, trip_id: int) -> list[dict[str, Any]]:
    with session_scope() as db:
        documents = db.scalars(
            select(TravelDocument)
            .where(TravelDocument.user_id == user_id, TravelDocument.saved_trip_id == trip_id)
            .order_by(TravelDocument.created_at.desc())
        ).all()
        return [_travel_document_dict(document) for document in documents]


def create_travel_document(user_id: int, trip_id: int, metadata: dict[str, Any]) -> dict[str, Any]:
    document = TravelDocument(
        id=uuid.uuid4().hex,
        user_id=user_id,
        saved_trip_id=trip_id,
        name=str(metadata["name"])[:240],
        category=str(metadata.get("category") or "Other")[:40],
        mime_type=str(metadata["mime_type"])[:100],
        size_bytes=int(metadata["size_bytes"]),
        storage_name=str(metadata["storage_name"])[:160],
        expires_on=str(metadata.get("expires_on") or "")[:10],
    )
    with session_scope() as db:
        db.add(document)
        db.flush()
        document_id = document.id
    return get_travel_document(user_id, trip_id, document_id) or {}


def get_travel_document(user_id: int, trip_id: int, document_id: str) -> dict[str, Any] | None:
    with session_scope() as db:
        document = db.scalar(select(TravelDocument).where(
            TravelDocument.id == document_id,
            TravelDocument.user_id == user_id,
            TravelDocument.saved_trip_id == trip_id,
        ))
        return _travel_document_dict(document) if document else None


def delete_travel_document(user_id: int, trip_id: int, document_id: str) -> dict[str, Any] | None:
    with session_scope() as db:
        document = db.scalar(select(TravelDocument).where(
            TravelDocument.id == document_id,
            TravelDocument.user_id == user_id,
            TravelDocument.saved_trip_id == trip_id,
        ))
        if not document:
            return None
        value = _travel_document_dict(document)
        db.delete(document)
        return value


def apply_disruption_scenario(
    user_id: int,
    trip_id: int,
    structured_itinerary: dict[str, Any],
    live_state: dict[str, Any],
    history_entry: dict[str, Any],
    expected_revision=None,
) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        if expected_revision is not None:
            from trip_mutations import check_revision
            check_revision(trip, expected_revision)
        from models import TripHistory
        db.add(TripHistory(trip_id=trip.id, revision=trip.revision, payload={**_trip_dict(trip), "selections": _selection_dicts(db, trip.id)}))
        trip.structured_json = structured_itinerary
        trip.live_state_json = live_state
        history = list(trip.disruption_history_json or [])
        history.insert(0, history_entry)
        trip.disruption_history_json = history[:30]
    return get_saved_trip(user_id, trip_id)


def record_activity_feedback(user_id: int, feedback: dict[str, Any]) -> dict[str, Any]:
    with session_scope() as db:
        preference = db.get(UserPreference, user_id)
        if not preference:
            preference = UserPreference(user_id=user_id)
            db.add(preference)
        preference.memory_json = update_memory(preference.memory_json or {}, feedback)
    return get_user_preferences(user_id)


def enable_trip_sharing(user_id: int, trip_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        share = db.scalar(select(TripShare).where(TripShare.saved_trip_id == trip_id))
        if not share:
            share = TripShare(saved_trip_id=trip_id, user_id=user_id, token=secrets.token_urlsafe(24))
            db.add(share)
            db.flush()
        return {"shareToken": share.token}


def disable_trip_sharing(user_id: int, trip_id: int) -> bool:
    with session_scope() as db:
        share = db.scalar(
            select(TripShare).where(TripShare.saved_trip_id == trip_id, TripShare.user_id == user_id)
        )
        if not share:
            return False
        db.delete(share)
        return True


def get_public_trip_by_share_token(token: str) -> dict[str, Any] | None:
    with session_scope() as db:
        share = db.scalar(select(TripShare).where(TripShare.token == token))
        if not share:
            return None
        trip = db.get(SavedTrip, share.saved_trip_id)
        if not trip:
            return None
        return {
            "name": trip.name,
            "destination": trip.destination,
            "dateRange": trip.date_range,
            "form": trip.form_json or {},
            "itinerary": trip.itinerary,
            "structuredItinerary": trip.structured_json or {},
        }


def list_journal_entries(user_id: int, trip_id: int) -> list[dict[str, Any]] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        entries = db.scalars(
            select(JournalEntry)
            .where(JournalEntry.saved_trip_id == trip_id)
            .order_by(JournalEntry.created_at.desc())
        ).all()
        return [_journal_entry_dict(entry) for entry in entries]


def create_journal_entry(user_id: int, trip_id: int, body: str) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        entry = JournalEntry(saved_trip_id=trip_id, user_id=user_id, body=body)
        db.add(entry)
        db.flush()
        return _journal_entry_dict(entry)


def update_journal_entry(user_id: int, trip_id: int, entry_id: int, body: str) -> dict[str, Any] | None:
    with session_scope() as db:
        entry = db.scalar(
            select(JournalEntry).where(
                JournalEntry.id == entry_id,
                JournalEntry.saved_trip_id == trip_id,
                JournalEntry.user_id == user_id,
            )
        )
        if not entry:
            return None
        entry.body = body
        db.flush()
        return _journal_entry_dict(entry)


def delete_journal_entry(user_id: int, trip_id: int, entry_id: int) -> bool:
    with session_scope() as db:
        entry = db.scalar(
            select(JournalEntry).where(
                JournalEntry.id == entry_id,
                JournalEntry.saved_trip_id == trip_id,
                JournalEntry.user_id == user_id,
            )
        )
        if not entry:
            return False
        db.delete(entry)
        return True


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
            "memory": preference.memory_json or {},
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
        if isinstance(preferences.get("memory"), dict):
            value.memory_json = preferences["memory"]
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


def _selection_dicts(db, trip_id: int) -> list[dict[str, Any]]:
    return [{"kind": row.kind, "snapshot_id": row.snapshot_id, "status": row.status,
             "booking_reference": row.booking_reference or "", "confirmation_source": "user_recorded"}
            for row in db.scalars(select(TripSelection).where(TripSelection.trip_id == trip_id))]


def _trip_dict(trip: SavedTrip, *, share_token: str | None = None) -> dict[str, Any]:
    return {
        "id": str(trip.id),
        "revision": trip.revision,
        "name": trip.name,
        "destination": trip.destination,
        "dateRange": trip.date_range,
        "savedAt": trip.updated_at.isoformat(),
        "form": trip.form_json or {},
        "itinerary": trip.itinerary,
        "options": trip.options_json or {},
        "structuredItinerary": trip.structured_json or {},
        "resultTab": trip.result_tab,
        "shareToken": share_token,
        "constraints": trip.constraints_json or {},
        "liveState": trip.live_state_json or {},
        "budgetState": trip.budget_state_json or {},
        "disruptionHistory": trip.disruption_history_json or [],
    }


def _travel_document_dict(document: TravelDocument) -> dict[str, Any]:
    return {
        "id": document.id,
        "name": document.name,
        "category": document.category,
        "mime_type": document.mime_type,
        "size_bytes": document.size_bytes,
        "storage_name": document.storage_name,
        "expires_on": document.expires_on or None,
        "created_at": document.created_at.isoformat() if document.created_at else None,
    }


def _journal_entry_dict(entry: JournalEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "trip_id": entry.saved_trip_id,
        "body": entry.body,
        "created_at": entry.created_at.isoformat(),
        "updated_at": entry.updated_at.isoformat(),
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
        "memory": {},
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
