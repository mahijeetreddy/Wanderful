"""Independent, bounded public-place research. Never writes a trip or user record."""
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from datetime import datetime, timezone
import hashlib
import math
import os
import threading
import time
from urllib.parse import urlencode

from runtime_store import get_cached_response, set_cached_response, redis_client
from tools import _serpapi_get, interactive_provider_budget

_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="place-research")
_slots = threading.BoundedSemaphore(4)  # two running, at most two queued
_lock = threading.RLock()
_memory = OrderedDict()
_active = set()


def category(interests):
    text = str(interests).lower()
    for name, words in (("history", ("history", "museum", "art")), ("nature", ("nature", "hiking", "park")), ("food", ("food", "restaurant"))):
        if any(word in text for word in words):
            return name
    return "attractions"


def research_key(destination, interests):
    # No account IDs, travel dates, free-form interests or preferences in shared cache.
    return "place-research:v1:" + hashlib.sha256(f"{' '.join(str(destination).casefold().split())}|{category(interests)}".encode()).hexdigest()


def _get(key):
    cached = get_cached_response(key)
    if isinstance(cached, dict):
        return cached
    with _lock:
        entry = _memory.get(key)
        if entry and entry[0] > time.monotonic():
            _memory.move_to_end(key)
            return entry[1]
        _memory.pop(key, None)
    return None


def _put(key, report, ttl):
    with _lock:
        _memory[key] = (time.monotonic() + ttl, report)
        _memory.move_to_end(key)
        while len(_memory) > 128:
            _memory.popitem(last=False)
    try:
        set_cached_response(key, "place_research", report, ttl)
    except Exception:
        pass  # Cache outages do not turn successful research into a failed plan.


def lookup_research(destination, interests):
    report = _get(research_key(destination, interests))
    return dict(report) if report else {"status": "unavailable", "places": [], "reason": "No research cached; it may have expired or the worker restarted."}


def start_research(destination, interests):
    try:
        return _start_research(destination, interests)
    except Exception:
        return {"status": "unavailable", "places": [], "reason": "Independent research could not be started."}


def _start_research(destination, interests):
    key = research_key(destination, interests)
    with _lock:
        cached = _get(key)
        if cached:
            return {**cached, "cache_hit": cached.get("status") == "success"}
        if os.getenv("APP_ENV") == "production":
            # RQ's short-lived job processes cannot own reliable background threads.
            # A separate research queue worker must be explicitly configured.
            if os.getenv("RESEARCH_RQ_ENABLED", "false").lower() != "true":
                return {"status": "unavailable", "places": [], "reason": "Independent research worker is not enabled."}
            from runtime_store import rq_redis_client
            from rq import Queue
            connection = rq_redis_client()
            if connection is None:
                return {"status": "unavailable", "places": []}
            client = redis_client()
            if not client.set(key + ":lock", "1", nx=True, ex=90):
                return {"status": "pending", "places": []}
            queue = Queue("research", connection=connection, default_timeout=60)
            if queue.count >= 4:
                return {"status": "unavailable", "places": [], "reason": "Research capacity is busy."}
            _put(key, {"status": "pending", "places": []}, 90)
            queue.enqueue(run_research, key, str(destination)[:160], category(interests), result_ttl=60, failure_ttl=300)
            return {"status": "pending", "places": [], "cache_hit": False}
        if key in _active:
            return {"status": "pending", "places": []}
        if not _slots.acquire(blocking=False):
            return {"status": "unavailable", "places": [], "reason": "Research capacity is busy."}
        try:
            client = redis_client()
            if client and not client.set(key + ":lock", "1", nx=True, ex=90):
                _slots.release()
                return {"status": "pending", "places": []}
        except Exception:
            pass
        _active.add(key)
        pending = {"status": "pending", "places": [], "cache_hit": False}
        _put(key, pending, 90)
        try:
            _pool.submit(_work, key, str(destination)[:160], category(interests))
        except Exception:
            _active.discard(key)
            _slots.release()
            _put(key, {"status": "unavailable", "places": []}, 30)
            raise
        return pending


def fetch_research(destination, interest_category):
    """At most two calls; no retry for empty inventory, quota or invalid credentials."""
    started = time.perf_counter()
    attempts = []
    for attempt in range(2):
        remaining = 40 - (time.perf_counter() - started)
        if remaining < 3:
            break
        tick = time.perf_counter()
        try:
            with interactive_provider_budget(min(20, remaining)):
                topic = {"history": "historic landmarks", "nature": "parks", "food": "restaurants"}.get(interest_category, "tourist attractions")
                payload = _serpapi_get({"engine": "google_maps", "type": "search", "q": f"{topic} in {destination}", "hl": "en"})
            provider_time = (payload.get("search_metadata") or {}).get("total_time_taken")
            attempts.append({"status": "success", "wall_ms": round((time.perf_counter() - tick) * 1000), "provider_reported_seconds": provider_time if isinstance(provider_time, (int, float)) else None, "transport": payload.get("_transport_timing", {})})
            places = []
            for item in (payload.get("local_results") or [])[:12]:
                point = item.get("gps_coordinates") or {}
                lat, lng = point.get("latitude"), point.get("longitude")
                identity = item.get("place_id") or item.get("data_id")
                if not identity or not item.get("title") or not item.get("address"):
                    continue
                if not all(isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) for v in (lat, lng)) or not (-90 <= lat <= 90 and -180 <= lng <= 180):
                    continue
                query = {"api": 1, "query": f"{item['title']}, {item['address']}"}
                if item.get("place_id"):
                    query["query_place_id"] = item["place_id"]
                places.append({"title": str(item["title"])[:200], "address": str(item["address"])[:400], "source_id": str(identity), "coordinates": {"lat": lat, "lng": lng}, "source_url": "https://www.google.com/maps/search/?" + urlencode(query), "opening_hours": None, "admission_price": None, "transit_time": None})
            return {"status": "success" if places else "empty", "places": places, "retrieved_at": datetime.now(timezone.utc).isoformat(), "attempts": attempts, "total_ms": round((time.perf_counter() - started) * 1000), "source": "SerpAPI Google Maps"}
        except Exception as exc:
            label = type(exc).__name__.lower()
            status = getattr(getattr(exc, "response", None), "status_code", None)
            transient = "timeout" in label or "connection" in label or status in {500, 502, 503, 504}
            attempts.append({"status": "timeout" if "timeout" in label else "error", "wall_ms": round((time.perf_counter() - tick) * 1000), "http_status": status})
            if not transient or attempt:
                break
    return {"status": attempts[-1]["status"] if attempts else "timeout", "places": [], "attempts": attempts, "total_ms": round((time.perf_counter() - started) * 1000)}


def run_research(key, destination, interest_category):
    try:
        report = fetch_research(destination, interest_category)
    except Exception:
        report = {"status": "error", "places": []}
    _put(key, report, 86400 if report["status"] == "success" else 60)


def _work(key, destination, interest_category):
    try:
        run_research(key, destination, interest_category)
    finally:
        with _lock:
            _active.discard(key)
        _slots.release()


def evidence_review(days, report, destination):
    from places import _name_matches, _destination_names, _normalized
    checks = []
    for day in days:
        for index, activity in enumerate(day.get("activities") or []):
            matches = [item for item in report.get("places", []) if _name_matches(item, activity) and any(f" {name} " in f" {_normalized(item['address'])} " for name in _destination_names(destination))]
            unique = {item["source_id"]: item for item in matches}
            match = next(iter(unique.values())) if len(unique) == 1 else None
            checks.append({"date": day.get("date"), "activity_index": index, "activity_title": activity.get("title"), "activity_location": activity.get("location", ""), "status": "place_identity_matched" if match else "unverified", "place": match, "opening_hours": "unknown", "admission_price": "unknown", "transit_time": "unknown"})
    return checks
