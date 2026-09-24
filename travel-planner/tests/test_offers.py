import json
from unittest.mock import patch

from auth_store import create_user
from data_collector import normalize_flight_options, _run_provider_tasks_with_metrics
from offers import classify_result
from search_service import record_options, read_offer


def test_offer_identity_survives_reordering_and_price_change():
    a = {"flights": [{"from": "LAX", "to": "SEA", "depart_at": "2027-05-01 09:00"}], "total_price": 120}
    b = {"flights": [{"from": "LAX", "to": "SEA", "depart_at": "2027-05-01 10:00"}], "total_price": 140}
    first = normalize_flight_options(json.dumps({"offers": [a, b]}))
    second = normalize_flight_options(json.dumps({"offers": [b, {**a, "total_price": 150}]}))
    assert first[0]["id"] == second[1]["id"]
    assert first[0]["id"] != first[1]["id"]
    assert first[0]["freshness"] == "historical"


def test_provider_failure_types_are_not_empty_inventory():
    assert classify_result("No flight offers found")["status"] == "empty"
    assert classify_result("Flight search failed: request timed out")["status"] == "timeout"
    assert classify_result("Flight search unavailable: set SERPAPI_API_KEY")["status"] == "unavailable"
    assert classify_result('{"error":"quota"}')["status"] == "error"


def test_flight_search_filters_after_combining_all_groups(monkeypatch):
    from tools import FlightSearchTool
    monkeypatch.setenv("SERPAPI_API_KEY", "fixture-key")
    expensive = [{"price": 900, "flights": [{"flight_number": str(index)}]} for index in range(7)]
    affordable = {"price": 120, "flights": [{"flight_number": "AFFORDABLE"}]}
    with patch("tools._serpapi_get", return_value={"best_flights": expensive, "other_flights": [affordable, affordable]}):
        payload = json.loads(FlightSearchTool()._run("LAX", "SEA", "2027-05-01", "2027-05-04", max_price=200))
    assert len(payload["offers"]) == 1
    assert payload["offers"][0]["total_price"] == 120
    assert payload["retrieved_at"]


def test_snapshots_are_account_owned_and_immutable():
    owner = create_user("Owner", "owner@example.com", "test-password")
    other = create_user("Other", "other@example.com", "test-password")
    result = record_options(owner["id"], "flights", {}, {"flights": [{"id": "stable", "total_price": 120}]})
    snapshot_id = result["flights"][0]["snapshot_id"]
    record_options(owner["id"], "flights", {}, {"flights": [{"id": "stable", "total_price": 150}]})
    assert read_offer(snapshot_id, owner["id"])["total_price"] == 120
    assert read_offer(snapshot_id, other["id"]) is None


def test_partial_publication_happens_before_all_providers_finish():
    from threading import Event
    published = Event()
    def slower():
        assert published.wait(2), "fast result was held until slow provider finished"
        return "slow"
    def callback(name, result):
        if name == "fast":
            published.set()
    results, _ = _run_provider_tasks_with_metrics({"fast": lambda: "fast", "slow": slower}, callback)
    assert results == {"fast": "fast", "slow": "slow"}


def test_completed_return_is_a_server_owned_snapshot(client):
    user = create_user("Admin", "admin@example.com", "test-password")
    with client.session_transaction() as session:
        session["user_id"] = user["id"]
    outbound = {"id": "outbound", "currency": "USD", "departure_token": "token", "segments": [{"from": "LAX", "to": "LIS"}], "total_duration_minutes": 600}
    saved = record_options(user["id"], "flights", {"currency_code": "USD"}, {"flights": [outbound]})
    with patch("web_app.fetch_return_flight_options", return_value={"return_options": [{"id": "return-1", "segments": [{"from": "LIS", "to": "LAX"}], "total_price": 800, "total_duration_minutes": 700, "booking_token": "book"}]}):
        response = client.post("/api/flight-return-options", json={"snapshot_id": saved["flights"][0]["snapshot_id"]})
    assert response.status_code == 200
    complete = response.json["return_options"][0]
    assert len(complete["segments"]) == 2
    assert complete["total_duration_minutes"] == 1300
    assert complete["total_price"] == 800
    assert read_offer(complete["snapshot_id"], user["id"])["has_return_details"] is True


def test_saved_booking_is_user_recorded_not_payment_and_rejects_stale_selection(client):
    from auth_store import create_saved_trip, get_saved_trip, list_saved_trips
    user = create_user("Admin", "admin@example.com", "test-password")
    with client.session_transaction() as session:
        session["user_id"] = user["id"]
    trip = create_saved_trip(user["id"], {"name": "Lisbon", "destination": "Lisbon", "dateRange": "May", "itinerary": "Trip", "form": {"currency_code": "USD"}})
    result = record_options(user["id"], "hotels", {}, {"hotels": [{"id": "stay", "currency": "USD", "estimated_total": 420}]})
    snapshot_id = result["hotels"][0]["snapshot_id"]
    response = client.put(f"/api/trips/{trip['id']}/selection", json={"snapshot_id": snapshot_id, "status": "externally_booked", "booking_reference": "CONFIRM123", "expected_snapshot_id": None, "expected_revision": trip["revision"]})
    assert response.status_code == 200
    saved = get_saved_trip(user["id"], int(trip["id"]))
    assert saved["selections"][0]["confirmation_source"] == "user_recorded"
    assert saved["selections"][0]["booking_reference"] == "CONFIRM123"
    assert saved["budgetState"] == {}
    assert list_saved_trips(user["id"])[0]["selections"] == saved["selections"]
    stale = client.put(f"/api/trips/{trip['id']}/selection", json={"snapshot_id": snapshot_id, "expected_snapshot_id": None, "expected_revision": trip["revision"]})
    assert stale.status_code == 409
    paid = client.put(f"/api/trips/{trip['id']}/selection", json={"snapshot_id": snapshot_id, "status": "paid"})
    assert paid.status_code == 400
    other = create_user("Other", "other@example.com", "test-password")
    assert get_saved_trip(other["id"], int(trip["id"])) is None


def test_explicit_recheck_bypasses_local_cache():
    from data_collector import _cached_provider_call
    with patch("data_collector.get_cached_response", return_value="old") as cached, patch("data_collector.provider_call", return_value="fresh") as provider, patch("data_collector.set_cached_response"):
        assert _cached_provider_call("flights", 1800, {}, lambda: "fresh", bypass_cache=True) == "fresh"
    cached.assert_not_called()
    provider.assert_called_once()


def test_missing_offer_evidence_is_explicit_and_unknown_age_is_stale():
    from offers import offer_completeness, offer_metadata
    result = offer_completeness("hotels", {"estimated_total": None, "currency": "USD"})
    assert result["status"] == "partial"
    assert {"price", "room_type", "taxes", "cancellation_policy"} <= set(result["missing_fields"])
    assert "price" in offer_completeness("flights", {"total_price": "NaN", "currency": "USD"})["missing_fields"]
    assert offer_metadata("flight", {"retrieved_at": "2027-01-01T10:00:00"})["freshness"] == "historical"
    owner = create_user("Owner", "owner@example.com", "test-password")
    saved = record_options(owner["id"], "hotels", {}, {"hotels": [{"id": "old", "stale_after": "not-a-date"}]})
    assert read_offer(saved["hotels"][0]["snapshot_id"], owner["id"])["needs_recheck"] is True
