from datetime import datetime, timezone
from copy import deepcopy
from sqlalchemy import select
from auth_store import create_user, create_saved_trip, get_saved_trip
from database import session_scope
from models import TripRecord
from trip_mutations import update_workspace
from weather_monitoring import forecast_risks, record_forecast, run_monitoring


def saved(client):
    user = create_user("Owner", "admin@example.com", "test-password")
    with client.session_transaction() as state: state["user_id"] = user["id"]
    trip = create_saved_trip(user["id"], {"name": "Trip", "destination": "Lisbon", "dateRange": "September", "form": {"currency_code": "USD", "budget": "1000", "start_date": "2026-09-24", "end_date": "2026-09-26"}, "options": {"map_center": {"lat": 38.7, "lng": -9.1}}, "itinerary": "Original", "structuredItinerary": {"days": []}})
    return user["id"], int(trip["id"]), trip


def test_undo_preserves_payments_and_rejects_stale_and_foreign_access(client):
    owner, identity, trip = saved(client)
    updated = update_workspace(owner, identity, {**trip, "expected_revision": 1, "itinerary": "Changed"})
    with session_scope() as db:
        db.add(TripRecord(trip_id=identity, id="payment-example", kind="expense", payload={"amount_minor": 100, "currency": "USD"}))
    history = client.get(f"/api/trips/{identity}/history")
    assert history.json["history"][0]["revision"] == 1
    restored = client.post(f"/api/trips/{identity}/undo", json={"expected_revision": 2, "target_revision": 1})
    assert restored.status_code == 200, restored.json
    assert restored.json["trip"]["itinerary"] == "Original"
    with session_scope() as db: assert db.get(TripRecord, (identity, "payment-example")) is not None
    assert client.post(f"/api/trips/{identity}/undo", json={"expected_revision": 2, "target_revision": 1}).status_code == 409
    assert client.post(f"/api/trips/{identity}/undo", json={"expected_revision": 3, "target_revision": []}).status_code == 400
    with client.session_transaction() as state: state.clear()
    assert client.get(f"/api/trips/{identity}/history").status_code == 403


def test_monitoring_disabled_by_default_and_opt_in_revision(client, monkeypatch):
    _, identity, trip = saved(client)
    monkeypatch.delenv("WEATHER_MONITORING_ENABLED", raising=False)
    assert run_monitoring()["status"] == "disabled"
    url = f"/api/trips/{identity}/weather-monitoring"
    assert client.put(url, json={"enabled": True, "expected_revision": 1}).status_code == 400
    monkeypatch.setenv("WEATHER_MONITORING_ENABLED", "true")
    result = client.put(url, json={"enabled": True, "expected_revision": 1})
    assert result.status_code == 200 and result.json["enabled"]
    assert client.put(url, json={"enabled": False, "expected_revision": 1}).status_code == 409
    monkeypatch.delenv("OPENWEATHER_API_KEY", raising=False)
    assert run_monitoring()["status"] == "missing_credentials"


def test_forecast_alerts_deduplicate_and_never_modify_itinerary(client, monkeypatch):
    owner, identity, trip = saved(client)
    with session_scope() as db:
        db.add(TripRecord(trip_id=identity, id="weather-subscription", kind="weather_subscription", payload={"enabled": True}))
    now = datetime(2026, 9, 23, tzinfo=timezone.utc)
    forecast = {"city": {"timezone": 3600}, "list": [{"dt": int(datetime(2026, 9, 24, 12, tzinfo=timezone.utc).timestamp()), "weather": [{"id": 201}], "main": {"temp": 20}}]}
    assert record_forecast(identity, forecast, now)["alerts"] == 1
    assert record_forecast(identity, forecast, now)["alerts"] == 0
    assert record_forecast(identity, {"error": "provider unavailable"}, now)["status"] == "unavailable"
    assert get_saved_trip(owner, identity)["revision"] == 1
    assert get_saved_trip(owner, identity)["itinerary"] == "Original"
    forecast["list"][0]["dt"] = int(datetime(2026, 10, 1, tzinfo=timezone.utc).timestamp())
    assert forecast_risks(forecast, now) is None
    with session_scope() as db:
        alerts = db.scalars(select(TripRecord).where(TripRecord.kind == "weather_alert")).all()
        assert len(alerts) == 1


def test_offline_pack_has_owner_and_excludes_prices_and_recommended_bookings(client):
    owner, identity, trip = saved(client)
    pack = client.get(f"/api/trips/{identity}/offline-pack").json["pack"]
    assert pack["owner_id"] == owner and pack["version"] == 2
    from trip_intelligence import build_offline_pack
    trip["options"]["hotels"] = [{"id": "one", "name": "Hotel", "estimated_total": 99, "property_token": "private"}]
    trip["structuredItinerary"]["recommended_hotel_id"] = "one"
    assert build_offline_pack(trip)["bookings"]["hotel"] is None
    trip["structuredItinerary"]["locked_hotel_id"] = "one"
    assert build_offline_pack(trip)["bookings"]["hotel"] == {"id": "one", "name": "Hotel"}


def test_reserve_uses_exact_money_and_zero_is_valid(client):
    _, identity, _ = saved(client)
    response = client.put(f"/api/trips/{identity}/reserve", json={"expected_revision": 1, "reserve_percent": "12.50"})
    assert response.status_code == 200, response.json
    assert response.json["ledger"]["reserve_minor"] == 12500
    assert response.json["ledger"]["spendable_remaining_minor"] == 87500
    zero = client.put(f"/api/trips/{identity}/reserve", json={"expected_revision": 2, "reserve_percent": "0"})
    assert zero.json["ledger"]["reserve_minor"] == 0
    assert client.put(f"/api/trips/{identity}/reserve", json={"expected_revision": 3, "reserve_percent": "NaN"}).status_code == 400


def test_monitoring_deduplicates_destination_calls_and_obeys_cap(client, monkeypatch):
    from datetime import timedelta
    from models import SavedTrip
    owner, identity, trip = saved(client)
    other = create_saved_trip(owner, {**trip, "name": "Same destination"})
    now = datetime.now(timezone.utc)
    with session_scope() as db:
        for value in (identity, int(other["id"])):
            row = db.get(SavedTrip, value)
            row.form_json = {**row.form_json, "start_date": now.date().isoformat(), "end_date": (now + timedelta(days=2)).date().isoformat()}
            db.add(TripRecord(trip_id=value, id="weather-subscription", kind="weather_subscription", payload={"enabled": True}))
    class MemoryRedis:
        def __init__(self): self.values = {}
        def get(self, key): return self.values.get(key)
        def set(self, key, value, **options):
            if options.get("nx") and key in self.values: return False
            self.values[key] = value; return True
        def setex(self, key, seconds, value): self.values[key] = value
    cache = MemoryRedis()
    monkeypatch.setattr("runtime_store.rq_redis_client", lambda: cache)
    monkeypatch.setenv("WEATHER_MONITORING_ENABLED", "true")
    monkeypatch.setenv("OPENWEATHER_API_KEY", "fixture-not-real")
    calls = []
    class Response:
        def raise_for_status(self): pass
        def json(self): return {"city": {"timezone": 0}, "list": [{"dt": int((now + timedelta(hours=12)).timestamp()), "weather": [{"id": 201}]}]}
    def request(*args, **kwargs): calls.append(1); return Response()
    monkeypatch.setattr("weather_monitoring.requests.get", request)
    first = run_monitoring(1)
    assert first["requests"] == 1 and first["cache_hits"] == 1 and first["alerts"] == 2
    repeated = run_monitoring(1)
    assert repeated["requests"] == 0 and repeated["alerts"] == 0 and len(calls) == 1


def test_handoff_is_account_scoped_and_telemetry_failure_is_nonblocking(client, monkeypatch):
    from search_service import record_options
    owner, identity, trip = saved(client)
    snapshot = record_options(owner, "hotels", {}, {"hotels": [{"id": "hotel", "currency": "USD", "estimated_total": 90}]})["hotels"][0]["snapshot_id"]
    class BrokenRedis:
        def incrby(self, *args): raise ConnectionError("fixture unavailable")
    monkeypatch.setattr("reliability.redis_client", lambda: BrokenRedis())
    assert client.post(f"/api/offers/{snapshot}/handoff").status_code == 200
    assert client.post("/api/offers/not-owned/handoff").status_code == 404
