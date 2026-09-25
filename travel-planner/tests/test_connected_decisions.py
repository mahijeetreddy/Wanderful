from copy import deepcopy
import pytest
from auth_store import create_user, create_saved_trip, get_saved_trip
from decisions import impact, airport_time
from money import minor, major
from search_service import record_options
from trip_intelligence import activity_key


def setup(client):
    owner = create_user("Owner", "admin@example.com", "test-password")
    with client.session_transaction() as session:
        session["user_id"] = owner["id"]
    form = {"currency_code": "USD", "budget": "2000", "destination_timezone": "Europe/Lisbon"}
    trip = create_saved_trip(owner["id"], {"name": "Trip", "destination": "Lisbon", "dateRange": "May", "form": form, "itinerary": "Original", "options": {}, "structuredItinerary": {"budget_categories": [{"category": "Hotels", "amount": 400}], "days": [{"day_number": 1, "date": "2027-05-01", "activities": [{"title": "Museum", "time": "10:00", "location": "Museum"}]}]}})
    return owner, trip


def flight():
    return {"id": "late", "currency": "USD", "total_price": 500, "has_return_details": True, "outbound_segment_count": 1, "segments": [{"arrive_at": "2027-05-01 15:00"}, {"depart_at": "2027-05-04 17:00"}]}


def test_exact_money_and_timezone_ambiguity():
    assert minor("0.10", "USD") + minor("0.20", "USD") == 30
    assert major(12345, "KWD") == "12.345"
    assert minor("120", "JPY") == 120
    for value in ("NaN", "Infinity", "1.001", True, -1):
        with pytest.raises(ValueError):
            minor(value, "USD")
    assert airport_time("2027-03-14 02:30", "America/New_York") is None
    assert airport_time("2027-11-07 01:30", "America/New_York") is None


def test_activity_ranges_duration_midnight_and_dst(client):
    from decisions import activity_interval
    day = {"date": "2027-05-04"}
    start, end = activity_interval(day, {"time": "23:00–01:00"}, "Europe/Lisbon")
    assert end.day == 5 and end.hour == 1
    _, end = activity_interval(day, {"time": "23:00", "duration_minutes": 120}, "Europe/Lisbon")
    assert end.day == 5
    assert activity_interval(day, {"time": "99:99"}, "Europe/Lisbon") == (None, None)
    assert activity_interval({"date": "2027-03-14"}, {"time": "01:30-02:30"}, "America/New_York")[1] is None
    _, trip = setup(client)
    trip["structuredItinerary"]["days"] = [{**day, "day_number": 4, "activities": [{"title": "Long visit", "time": "13:00-15:00"}]}]
    result = impact(trip, flight(), "flights")
    assert result["affected_activities"][0]["title"] == "Long visit"


def test_late_arrival_marks_conflicts_and_locked_activity_blocks(client):
    _, trip = setup(client)
    result = impact(trip, flight(), "flights")
    assert result["affected_activities"][0]["title"] == "Museum"
    assert result["activity_windows"]["available_from"].endswith("17:00:00+01:00")
    assert result["can_apply"]
    activity = trip["structuredItinerary"]["days"][0]["activities"][0]
    trip["constraints"] = {activity_key(1, 0, activity): "locked"}
    assert not impact(trip, flight(), "flights")["can_apply"]
    del trip["form"]["destination_timezone"]
    assert impact(trip, flight(), "flights")["warnings"]


def test_preview_apply_is_revision_bound_and_retains_activity(client):
    owner, trip = setup(client)
    offer = record_options(owner["id"], "flights", {"currency_code": "USD"}, {"flights": [flight()]})["flights"][0]
    url = f'/api/trips/{trip["id"]}/decisions'
    preview = client.post(url + "/preview", json={"expected_revision": 1, "snapshot_id": offer["snapshot_id"]})
    assert preview.status_code == 200, preview.json
    token = preview.json["preview_token"]
    result = client.post(url + "/apply", json={"preview_token": token})
    assert result.status_code == 200, result.json
    updated = result.json["trip"]
    assert updated["revision"] == 2
    assert updated["structuredItinerary"]["days"][0]["activities"][0]["schedule_conflict"]
    assert client.post(url + "/apply", json={"preview_token": token}).status_code == 409
    assert get_saved_trip(owner["id"], int(trip["id"]))["revision"] == 2


def test_payment_for_booking_is_not_counted_twice_and_creation_is_idempotent(client):
    owner, trip = setup(client)
    trip_id = trip["id"]
    offer = record_options(owner["id"], "hotels", {"currency_code": "USD"}, {"hotels": [{"id": "hotel", "currency": "USD", "estimated_total": 600}]})["hotels"][0]
    selected = client.put(f"/api/trips/{trip_id}/selection", json={"snapshot_id": offer["snapshot_id"], "status": "externally_booked", "expected_revision": 1})
    assert selected.status_code == 200
    ledger = client.get(f"/api/trips/{trip_id}/ledger").json["ledger"]
    member = next(item["id"] for item in ledger["records"] if item["kind"] == "member")
    assert ledger["confirmed_minor"] == 60000
    payload = {"id": "test-payment-1", "kind": "expense", "amount": "200.00", "currency": "USD", "paid_by_id": member, "split_ids": [member], "commitment_id": "booking-hotels", "expected_revision": ledger["revision"]}
    response = client.post(f"/api/trips/{trip_id}/records", json=payload)
    assert response.status_code == 201, response.json
    ledger = response.json["ledger"]
    assert ledger["paid_minor"] == 20000
    assert ledger["expected_minor"] == 60000
    assert ledger["remaining_expected_minor"] == 40000
    assert ledger["budget_remaining_minor"] == 140000
    guardian = client.get(f"/api/trips/{trip_id}/intelligence").json["budget"]
    assert guardian["actual"] == 200 and guardian["committed"] == 600
    assert guardian["forecast"] == 600 and guardian["remaining"] == 1400
    assert guardian["ledger"]["expected_minor"] == ledger["expected_minor"]
    retry = client.post(f"/api/trips/{trip_id}/records", json=payload)
    assert retry.status_code == 200
    assert retry.json["ledger"]["paid_minor"] == 20000
    assert client.post(f"/api/trips/{trip_id}/records", json={**payload, "amount": "201"}).status_code == 409


def test_split_remainders_are_exact():
    from ledger import balances
    values = [{"id": name, "kind": "member"} for name in "abc"]
    values.append({"kind": "expense", "paid_by_id": "a", "split_ids": ["a", "b", "c"], "amount_minor": 100})
    assert balances(values) == {"a": 66, "b": -33, "c": -33}
    assert sum(balances(values).values()) == 0
