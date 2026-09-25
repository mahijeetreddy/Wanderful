"""Reproducible fixture checks; explicit capped live provider probes.

python -m evaluations.benchmark
python -m evaluations.benchmark --live-query query.json --max-requests 1
Live query: a SerpAPI parameter object with engine google_flights or google_hotels.
Output is JSON to stdout. No credentials are printed. Fixtures never call providers.
"""
import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
from time import perf_counter
from offers import classify_result, offer_completeness, offer_metadata
from evaluation import evaluate_itinerary


def percentile(values, fraction=.95):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def fixture_report(iterations=100):
    cases = json.loads(Path(__file__).with_name("provider_cases.json").read_text(encoding="utf8"))
    rows, durations, completeness = [], [], []
    for case in cases:
        raw = json.dumps(case["raw"]) if isinstance(case["raw"], dict) else case["raw"]
        measured = []
        for _ in range(iterations):
            started = perf_counter(); result = classify_result(raw)
            measured.append((perf_counter() - started) * 1000)
        passed = result["status"] == case["status"]
        row = {"scenario": case["id"], "status": result["status"], "passed": passed, "classification_p95_ms": percentile(measured)}
        if "offer" in case:
            row["completeness"] = offer_completeness(case["kind"], case["offer"])
            completeness.append(row["completeness"]["status"] == "complete")
            if case["id"] == "missing-total": row["passed"] &= "price" in row["completeness"]["missing_fields"]
            if case["id"] == "expired-selection":
                metadata = offer_metadata(case["kind"], case["offer"])
                row["metadata"] = metadata
                row["passed"] &= metadata.get("freshness") != "fresh"
        if "itinerary" in case:
            row["planning_evaluation"] = evaluate_itinerary(case["itinerary"], "2026-10-01", "2026-10-02", 1000)
            row["passed"] &= not row["planning_evaluation"]["passed"]
        rows.append(row); durations.extend(measured)
    return {"mode": "recorded-fixture-contracts", "generated_at": datetime.now(timezone.utc).isoformat(), "passed": all(row["passed"] for row in rows), "cases": rows,
        "measurements": {"classification_p95_ms": percentile(durations), "offer_completeness_rate": sum(completeness) / len(completeness), "live_provider_latency_ms": None, "first_useful_result_ms": None, "full_plan_p95_ms": None, "production_cache_hit_rate": None, "planning_fallback_rate": None, "handoff_clicks": None},
        "missing_data": ["Live provider, full-plan, cache and handoff measurements require explicit live runs or runtime telemetry; fixture processing is not end-to-end planning."],
        "targets_not_guarantees_ms": {"cached_response_p95": 1000, "first_options_p95": 10000, "full_plan_p95": 90000}}


def live_report(query, max_requests):
    from dotenv import load_dotenv
    load_dotenv()
    import requests
    if type(max_requests) is not int or not 1 <= max_requests <= 5: raise ValueError("Live request cap must be 1–5.")
    key = os.getenv("SERPAPI_API_KEY", "")
    if not key: return {"mode": "live", "status": "missing_credentials", "requests": 0, "passed": False}
    if not isinstance(query, dict) or query.get("engine") not in {"google_flights", "google_hotels"} or any(field in query for field in ("api_key", "async", "output")):
        raise ValueError("Use a travel engine parameter object without credentials or asynchronous mode.")
    rows = []
    for _ in range(max_requests):
        start = perf_counter()
        try:
            response = requests.get("https://serpapi.com/search.json", params={**query, "api_key": key}, timeout=25)
            response.raise_for_status()
            result = classify_result(response.text)
            inventory = any(result["data"].get(field) for field in ("best_flights", "other_flights", "properties"))
            rows.append({"status": result["status"], "provider_ms": (perf_counter() - start) * 1000, "has_inventory": inventory})
        except requests.Timeout:
            rows.append({"status": "timeout", "provider_ms": (perf_counter() - start) * 1000})
        except (requests.RequestException, ValueError):
            rows.append({"status": "error", "provider_ms": (perf_counter() - start) * 1000})
    return {"mode": "live-provider-probe", "requests": len(rows), "request_cap": max_requests, "rows": rows, "passed": all(row["status"] == "success" for row in rows), "provider_p95_ms": percentile([row["provider_ms"] for row in rows]), "full_plan_p95_ms": None, "limitation": "Provider probe only, not a full plan or booking verification."}


def runtime_report():
    from sqlalchemy.exc import SQLAlchemyError
    try:
        return _runtime_report()
    except SQLAlchemyError:
        return {"mode": "runtime-aggregate", "passed": False, "status": "database_unavailable", "limitation": "Could not read telemetry. Check database connectivity and migrations; no schema changes were attempted."}


def _runtime_report():
    """Read only aggregate timings; never print destinations, accounts, tokens or offers."""
    from sqlalchemy import select, inspect
    from database import session_scope
    from models import PlanJob, OfferSnapshot
    from runtime_store import metrics_snapshot, redis_client
    with session_scope() as db:
        missing = sorted({"plan_jobs", "offer_snapshots"} - set(inspect(db.bind).get_table_names()))
        if missing:
            return {"mode": "runtime-aggregate", "passed": False, "status": "migration_required", "missing_tables": missing, "limitation": "Apply reviewed migrations separately. No schema changes were attempted."}
        jobs = db.scalars(select(PlanJob).order_by(PlanJob.created_at.desc()).limit(200)).all()
        snapshots = db.scalars(select(OfferSnapshot).order_by(OfferSnapshot.created_at.desc()).limit(1000)).all()
        full = [row.metrics_json["full_plan_ms"] for row in jobs if isinstance(row.metrics_json.get("full_plan_ms"), (int, float))]
        first = [row.metrics_json.get("collection", {}).get("first_useful_ms") for row in jobs]
        provider = [ms for row in jobs for ms in row.metrics_json.get("collection", {}).get("provider_ms", {}).values() if isinstance(ms, (int, float))]
        fallback = [row.metrics_json["planning"]["fallback_used"] for row in jobs if "fallback_used" in row.metrics_json.get("planning", {})]
        completeness = [offer_completeness(row.kind, row.offer)["status"] == "complete" for row in snapshots]
        failed = sum(row.status == "failed" for row in jobs)
    counters = metrics_snapshot()
    cached = []
    client = redis_client()
    try:
        if client: cached = [float(value) for value in client.lrange("wanderful:timings:cached_provider_ms", 0, 999)]
    except Exception: pass
    hits, misses = counters.get("cache_hits", 0), counters.get("cache_misses", 0)
    return {"mode": "runtime-aggregate", "passed": True, "sample_count": len(jobs), "failed_jobs": failed, "provider_p95_ms": percentile(provider), "first_useful_p95_ms": percentile([value for value in first if isinstance(value, (int, float))]), "full_plan_p95_ms": percentile(full), "cached_provider_p95_ms": percentile(cached), "cache_hit_rate": hits / (hits + misses) if hits + misses else None, "fallback_rate": sum(fallback) / len(fallback) if fallback else None, "offer_completeness_rate": sum(completeness) / len(completeness) if completeness else None, "handoff_clicks": {kind: counters.get("handoff_" + kind) for kind in ("flights", "hotels")}, "missing_full_plan_samples": len(jobs) - len(full), "limitation": "Null means missing telemetry, not zero latency or guaranteed success. Up to 200 recent jobs; Redis samples retained for seven days."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live-query", type=Path)
    parser.add_argument("--max-requests", type=int, default=1)
    parser.add_argument("--runtime", action="store_true", help="Read aggregate telemetry from the configured database and Redis; no live provider requests.")
    args = parser.parse_args()
    if args.runtime and args.live_query: parser.error("Choose runtime telemetry or a live probe, not both.")
    result = runtime_report() if args.runtime else live_report(json.loads(args.live_query.read_text()), args.max_requests) if args.live_query else fixture_report()
    print(json.dumps(result, indent=2))
    return 0 if result["passed"] else 1


if __name__ == "__main__": raise SystemExit(main())
