from __future__ import annotations

from typing import Any

from sqlalchemy import select

from database import session_scope
from models import Guidebook, SavedTrip


def get_guidebook(user_id: int, trip_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        guidebook = db.scalar(
            select(Guidebook).where(Guidebook.saved_trip_id == trip_id, Guidebook.user_id == user_id)
        )
        return _guidebook_dict(guidebook) if guidebook else None


def create_or_reset_guidebook(user_id: int, trip_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        guidebook = db.scalar(
            select(Guidebook).where(Guidebook.saved_trip_id == trip_id, Guidebook.user_id == user_id)
        )
        if guidebook:
            guidebook.status = "pending"
            guidebook.error = ""
        else:
            guidebook = Guidebook(saved_trip_id=trip_id, user_id=user_id, status="pending")
            db.add(guidebook)
        db.flush()
        return _guidebook_dict(guidebook)


def update_guidebook(
    guidebook_id: int,
    *,
    status: str | None = None,
    content: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    with session_scope() as db:
        guidebook = db.get(Guidebook, guidebook_id)
        if not guidebook:
            return
        if status is not None:
            guidebook.status = status
        if content is not None:
            guidebook.content_json = content
        if error is not None:
            guidebook.error = error


def _guidebook_dict(guidebook: Guidebook) -> dict[str, Any]:
    return {
        "id": guidebook.id,
        "trip_id": guidebook.saved_trip_id,
        "status": guidebook.status,
        "content": guidebook.content_json or {},
        "error": guidebook.error,
        "created_at": guidebook.created_at.isoformat(),
        "updated_at": guidebook.updated_at.isoformat(),
    }
