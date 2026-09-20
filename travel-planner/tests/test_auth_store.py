from auth_store import (
    create_journal_entry,
    create_saved_trip,
    create_user,
    delete_journal_entry,
    disable_trip_sharing,
    enable_trip_sharing,
    get_public_trip_by_share_token,
    list_journal_entries,
    update_journal_entry,
)


def _trip_id(user_id: int) -> int:
    trip = create_saved_trip(
        user_id,
        {
            "name": "Rome trip",
            "destination": "Rome",
            "dateRange": "2026-09-01 - 2026-09-05",
            "form": {"destination": "Rome", "start_date": "2026-09-01", "end_date": "2026-09-05"},
            "itinerary": "Day one...",
        },
    )
    return int(trip["id"])


def test_journal_entry_crud_round_trip():
    user = create_user("Jane", "jane-journal@example.com", "password123")
    trip_id = _trip_id(user["id"])

    created = create_journal_entry(user["id"], trip_id, "Booked the hotel today.")
    assert created is not None
    assert created["body"] == "Booked the hotel today."

    entries = list_journal_entries(user["id"], trip_id)
    assert entries is not None
    assert len(entries) == 1

    updated = update_journal_entry(user["id"], trip_id, created["id"], "Booked the hotel and flights.")
    assert updated is not None
    assert updated["body"] == "Booked the hotel and flights."

    assert delete_journal_entry(user["id"], trip_id, created["id"]) is True
    assert list_journal_entries(user["id"], trip_id) == []


def test_journal_entry_rejects_wrong_owner():
    owner = create_user("Owner", "owner-journal@example.com", "password123")
    intruder = create_user("Intruder", "intruder-journal@example.com", "password123")
    trip_id = _trip_id(owner["id"])

    assert list_journal_entries(intruder["id"], trip_id) is None
    assert create_journal_entry(intruder["id"], trip_id, "Not allowed") is None

    entry = create_journal_entry(owner["id"], trip_id, "Owner's note")
    assert update_journal_entry(intruder["id"], trip_id, entry["id"], "Hijacked") is None
    assert delete_journal_entry(intruder["id"], trip_id, entry["id"]) is False


def test_journal_entry_for_unknown_trip_is_noop():
    user = create_user("Solo", "solo-journal@example.com", "password123")
    assert list_journal_entries(user["id"], 999999) is None
    assert create_journal_entry(user["id"], 999999, "Ghost trip") is None


def test_trip_sharing_enable_is_idempotent_and_public_lookup_works():
    user = create_user("Sharer", "sharer@example.com", "password123")
    trip_id = _trip_id(user["id"])

    first = enable_trip_sharing(user["id"], trip_id)
    second = enable_trip_sharing(user["id"], trip_id)
    assert first is not None
    assert first["shareToken"] == second["shareToken"]

    public_trip = get_public_trip_by_share_token(first["shareToken"])
    assert public_trip is not None
    assert public_trip["destination"] == "Rome"
    assert "options" not in public_trip
    assert public_trip["itinerary"] == "Day one..."


def test_trip_sharing_disable_revokes_public_access():
    user = create_user("Revoker", "revoker@example.com", "password123")
    trip_id = _trip_id(user["id"])

    share = enable_trip_sharing(user["id"], trip_id)
    assert disable_trip_sharing(user["id"], trip_id) is True
    assert get_public_trip_by_share_token(share["shareToken"]) is None
    assert disable_trip_sharing(user["id"], trip_id) is False


def test_trip_sharing_rejects_wrong_owner():
    owner = create_user("ShareOwner", "share-owner@example.com", "password123")
    intruder = create_user("ShareIntruder", "share-intruder@example.com", "password123")
    trip_id = _trip_id(owner["id"])

    assert enable_trip_sharing(intruder["id"], trip_id) is None

    share = enable_trip_sharing(owner["id"], trip_id)
    assert disable_trip_sharing(intruder["id"], trip_id) is False
    assert get_public_trip_by_share_token(share["shareToken"]) is not None


def test_get_public_trip_by_unknown_token_returns_none():
    assert get_public_trip_by_share_token("does-not-exist") is None
