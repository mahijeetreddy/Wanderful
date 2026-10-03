"""Explicit capped live planning matrix. No account, email or hosted database writes."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from statistics import median
from datetime import date, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Spend existing provider quota: four provider tasks (weather uses two HTTP calls), at most two LLM calls.")
    parser.add_argument("--runs", type=int, default=1, choices=range(1, 7), help="Hard cap of six runs across Rome/6 days, London/3 days, Tokyo/10 days.")
    parser.add_argument("--concurrency", type=int, default=1, choices=(1, 2))
    args = parser.parse_args()
    if not args.live:
        parser.error("Live requests require --live. Use pytest tests/test_direct_planner.py for offline fixtures.")
    from dotenv import load_dotenv
    load_dotenv()
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    os.environ["REDIS_URL"] = ""
    os.environ["FAST_PLAN_MODE"] = "true"
    os.environ["ADMIN_EMAILS"] = ""
    provider = os.getenv("LLM_PROVIDER", "gemini").lower()
    required = [{"gemini": "GEMINI_API_KEY", "groq": "GROQ_API_KEY"}.get(provider, "OPENAI_API_KEY"), "SERPAPI_API_KEY", "OPENWEATHER_API_KEY"]
    missing = [key for key in required if not os.getenv(key)]
    if missing:
        print(json.dumps({"status": "missing_credentials", "missing": missing}))
        return 2
    from main import TravelInputs
    from data_collector import collect_trip_data
    from direct_planner import PlanningFailure
    from offers import classify_result
    from planner_engine import generate_structured_plan

    from evaluation import evaluate_itinerary
    from direct_planner import compact_context
    from attraction_research import lookup_research, evidence_review
    scenarios = [("Rome", 6), ("London", 3), ("Tokyo", 10)]

    def run(index):
        destination, length = scenarios[index % len(scenarios)]
        start = date.today() + timedelta(days=2)
        inputs = TravelInputs("LAX", destination, start.isoformat(), (start + timedelta(days=length - 1)).isoformat(), "4000", "history, food and relaxed neighborhoods", "USD", 1)
        started = time.perf_counter()
        report = {"destination": destination, "requested_days": length}
        try:
            data = collect_trip_data(inputs)
            report.update(provider_status={key: classify_result(value)["status"] for key, value in data["provider_results"].items()}, collection=data["collection_metrics"])
            report["all_providers_succeeded"] = all(status == "success" for status in report["provider_status"].values())
            plan, metrics = generate_structured_plan(inputs, data, on_days=lambda days: None)
            sources = compact_context(data).get("local_search", [])
            urls = {item["link"] for item in sources} if isinstance(sources, list) else set()
            quality = evaluate_itinerary(plan.model_dump(), inputs.start_date, inputs.end_date, float(inputs.budget), urls)
            report.update(status="complete", planning=metrics, days=len(plan.days), activities=sum(len(day.activities) for day in plan.days), quality=quality)
            research = lookup_research(destination, inputs.interests)
            checks = evidence_review(plan.model_dump()["days"], research, destination)
            report["independent_research"] = {key: research.get(key) for key in ("status", "retrieved_at", "total_ms", "attempts")}
            report["independent_research"].update(place_count=len(research.get("places", [])), matched_activities=sum(check["status"] == "place_identity_matched" for check in checks), review_only=True)
        except PlanningFailure as exc:
            report.update(status="failed", planning=exc.metrics)
        except Exception as exc:
            report.update(status="failed", failure_category=type(exc).__name__)
        report["full_plan_ms"] = round((time.perf_counter() - started) * 1000)
        return report

    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        rows = list(executor.map(run, range(args.runs)))
    passed = all(row["status"] == "complete" and row["quality"]["passed"] for row in rows)
    durations = [row["full_plan_ms"] for row in rows if row["status"] == "complete"]
    print(json.dumps({"sample_count": len(rows), "concurrency": args.concurrency, "request_caps": {"provider_http": args.runs * 6, "llm": args.runs * 2}, "passed": passed, "rows": rows, "median_success_ms": median(durations) if durations else None, "max_success_ms": max(durations) if durations else None, "p95": None, "limitation": "Small exploratory sample, not a p95 SLA; opening hours and transit durations remain unverified."}, indent=2))
    return 0 if passed else 1


if __name__ == "__main__":
    raise SystemExit(main())
