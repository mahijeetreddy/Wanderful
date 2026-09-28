from copy import deepcopy
import pytest
from auth_store import create_user, create_saved_trip, get_saved_trip, upsert_user_preferences
from search_service import record_options
from travel_workspace import DEFAULTS, extract_confirmation, scenario, preference_prompt


def setup(client):
    owner = create_user("Owner", "admin@example.com", "test-password")
    with client.session_transaction() as session: session["user_id"] = owner["id"]
    form = {"origin": "LAX", "destination": "Lisbon", "start_date": "2027-05-01", "end_date": "2027-05-04", "adults": "2", "currency_code": "USD", "budget": "2000", "destination_timezone": "Europe/Lisbon"}
    flight = {"id": "flight", "currency": "USD", "total_price": 500, "has_return_details": True, "outbound_segment_count": 1, "segments": [{"arrive_at": "2027-05-01T15:00"}, {"depart_at": "2027-05-04T17:00"}]}
    hotel = {"id": "hotel", "currency": "USD", "estimated_total": 400, "name": "Old stay"}
    trip = create_saved_trip(owner["id"], {"name": "Trip", "destination": "Lisbon", "dateRange": "May", "form": form, "itinerary": "Original", "options": {"flights": [flight], "hotels": [hotel]}, "structuredItinerary": {"locked_flight_id": "flight", "locked_hotel_id": "hotel", "days": [{"day_number": 1, "date": "2027-05-01", "activities": [{"title": "Museum", "time": "10:00", "location": "Museum"}]}]}})
    return owner, trip


def test_preferences_revision_isolation_and_profile_preservation(client):
    owner, _ = setup(client)
    prefs = {**DEFAULTS, "pace": "relaxed", "interests": "Architecture"}
    assert client.get("/api/travel-preferences").json["revision"] == 0
    saved = client.put("/api/travel-preferences", json={"expected_revision": 0, "preferences": prefs})
    assert saved.status_code == 200
    assert saved.json["revision"] == 1
    assert client.put("/api/travel-preferences", json={"expected_revision": 0, "preferences": prefs}).status_code == 409
    upsert_user_preferences(owner["id"], {"memory": {"travel_preferences": DEFAULTS}})
    assert client.get("/api/travel-preferences").json["preferences"] == prefs
    assert "relaxed" in preference_prompt(prefs)
    assert client.put("/api/travel-preferences", json={"expected_revision": 1, "preferences": {"pace": []}}).status_code == 400
    with client.session_transaction() as session: session.clear()
    assert client.get("/api/travel-preferences").status_code == 403


def test_scenario_quotes_exact_delta_and_no_trip_mutation(client):
    owner, trip = setup(client)
    offer = record_options(owner["id"], "hotels", trip["form"], {"hotels": [{"id": "new", "name": "New stay", "currency": "USD", "estimated_total": 450.25}]})["hotels"][0]
    url = f'/api/trips/{trip["id"]}/travel-tools'
    data = {"id": "tool-scenario-one", "type": "scenario", "expected_revision": 1, "data": {"name": "Nicer stay", "hotels_snapshot_id": offer["snapshot_id"]}}
    response = client.post(url, json=data)
    assert response.status_code == 200, response.json
    result = response.json["record"]["data"]
    assert result["travel_total_minor"] == 95025 and result["delta_minor"] == 5025
    assert result["expected_trip_total_minor"] == 95025
    assert result["budget_remaining_minor"] == 84975  # 2000 budget minus 950.25 and 10% reserve
    assert result["available_hours"] == 69
    assert result["impacts"][0]["affected_activities"][0]["title"] == "Museum"
    assert client.post(url, json=data).status_code == 200  # identical retry
    persisted = get_saved_trip(owner["id"], trip["id"])
    assert persisted["structuredItinerary"] == trip["structuredItinerary"]
    assert persisted["options"] == trip["options"]
    assert len(client.get(url).json["records"]) == 1
    assert client.post(url, json={**data, "id": "tool-scenario-two"}).status_code == 409


def test_changed_dates_never_reuse_old_prices_and_snapshot_scope(client):
    owner, trip = setup(client)
    changed = {"start_date": "2027-06-01", "end_date": "2027-06-05"}
    result = scenario(trip, changed, owner["id"])
    assert result["travel_total_minor"] is None and result["available_hours"] is None
    offer = record_options(owner["id"], "hotels", trip["form"], {"hotels": [{"id": "new", "currency": "USD", "estimated_total": 100}]})["hotels"][0]
    with pytest.raises(ValueError, match="dates or travelers"):
        scenario(trip, {**changed, "hotels_snapshot_id": offer["snapshot_id"]}, owner["id"])
    with pytest.raises(ValueError, match="unavailable"):
        scenario(trip, {"hotels_snapshot_id": offer["snapshot_id"]}, owner["id"] + 100)
    with pytest.raises(ValueError): scenario(trip, {"end_date": "not-date"}, owner["id"])


def test_inbox_review_deduplication_revision_and_owner_scope(client):
    owner, trip = setup(client)
    url = f'/api/trips/{trip["id"]}/travel-tools'
    value = {"title": "Hotel", "kind": "stay", "reference": "ABC123", "start_date": "2027-05-01", "end_date": "2027-05-04", "status": "confirmed"}
    data = {"id": "tool-booking-one", "type": "inbox", "data": value, "expected_revision": 1}
    result = client.post(url, json=data)
    assert result.status_code == 200, result.json
    assert result.json["record"]["data"]["payment_status"] == "not_recorded"
    assert client.post(url, json=data).status_code == 200
    assert client.post(url, json={**data, "id": "tool-booking-two", "expected_revision": 2}).status_code == 400
    assert client.post(url, json={**data, "data": {**value, "title": "Changed"}}).status_code == 409
    assert client.post(url, json={**data, "expected_revision": 2, "data": {**value, "status": "cancelled"}}).status_code == 200
    assert client.get(f'/api/trips/{trip["id"]}/ledger').json["ledger"]["paid_minor"] == 0
    other = create_user("Other", "other@example.com", "test-password")
    from database import session_scope
    from models import User
    with session_scope() as db: db.get(User, other["id"]).status = "active"
    with client.session_transaction() as session: session["user_id"] = other["id"]
    assert client.get(url).status_code == 404
    assert client.post(url, json=data).status_code == 404
    assert client.post(f'/api/trips/{trip["id"]}/booking-inbox/extract', json={"text": "Private"}).status_code == 404
    assert client.delete(url + "/tool-booking-one", json={"expected_revision": 3}).status_code == 404
    with client.session_transaction() as session: session["user_id"] = owner["id"]
    assert client.delete(url + "/tool-booking-one", json={"expected_revision": 3}).status_code == 200
    assert get_saved_trip(owner["id"], trip["id"])["structuredItinerary"] == trip["structuredItinerary"]


def test_booking_extraction_conservative_and_bounded(client):
    _, trip = setup(client)
    result = client.post(f'/api/trips/{trip["id"]}/booking-inbox/extract', json={"text": "Hotel: Riverside\nReference: ABC123\nCheck-in: 2027-05-01\nCheck-out: tomorrow\nTime: 99:20\nAddress: 1 Street"})
    assert result.status_code == 200
    assert result.json["draft"]["title"] == "Riverside"
    assert result.json["draft"]["start_date"] == "2027-05-01"
    assert result.json["draft"]["end_date"] == "" and result.json["draft"]["time"] == ""
    assert client.get(f'/api/trips/{trip["id"]}/travel-tools').json["records"] == []
    with pytest.raises(ValueError): extract_confirmation("x" * 100001)
    with pytest.raises(ValueError): extract_confirmation("Content-Type: text/html\n\n<script>evil</script>", "mail.eml")
    assert extract_confirmation("Content-Type: text/plain\n\nAirline: Test Air\nPNR: XYZ123", "mail.eml")["reference"] == "XYZ123"
