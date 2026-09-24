"""Opt-in forecast monitoring. No itinerary writes, bookings, or email side effects.

Provider contract: https://openweathermap.org/api/forecast5 (5 days / 3-hour steps).
"""
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
import requests
from sqlalchemy import select
from database import session_scope
from models import SavedTrip, TripRecord, User

QUEUE = "weather-monitoring"
INTERVAL = 6 * 60 * 60


def enabled():
    return os.getenv("WEATHER_MONITORING_ENABLED", "false").lower() == "true"


def coordinates(trip):
    point = (trip.options_json or {}).get("map_center") or {}
    lat, lng = point.get("lat"), point.get("lng")
    if not all(isinstance(value, (float, int)) and not isinstance(value, bool) and math.isfinite(value) for value in (lat, lng)) or abs(lat) > 90 or abs(lng) > 180:
        return None
    return {"lat": lat, "lon": lng}


def forecast_risks(payload, now):
    """Only classify actual, future provider slots. Missing data is not clear weather."""
    if not isinstance(payload, dict) or not isinstance(payload.get("list"), list) or not payload["list"]:
        return None
    result = {}
    offset = (payload.get("city") or {}).get("timezone")
    if type(offset) is not int or abs(offset) > 18 * 3600:
        return None
    for slot in payload["list"]:
        try:
            stamp = datetime.fromtimestamp(slot["dt"], timezone.utc)
            if not now <= stamp <= now + timedelta(days=5):
                continue
            codes = [item["id"] for item in slot["weather"] if type(item.get("id")) is int]
            if not codes:
                continue
            date = (stamp + timedelta(seconds=offset)).date().isoformat()
            risks = result.setdefault(date, set())
            if any(200 <= code < 300 for code in codes): risks.add("thunderstorms")
            if any(600 <= code < 700 for code in codes): risks.add("snow")
            rain = (slot.get("rain") or {}).get("3h", 0)
            if isinstance(rain, (int, float)) and rain >= 5: risks.add("heavy rain")
            wind = (slot.get("wind") or {}).get("speed")
            if isinstance(wind, (int, float)) and wind >= 12: risks.add("strong wind")
            temp = (slot.get("main") or {}).get("temp")
            if isinstance(temp, (int, float)) and temp >= 35: risks.add("high temperature")
            if isinstance(temp, (int, float)) and temp <= 0: risks.add("freezing conditions")
        except (KeyError, TypeError, ValueError, OverflowError, OSError):
            continue
    return {date: sorted(risks) for date, risks in result.items()} or None


def record_forecast(trip_id, payload, now=None):
    now = now or datetime.now(timezone.utc)
    forecasts = forecast_risks(payload, now)
    if forecasts is None:
        return {"status": "unavailable", "alerts": 0}
    created = 0
    with session_scope() as db:
        trip = db.get(SavedTrip, trip_id)
        subscription = db.get(TripRecord, (trip_id, "weather-subscription"))
        if not trip or not subscription or not subscription.payload.get("enabled"):
            return {"status": "not_subscribed", "alerts": 0}
        form = trip.form_json or {}
        for date, risks in forecasts.items():
            if not str(form.get("start_date", "9999")) <= date <= str(form.get("end_date", "0000")):
                continue
            state_id = "weather-state-" + date
            previous = db.get(TripRecord, (trip_id, state_id))
            if previous and previous.payload.get("risks") == risks:
                continue
            state = {"risks": risks, "checked_at": now.isoformat()}
            if previous: previous.payload = state
            else: db.add(TripRecord(trip_id=trip_id, id=state_id, kind="weather_state", payload=state))
            if not risks:
                continue
            identity = "weather-alert-" + hashlib.sha256(json.dumps([date, risks]).encode()).hexdigest()[:32]
            if not db.get(TripRecord, (trip_id, identity)):
                db.add(TripRecord(trip_id=trip_id, id=identity, kind="weather_alert", payload={"date": date, "risks": risks, "message": f"Forecast change for {date}: {', '.join(risks)}.", "created_at": now.isoformat(), "source": "OpenWeather five-day forecast", "recovery": "Review an indoor-day recovery; no changes have been applied."}))
                created += 1
    return {"status": "checked", "alerts": created}


def run_monitoring(max_requests=20):
    if not enabled(): return {"status": "disabled", "requests": 0}
    key = os.getenv("OPENWEATHER_API_KEY", "")
    if not key: return {"status": "missing_credentials", "requests": 0}
    if type(max_requests) is not int or not 1 <= max_requests <= 100:
        raise ValueError("Request cap must be between 1 and 100.")
    from runtime_store import rq_redis_client
    connection = rq_redis_client()
    if not connection: return {"status": "missing_redis", "requests": 0}
    now = datetime.now(timezone.utc)
    bucket = int(now.timestamp()) // INTERVAL
    with session_scope() as db:
        subscriptions = db.scalars(select(TripRecord).where(TripRecord.id == "weather-subscription")).all()
        targets = []
        for subscription in subscriptions:
            trip = db.get(SavedTrip, subscription.trip_id)
            user = db.get(User, trip.user_id) if trip else None
            point = coordinates(trip) if trip else None
            form = (trip.form_json or {}) if trip else {}
            if subscription.payload.get("enabled") and user and user.status == "active" and point and str(form.get("start_date", "9999")) <= (now + timedelta(days=5)).date().isoformat() and str(form.get("end_date", "0000")) >= now.date().isoformat():
                targets.append((trip.id, point))
    report = {"status": "complete", "requests": 0, "cache_hits": 0, "alerts": 0, "unavailable": 0, "deferred": 0}
    for trip_id, point in targets:
        cache_key = f"wanderful:forecast:{bucket}:" + hashlib.sha256(json.dumps(point, sort_keys=True).encode()).hexdigest()[:24]
        cached = connection.get(cache_key)
        if cached:
            payload = json.loads(cached); report["cache_hits"] += 1
        else:
            if report["requests"] >= max_requests:
                report["deferred"] += 1; continue
            # Lock survives provider errors: never retry repeatedly inside a six-hour period.
            if not connection.set(cache_key + ":requested", "1", nx=True, ex=INTERVAL):
                report["deferred"] += 1; continue
            report["requests"] += 1
            try:
                response = requests.get("https://api.openweathermap.org/data/2.5/forecast", params={**point, "appid": key, "units": "metric"}, timeout=15)
                response.raise_for_status(); payload = response.json()
                if forecast_risks(payload, now) is None:
                    report["unavailable"] += 1; continue
                connection.setex(cache_key, INTERVAL, json.dumps(payload))
            except (requests.RequestException, ValueError):
                report["unavailable"] += 1; continue
        report["alerts"] += record_forecast(trip_id, payload, now)["alerts"]
    return report
