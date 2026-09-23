from copy import deepcopy
import pytest
from sqlalchemy.orm.exc import StaleDataError
from auth_store import create_user, create_saved_trip, get_saved_trip, update_trip_budget
from database import SessionLocal
from models import SavedTrip
from trip_mutations import update_workspace, TripRevisionConflict
from search_service import record_options


def fixture_trip():
    owner = create_user("Owner", "admin@example.com", "test-password")
    payload = {"name": "Lisbon", "destination": "Lisbon", "dateRange": "May", "form": {"currency_code": "USD"}, "itinerary": "Original", "options": {}, "structuredItinerary": {}, "budgetState": {"expenses": [{"id": "paid", "amount": 25}]}}
    return owner["id"], create_saved_trip(owner["id"], payload)


def test_workspace_update_reuses_identity_preserves_tools_and_rejects_stale_draft(client):
    owner, trip = fixture_trip()
    with client.session_transaction() as session:
        session["user_id"] = owner
    body = {**trip, "expected_revision": trip["revision"], "itinerary": "Revised", "budgetState": {}}
    response = client.put(f'/api/trips/{trip["id"]}', json=body)
    assert response.status_code == 200
    updated = response.json["trip"]
    assert updated["id"] == trip["id"]
    assert updated["revision"] == 2
    assert updated["budgetState"] == trip["budgetState"]
    assert client.put(f'/api/trips/{trip["id"]}', json=body).status_code == 409
    assert get_saved_trip(owner, int(trip["id"]))["itinerary"] == "Revised"
    assert client.put(f'/api/trips/{trip["id"]}', json={**body, "expected_revision": True}).status_code == 400
    other = create_user("Other", "other@example.com", "test-password")
    assert update_workspace(other["id"], int(trip["id"]), body) is None


def test_other_tool_changes_invalidate_workspace_revision():
    owner, trip = fixture_trip()
    update_trip_budget(owner, int(trip["id"]), {"reserve": 20})
    with pytest.raises(TripRevisionConflict):
        update_workspace(owner, int(trip["id"]), {**trip, "expected_revision": trip["revision"]})


def test_orm_detects_two_writers_loaded_at_same_revision():
    owner, trip = fixture_trip()
    with SessionLocal() as first, SessionLocal() as second:
        a = first.get(SavedTrip, int(trip["id"]))
        b = second.get(SavedTrip, int(trip["id"]))
        a.itinerary = "Winner"
        first.commit()
        b.itinerary = "Stale"
        with pytest.raises(StaleDataError):
            second.commit()
        second.rollback()
    assert get_saved_trip(owner, int(trip["id"]))["itinerary"] == "Winner"


def test_workspace_uses_server_quote_not_client_price_and_preserves_booking():
    owner, trip = fixture_trip()
    offer = record_options(owner, "hotels", {"currency_code": "USD"}, {"hotels": [{"id": "hotel-stable", "currency": "USD", "estimated_total": 420}]})["hotels"][0]
    body = {**trip, "expected_revision": 1, "options": {"hotels": [{**offer, "estimated_total": 1}]}, "structuredItinerary": {"locked_hotel_id": offer["id"]}}
    updated = update_workspace(owner, int(trip["id"]), body)
    assert updated["options"]["hotels"][0]["estimated_total"] == 420
    assert updated["selections"][0]["snapshot_id"] == offer["snapshot_id"]
    from database import session_scope
    from models import TripSelection
    from sqlalchemy import select
    with session_scope() as db:
        selected = db.scalar(select(TripSelection).where(TripSelection.trip_id == int(trip["id"])))
        selected.status = "externally_booked"
    changed = deepcopy(updated)
    changed.update(expected_revision=updated["revision"], structuredItinerary={})
    with pytest.raises(TripRevisionConflict):
        update_workspace(owner, int(trip["id"]), changed)
