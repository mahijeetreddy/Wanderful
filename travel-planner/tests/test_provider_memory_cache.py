import json
from unittest.mock import Mock

import provider_memory_cache as cache
import data_collector as collector


def test_cache_expiry_bounds_and_original_timestamp(monkeypatch):
    now = [100.0]
    monkeypatch.setattr(cache, "monotonic", lambda: now[0])
    monkeypatch.setattr(cache, "MAX_ENTRIES", 2)
    cache.put("first", "original timestamp", 10)
    cache.put("second", "value", 10)
    assert cache.get("first") == "original timestamp"
    cache.put("third", "value", 10)
    assert cache.get("second") is None
    now[0] = 110
    assert cache.get("first") is None
    cache.put("oversized", "x" * (cache.MAX_RESPONSE_BYTES + 1), 10)
    assert cache.get("oversized") is None


def test_repeat_search_and_force_refresh_with_no_redis(monkeypatch):
    monkeypatch.setattr(collector, "get_cached_response", lambda _: None)
    monkeypatch.setattr(collector, "set_cached_response", Mock(side_effect=ConnectionError))
    raw = json.dumps({"flights": [], "retrieved_at": "2026-09-30T12:00:00Z"})
    provider = Mock(return_value=raw)
    monkeypatch.setattr(collector, "provider_call", lambda _, call, **kw: call())
    args = ("flights", 1800, {"destination": "Rome"}, provider)
    assert collector._cached_provider_call(*args) == raw
    assert collector._cached_provider_call(*args) == raw
    assert provider.call_count == 1
    assert collector._cached_provider_call(*args, bypass_cache=True) == raw
    assert provider.call_count == 2


def test_failed_provider_response_is_not_cached(monkeypatch):
    monkeypatch.setattr(collector, "get_cached_response", lambda _: None)
    write = Mock()
    monkeypatch.setattr(collector, "set_cached_response", write)
    monkeypatch.setattr(collector, "provider_call", lambda _, call, **kw: call())
    provider = Mock(return_value="Search timed out")
    for _ in range(2):
        collector._cached_provider_call("hotels", 3600, {"destination": "Rome"}, provider)
    assert provider.call_count == 2
    write.assert_not_called()


def test_query_keys_distinguish_dates_party_and_currency():
    base = {"destination": "Rome", "departure_date": "2027-01-01", "adults": 1, "currency_code": "USD"}
    key = collector._cache_key("flights", base)
    for field, value in [("departure_date", "2027-01-02"), ("adults", 2), ("currency_code", "EUR")]:
        assert collector._cache_key("flights", {**base, field: value}) != key


def test_soft_budget_changes_reuse_identical_provider_queries(monkeypatch):
    from main import TravelInputs
    monkeypatch.setattr("attraction_research.start_research", lambda *args: {})
    monkeypatch.setattr("attraction_research.lookup_research", lambda *args: {"status": "unavailable"})
    queries = []
    def collect_query(**kwargs):
        queries.append((kwargs["provider"], collector._cache_key(kwargs["provider"], kwargs["payload"])))
        return "{}"
    monkeypatch.setattr(collector, "_cached_provider_call", collect_query)
    for budget in ("2000", "5000"):
        collector.collect_trip_data(TravelInputs("LAX", "Rome", "2027-05-01", "2027-05-06", budget, "history", "EUR", 2))
    assert sorted(queries[:3]) == sorted(queries[3:])
