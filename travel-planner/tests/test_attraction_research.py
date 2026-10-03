from threading import Event
from unittest.mock import patch, Mock

import pytest
import requests

import attraction_research as research
from planning_telemetry import summarize


@pytest.fixture(autouse=True)
def isolated_research_cache():
    with patch.object(research, "get_cached_response", return_value=None), patch.object(research, "set_cached_response"), patch.object(research, "redis_client", return_value=None):
        with research._lock:
            research._memory.clear()
        yield


def place_payload():
    return {"local_results": [{"title": "Roman Forum", "address": "Rome, Italy", "place_id": "fixture", "gps_coordinates": {"latitude": 41.89, "longitude": 12.48}}], "search_metadata": {"total_time_taken": 1.2}}


def test_transient_timeout_has_one_bounded_retry():
    with patch.object(research, "_serpapi_get", side_effect=[requests.Timeout("SECRET"), place_payload()]) as call:
        result = research.fetch_research("Rome", "history")
    assert call.call_count == 2
    assert result["status"] == "success"
    assert result["places"][0]["opening_hours"] is None
    assert "SECRET" not in str(result)


def test_auth_failure_does_not_retry_or_leak_response():
    response = requests.Response()
    response.status_code = 401
    with patch.object(research, "_serpapi_get", side_effect=requests.HTTPError("SECRET", response=response)) as call:
        result = research.fetch_research("Rome", "history")
    assert call.call_count == 1
    assert result["status"] == "error"
    assert "SECRET" not in str(result)


def test_success_cache_reused_with_original_retrieval_time():
    key = research.research_key("Rome", "history personal private text")
    report = {"status": "success", "places": [], "retrieved_at": "2026-09-30T00:00:00Z"}
    research._put(key, report, 600)
    with patch.object(research._pool, "submit") as submit:
        cached = research.start_research("Rome", "museum")
    assert cached["cache_hit"] is True
    assert cached["retrieved_at"] == report["retrieved_at"]
    submit.assert_not_called()
    assert "private" not in key


def test_submission_does_not_wait_for_research():
    with patch.object(research._pool, "submit") as submit:
        result = research.start_research("Rome", "history")
        assert result["status"] == "pending"
        submit.assert_called_once()
        # The mock never started the worker; release its reservation explicitly.
        key = research.research_key("Rome", "history")
        research._active.discard(key)
        research._slots.release()


def test_verified_identity_requires_matching_name_and_destination():
    with patch.object(research, "_serpapi_get", return_value=place_payload()):
        report = research.fetch_research("Rome", "history")
    days = [{"date": "2026-10-01", "activities": [{"title": "Visit Roman Forum", "location": "Roman Forum"}, {"title": "Unknown museum", "location": "Unknown"}]}]
    checks = research.evidence_review(days, report, "Rome")
    assert [check["status"] for check in checks] == ["place_identity_matched", "unverified"]
    assert checks[0]["opening_hours"] == "unknown"
    assert research.evidence_review(days, report, "London")[0]["status"] == "unverified"
    assert "coordinates" not in days[0]["activities"][0]  # read-only review


def test_p95_requires_sufficient_success_samples_and_separates_failures():
    row = {"status": "complete", "metrics": {"journey": {"trip_days": 6, "ready_ms": 1000}, "collection": {"provider_cache": {"flights": False}}}}
    small = summarize([row, {"status": "failed"}])
    assert small["cohorts"]["all"]["timings"]["ready_ms"]["p95_ms"] is None
    assert small["cohorts"]["all"]["failures"] == 1
    sufficient = summarize([row] * 200)
    assert sufficient["cohorts"]["days:4-7/cache:uncached"]["timings"]["ready_ms"]["p95_ms"] == 1000
    assert not sufficient["production_sla_established"]


def test_research_endpoint_does_not_read_cache_for_another_accounts_job(client):
    client.post("/api/auth/register", json={"name": "Admin", "email": "admin@example.com", "password": "long-password"})
    with patch("web_app.get_plan_job", return_value=None), patch.object(research, "lookup_research") as lookup:
        assert client.get("/api/plan-jobs/not-owned/research").status_code == 404
    lookup.assert_not_called()


def test_collection_never_waits_for_research_future():
    from data_collector import collect_trip_data
    from main import TravelInputs
    pending = {"status": "pending", "places": []}
    results = {"flights": "{}", "hotels": "{}", "weather": "{}"}
    with patch.object(research, "start_research", return_value=pending), patch.object(research, "lookup_research", return_value=pending), patch("data_collector._run_provider_tasks_with_metrics", return_value=(results, {})) as run:
        result = collect_trip_data(TravelInputs("LAX", "Rome", "2026-10-01", "2026-10-02", "1000", "history"))
    assert set(run.call_args.args[0]) == {"flights", "hotels", "weather"}
    assert result["collection_metrics"]["research"]["status_at_generation"] == "pending"


def test_200_fixture_submissions_keep_research_workers_and_backlog_bounded():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Lock
    release = Event()
    guard = Lock()
    running = peak = 0
    futures = []
    original_submit = research._pool.submit
    def fake_fetch(destination, interest_category):
        nonlocal running, peak
        with guard:
            running += 1
            peak = max(peak, running)
        assert release.wait(10)
        with guard:
            running -= 1
        return {"status": "success", "places": [], "retrieved_at": "fixture"}
    def capture(*args):
        future = original_submit(*args)
        futures.append(future)
        return future
    with patch.object(research, "fetch_research", side_effect=fake_fetch), patch.object(research._pool, "submit", side_effect=capture):
        try:
            with ThreadPoolExecutor(max_workers=8) as clients:
                reports = list(clients.map(lambda index: research.start_research(f"Fixture city {index}", "history"), range(200)))
            assert len(futures) <= 4
            assert peak <= 2
            assert sum(report["status"] == "unavailable" for report in reports) >= 196
        finally:
            release.set()
            for future in futures:
                future.result(timeout=10)


def test_production_research_is_disabled_without_explicit_worker_configuration(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.delenv("RESEARCH_RQ_ENABLED", raising=False)
    with patch.object(research._pool, "submit") as submit:
        assert research.start_research("Rome", "history")["status"] == "unavailable"
    submit.assert_not_called()


def test_configured_production_uses_separate_rq_queue_not_threads(monkeypatch):
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("RESEARCH_RQ_ENABLED", "true")
    connection = Mock()
    cache = Mock()
    cache.set.return_value = True
    queue = Mock()
    queue.count = 0
    with patch("runtime_store.rq_redis_client", return_value=connection), patch.object(research, "redis_client", return_value=cache), patch("rq.Queue", return_value=queue) as constructor, patch.object(research._pool, "submit") as submit:
        assert research.start_research("Rome", "history")["status"] == "pending"
    assert constructor.call_args.args[0] == "research"
    assert constructor.call_args.kwargs["default_timeout"] == 60
    queue.enqueue.assert_called_once()
    submit.assert_not_called()
