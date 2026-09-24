from unittest.mock import patch
from auth_store import create_user, set_user_status
from search_service import record_options


def test_property_lookup_uses_owned_provider_context_and_preserves_unknown_prices(client):
    user = create_user("Admin", "admin@example.com", "test-password")
    with client.session_transaction() as session:
        session["user_id"] = user["id"]
    result = record_options(user["id"], "hotels", {"destination": "Lisbon", "start_date": "2027-05-01", "end_date": "2027-05-04", "adults": "2", "currency_code": "USD"}, {"hotels": [{"id": "hotel", "provider_reference": "owned-token", "estimated_total": 420}]})
    snapshot_id = result["hotels"][0]["snapshot_id"]
    raw = {"name": "Garden Stay", "images": [{"original_image": "javascript:alert(1)"}, {"original_image": "https://example.test/photo.jpg"}], "featured_prices": [{"source": "Provider", "total_rate": {"lowest": "$400"}, "rooms": [{"name": "Suite", "rates": [{"rate_per_night": {"lowest": "$150"}, "link": "javascript:alert(1)", "inclusions": ["Breakfast"]}]}]}]}
    with patch("hotel_details._cached_provider_call", side_effect=lambda provider, ttl, params, call: call()), patch("hotel_details._serpapi_get", return_value=raw) as provider:
        response = client.get(f"/api/offers/{snapshot_id}/property-details")
        assert provider.call_args.args[0]["property_token"] == "owned-token"
        assert provider.call_args.args[0]["adults"] == "2"
    assert response.status_code == 200
    assert response.json["rates"][0]["full_stay_price"] is None
    assert response.json["rates"][0]["room_type"] == "Suite"
    assert response.json["rates"][0]["link"] is None
    assert response.json["images"] == ["https://example.test/photo.jpg"]
    other = create_user("Other", "other@example.com", "test-password")
    set_user_status(user["id"], other["id"], "active")
    with client.session_transaction() as session:
        session["user_id"] = other["id"]
    with patch("hotel_details._serpapi_get") as provider:
        assert client.get(f"/api/offers/{snapshot_id}/property-details").status_code == 404
        provider.assert_not_called()


def test_legacy_property_details_never_guess_a_provider_token():
    from hotel_details import property_details
    with patch("hotel_details._serpapi_get") as provider:
        assert property_details({"id": "hotel-1"}, {})["status"] == "unavailable"
        provider.assert_not_called()


def test_room_rate_snapshot_preserves_price_identity_and_saved_trip_selection(client):
    from hotel_details import snapshot_property_rates
    from search_service import read_offer
    from auth_store import create_saved_trip, get_saved_trip
    user = create_user("Admin", "admin@example.com", "test-password")
    with client.session_transaction() as session:
        session["user_id"] = user["id"]
    context = {"currency_code": "USD", "adults": "2", "start_date": "2027-05-01", "end_date": "2027-05-04"}
    property_offer = {"id": "property", "name": "Garden Stay", "provider_reference": "property-token", "estimated_total": 400}
    rate = {"source": "Provider", "room_type": "Garden suite", "amount": "510.25", "inclusions": ["Breakfast"], "link": "https://provider.example/quote"}
    details = {"retrieved_at": "2026-09-22T15:00:00+00:00", "rates": [rate, {"amount": None}]}
    result = snapshot_property_rates(user["id"], property_offer, context, details)
    selected = result["rates"][0]["offer"]
    assert selected["price_amount"] == "510.25"
    assert selected["estimated_total"] == 510.25
    assert selected["room_type"] == "Garden suite"
    assert selected["taxes_included"] is None
    assert "offer" not in result["rates"][1]
    refreshed = snapshot_property_rates(user["id"], property_offer, context, {"rates": [{**rate, "amount": "600.00"}]})["rates"][0]["offer"]
    assert refreshed["id"] == selected["id"]
    assert refreshed["snapshot_id"] != selected["snapshot_id"]
    assert read_offer(selected["snapshot_id"], user["id"])["estimated_total"] == 510.25
    trip = create_saved_trip(user["id"], {"name": "Lisbon", "destination": "Lisbon", "dateRange": "May", "itinerary": "Plan", "form": context})
    response = client.put(f"/api/trips/{trip['id']}/selection", json={"snapshot_id": selected["snapshot_id"], "expected_revision": trip["revision"]})
    assert response.status_code == 200
    reopened = get_saved_trip(user["id"], int(trip["id"]))
    assert reopened["options"]["hotels"][0]["room_type"] == "Garden suite"
    assert reopened["options"]["hotels"][0]["estimated_total"] == 510.25
