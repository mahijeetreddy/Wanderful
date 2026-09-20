from auth_store import create_saved_trip, create_user
from guidebook_store import create_or_reset_guidebook, get_guidebook, update_guidebook


def _trip_id(user_id: int) -> int:
    trip = create_saved_trip(
        user_id,
        {
            "name": "Tokyo trip",
            "destination": "Tokyo",
            "dateRange": "2026-10-01 - 2026-10-05",
            "form": {"destination": "Tokyo", "start_date": "2026-10-01", "end_date": "2026-10-05"},
            "itinerary": "Day one...",
        },
    )
    return int(trip["id"])


def test_guidebook_create_and_status_transitions():
    user = create_user("Kai", "kai-guidebook@example.com", "password123")
    trip_id = _trip_id(user["id"])

    created = create_or_reset_guidebook(user["id"], trip_id)
    assert created is not None
    assert created["status"] == "pending"

    update_guidebook(created["id"], status="generating")
    in_progress = get_guidebook(user["id"], trip_id)
    assert in_progress["status"] == "generating"

    update_guidebook(created["id"], status="complete", content={"overview": "A great city."})
    completed = get_guidebook(user["id"], trip_id)
    assert completed["status"] == "complete"
    assert completed["content"]["overview"] == "A great city."


def test_guidebook_reset_clears_previous_error():
    user = create_user("Reset", "reset-guidebook@example.com", "password123")
    trip_id = _trip_id(user["id"])

    created = create_or_reset_guidebook(user["id"], trip_id)
    update_guidebook(created["id"], status="failed", error="LLM timed out.")

    reset = create_or_reset_guidebook(user["id"], trip_id)
    assert reset["status"] == "pending"
    assert reset["error"] == ""


def test_guidebook_for_unknown_trip_is_noop():
    user = create_user("NoTrip", "notrip-guidebook@example.com", "password123")
    assert create_or_reset_guidebook(user["id"], 999999) is None
    assert get_guidebook(user["id"], 999999) is None
