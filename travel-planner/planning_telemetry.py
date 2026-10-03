"""Aggregate server timings without exposing trips, identities or prompts."""
from math import ceil, isfinite


def summarize(rows, minimum_samples=200):
    cohorts = {}
    for row in rows:
        metrics = row.get("metrics") or {}
        journey = metrics.get("journey") or {}
        days = journey.get("trip_days")
        length = "unknown" if not isinstance(days, int) else "1-3" if days <= 3 else "4-7" if days <= 7 else "8+"
        cache = list((metrics.get("collection", {}).get("provider_cache") or {}).values())
        cache_kind = "unknown" if not cache or any(value is None for value in cache) else "cached" if all(cache) else "uncached" if not any(cache) else "mixed"
        for name in ("all", f"days:{length}/cache:{cache_kind}"):
            cohort = cohorts.setdefault(name, {"jobs": 0, "successes": 0, "failures": 0, "cancelled": 0, "timings": {}})
            cohort["jobs"] += 1
            cohort["failures"] += row.get("status") == "failed"
            cohort["cancelled"] += row.get("status") == "cancelled"
            if row.get("status") != "complete":
                continue
            cohort["successes"] += 1
            for field in ("queue_wait_ms", "first_options_ms", "first_draft_ms", "ready_ms", "enqueue_to_ready_ms"):
                value = journey.get(field)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and isfinite(value) and value >= 0:
                    cohort["timings"].setdefault(field, []).append(value)
    for cohort in cohorts.values():
        cohort["timings"] = {field: {"samples": len(values), "p95_ms": sorted(values)[ceil(len(values) * .95) - 1] if len(values) >= minimum_samples else None, "missing_success_samples": cohort["successes"] - len(values)} for field, values in cohort["timings"].items()}
    return {"cohorts": cohorts, "minimum_samples_per_metric": minimum_samples, "production_sla_established": False, "limitation": "Successful-job latency only; failures counted separately. Sample sufficiency does not establish representative load or an SLA. Queue-to-ready excludes browser polling/rendering; missing metrics are not zero."}
