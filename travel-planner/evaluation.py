from __future__ import annotations

from datetime import datetime
from typing import Any
from urllib.parse import urlparse


def evaluate_itinerary(
    itinerary: dict[str, Any],
    expected_start: str,
    expected_end: str,
    budget: float,
    provider_urls: set[str] | None = None,
) -> dict[str, Any]:
    days = itinerary.get("days") if isinstance(itinerary.get("days"), list) else []
    expected_days = (datetime.fromisoformat(expected_end) - datetime.fromisoformat(expected_start)).days + 1
    dates = [str(day.get("date") or "") for day in days if isinstance(day, dict)]
    duplicate_dates = len(dates) - len(set(dates))
    missing_days = max(0, expected_days - len(set(dates)))
    estimated_total = float(itinerary.get("estimated_total") or 0)
    budget_violation = max(0.0, estimated_total - budget)
    schedule_conflicts = _schedule_conflicts(days)
    invalid_links, unsupported_links = _link_scores(days, provider_urls or set())
    valid_structure = bool(days) and all(
        isinstance(day, dict) and day.get("day_number") and day.get("date") and isinstance(day.get("activities"), list)
        for day in days
    )
    scores = {
        "structured_output_valid": valid_structure,
        "missing_days": missing_days,
        "duplicate_days": duplicate_dates,
        "budget_overrun": round(budget_violation, 2),
        "schedule_conflicts": schedule_conflicts,
        "invalid_links": invalid_links,
        "unsupported_links": unsupported_links,
        "provider_grounding_rate": _grounding_rate(days, provider_urls or set()),
        "fallback_used": any("fallback" in str(item).lower() for item in itinerary.get("validation_warnings", [])),
    }
    scores["passed"] = bool(
        valid_structure
        and missing_days == 0
        and duplicate_dates == 0
        and schedule_conflicts == 0
        and invalid_links == 0
    )
    return scores


def _schedule_conflicts(days: list[Any]) -> int:
    conflicts = 0
    for day in days:
        if not isinstance(day, dict):
            continue
        seen: set[str] = set()
        for activity in day.get("activities", []):
            value = str(activity.get("time") or "")
            if value and value in seen:
                conflicts += 1
            if value:
                seen.add(value)
    return conflicts


def _link_scores(days: list[Any], provider_urls: set[str]) -> tuple[int, int]:
    invalid = 0
    unsupported = 0
    for day in days:
        if not isinstance(day, dict):
            continue
        for activity in day.get("activities", []):
            url = str(activity.get("source_url") or "")
            if not url:
                continue
            parsed = urlparse(url)
            if parsed.scheme not in {"http", "https"} or not parsed.netloc:
                invalid += 1
            elif provider_urls and url not in provider_urls:
                unsupported += 1
    return invalid, unsupported


def _grounding_rate(days: list[Any], provider_urls: set[str]) -> float:
    activities = [
        activity
        for day in days
        if isinstance(day, dict)
        for activity in day.get("activities", [])
        if isinstance(activity, dict)
    ]
    if not activities:
        return 0.0
    grounded = sum(
        1
        for activity in activities
        if activity.get("source_url") and (not provider_urls or activity["source_url"] in provider_urls)
    )
    return round(grounded / len(activities), 3)
