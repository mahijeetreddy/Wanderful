from evaluations.benchmark import fixture_report, live_report, runtime_report


def test_fixture_contracts_report_missing_live_measurements():
    report = fixture_report(5)
    assert report["passed"] and len(report["cases"]) == 8
    assert report["measurements"]["classification_p95_ms"] >= 0
    assert report["measurements"]["full_plan_p95_ms"] is None
    assert report["missing_data"]


def test_live_probe_does_not_fabricate_success_without_credentials(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "")
    report = live_report({"engine": "google_hotels"}, 1)
    assert not report["passed"] and report["requests"] == 0
    assert report["status"] == "missing_credentials"


def test_empty_runtime_reports_missing_measurements(monkeypatch):
    monkeypatch.setattr("runtime_store.redis_client", lambda: None)
    report = runtime_report()
    assert report["sample_count"] == 0
    assert report["full_plan_p95_ms"] is None
    assert report["cache_hit_rate"] is None
    assert report["offer_completeness_rate"] is None


def test_runtime_reports_missing_schema_without_migrating(monkeypatch):
    class EmptySchema:
        def get_table_names(self): return []
    monkeypatch.setattr("sqlalchemy.inspect", lambda bind: EmptySchema())
    result = runtime_report()
    assert not result["passed"] and result["status"] == "migration_required"
    assert result["missing_tables"] == ["offer_snapshots", "plan_jobs"]


def test_runtime_connection_failure_does_not_print_credentials(monkeypatch):
    from sqlalchemy.exc import OperationalError
    def unavailable(): raise OperationalError("secret-query", {}, Exception("secret-password"))
    monkeypatch.setattr("evaluations.benchmark._runtime_report", unavailable)
    result = runtime_report()
    assert result["status"] == "database_unavailable"
    assert "secret" not in str(result)
