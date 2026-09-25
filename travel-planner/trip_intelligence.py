from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta
import hashlib
import json
from typing import Any
from urllib.parse import urlparse


RAIN_MARKERS = ("rain", "storm", "shower", "snow", "thunder")
VALID_CONSTRAINTS = {"locked", "preferred", "optional", "avoid"}
VALID_LIVE_EVENTS = {"running_late", "rain", "tired", "reduce_cost"}
VALID_DISRUPTION_STRATEGIES = {"protect", "balanced", "rescue"}


def activity_key(day_number: int, index: int, activity: dict[str, Any] | None = None) -> str:
    if activity:
        identity = "|".join(
            str(activity.get(field) or "").strip().lower()
            for field in ("title", "location", "source_url")
        )
        if identity.strip("|"):
            digest = hashlib.sha256(identity.encode("utf-8")).hexdigest()[:12]
            return f"day-{day_number}-{digest}"
    return f"day-{day_number}-activity-{index + 1}"


def assess_trip(trip: dict[str, Any]) -> dict[str, Any]:
    structured = _dict(trip.get("structuredItinerary") or trip.get("structured_itinerary"))
    form = _dict(trip.get("form"))
    days = structured.get("days") if isinstance(structured.get("days"), list) else []
    constraints = _dict(trip.get("constraints"))
    issues: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    seen_titles: dict[str, str] = {}
    total_activities = 0
    sourced_activities = 0
    budget = _number(form.get("budget"))
    daily_budget = budget / max(1, len(days)) if budget else 0

    for day in days:
        if not isinstance(day, dict):
            continue
        number = int(day.get("day_number") or len(evidence) + 1)
        activities = day.get("activities") if isinstance(day.get("activities"), list) else []
        if not activities:
            issues.append(_issue(f"empty-day-{number}", "warning", "pacing", f"Day {number} has no scheduled activities.", "Add a paced set of activities."))
            continue
        if len(activities) > 5:
            issues.append(_issue(f"overload-day-{number}", "warning", "fatigue", f"Day {number} has {len(activities)} activities and may feel rushed.", "Keep the strongest activities and move the rest to the backup plan."))
        missing_times = 0
        for index, activity in enumerate(activities):
            if not isinstance(activity, dict):
                continue
            total_activities += 1
            key = activity_key(number, index, activity)
            legacy_key = activity_key(number, index)
            title = str(activity.get("title") or "Untitled activity")
            normalized_title = title.strip().lower()
            if normalized_title in seen_titles:
                issues.append(_issue(f"duplicate-{key}", "info", "variety", f"{title} appears more than once.", "Keep the best-timed occurrence.", [key, seen_titles[normalized_title]]))
            else:
                seen_titles[normalized_title] = key
            if not str(activity.get("time") or "").strip():
                missing_times += 1
            source_url = _safe_url(activity.get("source_url"))
            if source_url:
                sourced_activities += 1
            score = _number(activity.get("rank_score"))
            freshness = (
                activity.get("source_checked_at")
                or activity.get("retrieved_at")
                or trip.get("savedAt")
                or trip.get("saved_at")
            )
            evidence.append(
                {
                    "item_key": key,
                    "day_number": number,
                    "activity_index": index,
                    "title": title,
                    "source_url": source_url,
                    "confidence": "high" if source_url and score >= 70 else "medium" if source_url or score >= 50 else "low",
                    "reasons": [str(value) for value in activity.get("rank_reasons", []) if str(value).strip()][:4],
                    "freshness": str(freshness) if freshness else None,
                    "constraint": constraints.get(key, constraints.get(legacy_key, "optional")),
                }
            )
        if missing_times:
            issues.append(_issue(f"missing-times-day-{number}", "info", "schedule", f"Day {number} has {missing_times} activities without a start time.", "Assign realistic times and transit buffers."))
        weather = f"{day.get('weather_note', '')} {day.get('summary', '')}".lower()
        outdoor = [
            a for a in activities
            if isinstance(a, dict) and not bool(a.get("indoor")) and a.get("period") != "optional"
        ]
        if outdoor and any(marker in weather for marker in RAIN_MARKERS):
            issues.append(_issue(f"weather-day-{number}", "warning", "weather", f"Day {number} includes outdoor plans during adverse weather.", "Prioritize indoor activities and preserve outdoor stops as optional backups."))
        estimated = _number(day.get("estimated_cost"))
        if daily_budget and estimated > daily_budget * 1.35:
            issues.append(_issue(f"budget-day-{number}", "warning", "budget", f"Day {number} exceeds its proportional daily budget by {estimated - daily_budget:.0f}.", "Remove the lowest-priority expensive activity."))
        if not str(day.get("backup_plan") or "").strip():
            issues.append(_issue(f"backup-day-{number}", "info", "resilience", f"Day {number} has no backup plan.", "Add a nearby indoor fallback."))

    if total_activities and sourced_activities / total_activities < 0.5:
        issues.append(_issue("evidence-coverage", "warning", "trust", "Fewer than half of the activities have a source link.", "Verify low-confidence recommendations before relying on them."))
    if not days:
        issues.append(_issue("missing-itinerary", "critical", "structure", "This trip has no structured daily itinerary.", "Regenerate the trip as a structured plan."))

    penalties = {"critical": 25, "warning": 10, "info": 3}
    score = max(0, 100 - sum(penalties[issue["severity"]] for issue in issues))
    return {
        "score": score,
        "grade": "excellent" if score >= 90 else "good" if score >= 75 else "needs_attention" if score >= 55 else "at_risk",
        "issues": issues,
        "evidence": evidence,
        "summary": f"{len(issues)} issue{'s' if len(issues) != 1 else ''} found across {len(days)} day{'s' if len(days) != 1 else ''}.",
    }


def build_live_view(trip: dict[str, Any], today: date | None = None) -> dict[str, Any]:
    structured = _dict(trip.get("structuredItinerary"))
    days = [day for day in structured.get("days", []) if isinstance(day, dict)]
    current = today or date.today()
    selected = next((day for day in days if day.get("date") == current.isoformat()), None)
    if selected is None:
        selected = next((day for day in days if _safe_date(day.get("date")) and _safe_date(day.get("date")) >= current), days[0] if days else None)
    if selected is None:
        return {"date": current.isoformat(), "day": None, "next_activity": None, "status": "no_plan"}
    activities = [activity for activity in selected.get("activities", []) if isinstance(activity, dict)]
    return {
        "date": selected.get("date"),
        "day": selected,
        "next_activity": activities[0] if activities else None,
        "events": [
            {"id": "running_late", "label": "We're running late"},
            {"id": "rain", "label": "It's raining"},
            {"id": "tired", "label": "We're tired"},
            {"id": "reduce_cost", "label": "Spend less today"},
        ],
        "status": "ready",
    }


def preview_adjustment(
    trip: dict[str, Any],
    event: str,
    day_number: int | None = None,
    strategy: str = "balanced",
) -> dict[str, Any]:
    if event not in VALID_LIVE_EVENTS:
        raise ValueError("Unsupported live adjustment.")
    if strategy not in VALID_DISRUPTION_STRATEGIES:
        raise ValueError("Unsupported disruption strategy.")
    updated = deepcopy(_dict(trip.get("structuredItinerary")))
    days = [day for day in updated.get("days", []) if isinstance(day, dict)]
    target = next((day for day in days if day_number and day.get("day_number") == day_number), days[0] if days else None)
    if target is None:
        raise ValueError("No itinerary day is available to adjust.")
    constraints = _dict(trip.get("constraints"))
    activities = [activity for activity in target.get("activities", []) if isinstance(activity, dict)]
    original = deepcopy(activities)
    original_cost = sum(_number(activity.get("estimated_cost")) for activity in original)
    number = int(target.get("day_number") or 1)
    locked = lambda index: constraints.get(
        activity_key(number, index, activities[index]),
        constraints.get(activity_key(number, index)),
    ) == "locked"
    changes: list[str] = []

    if event == "rain":
        adjusted = 0
        for index, activity in enumerate(activities):
            if locked(index) or bool(activity.get("indoor")):
                continue
            if strategy == "protect" and adjusted >= 1:
                continue
            activity["period"] = "optional"
            activity["weather_sensitive"] = True
            adjusted += 1
        if strategy == "rescue":
            activities = [
                activity for index, activity in enumerate(activities)
                if locked(index) or bool(activity.get("indoor"))
            ]
        target["activities"] = activities
        target["backup_plan"] = target.get("backup_plan") or "Keep outdoor stops optional and use nearby indoor alternatives during rain."
        changes.append(
            f"{'Removed' if strategy == 'rescue' else 'Marked'} {adjusted} flexible outdoor "
            f"activit{'y' if adjusted == 1 else 'ies'} {'from the active route' if strategy == 'rescue' else 'as optional'}; locked commitments were unchanged."
        )
    elif event == "running_late":
        minutes = {"protect": 30, "balanced": 60, "rescue": 90}[strategy]
        for index, activity in enumerate(activities):
            if locked(index):
                continue
            shifted = _shift_time(str(activity.get("time") or ""), minutes)
            if shifted:
                activity["time"] = shifted
        if strategy == "rescue":
            flexible = [index for index in range(len(activities)) if not locked(index)]
            if flexible:
                removed = activities.pop(flexible[-1])
                target["backup_plan"] = f"Recover later if time allows: {removed.get('title', 'optional stop')}"
        target["activities"] = activities
        changes.append(f"Shifted flexible activities by {minutes} minutes; locked commitments were unchanged.")
    elif event == "tired":
        kept: list[dict[str, Any]] = []
        removed: list[str] = []
        activity_limit = {"protect": 4, "balanced": 3, "rescue": 2}[strategy]
        for index, activity in enumerate(activities):
            if locked(index) or len(kept) < activity_limit:
                kept.append(activity)
            else:
                removed.append(str(activity.get("title") or "activity"))
        target["activities"] = kept
        if removed:
            target["backup_plan"] = "Optional if energy allows: " + ", ".join(removed)
        changes.append(f"Reduced the day to {len(kept)} core activities and moved extras to the backup plan.")
    else:
        removable = sorted(
            [(index, activity) for index, activity in enumerate(activities) if not locked(index)],
            key=lambda pair: _number(pair[1].get("estimated_cost")),
            reverse=True,
        )
        removal_count = 2 if strategy == "rescue" else 1
        selected = [pair for pair in removable[:removal_count] if _number(pair[1].get("estimated_cost")) > 0]
        if selected:
            removed_indices = {pair[0] for pair in selected}
            target["activities"] = [activity for index, activity in enumerate(activities) if index not in removed_indices]
            names = ", ".join(str(pair[1].get("title") or "paid activity") for pair in selected)
            changes.append(f"Moved {names} out of the active plan to reduce spending.")
        else:
            changes.append("No flexible paid activity could be removed; locked commitments remain protected.")

    target["estimated_cost"] = round(sum(_number(activity.get("estimated_cost")) for activity in target.get("activities", [])), 2)
    new_cost = target["estimated_cost"]
    before = assess_trip(trip)
    adjusted_trip = {**trip, "structuredItinerary": updated}
    after = assess_trip(adjusted_trip)
    return {
        "event": event,
        "strategy": strategy,
        "day_number": number,
        "changes": changes,
        "before_score": before["score"],
        "after_score": after["score"],
        "structuredItinerary": updated,
        "changed": original != target.get("activities", []),
        "cost_delta": round(new_cost - original_cost, 2),
        "protected_commitments": sum(1 for index in range(len(original)) if constraints.get(activity_key(number, index, original[index]), constraints.get(activity_key(number, index))) == "locked"),
    }


def build_disruption_scenarios(trip: dict[str, Any], event: str, day_number: int | None = None) -> list[dict[str, Any]]:
    labels = {
        "protect": ("Protect the plan", "Smallest viable change"),
        "balanced": ("Balanced recovery", "Best trade-off across time, cost, and energy"),
        "rescue": ("Maximum recovery", "Create the most breathing room"),
    }
    scenarios = []
    for strategy in ("protect", "balanced", "rescue"):
        preview = preview_adjustment(trip, event, day_number, strategy)
        title, description = labels[strategy]
        scenarios.append({**preview, "id": f"{event}-{strategy}", "title": title, "description": description})
    return scenarios


def normalize_budget_state(value: Any) -> dict[str, Any]:
    state = _dict(value)
    members = []
    for member in state.get("members", []) if isinstance(state.get("members"), list) else []:
        name = str(member).strip()[:100]
        if name and name.lower() not in {item.lower() for item in members}:
            members.append(name)
    if not members:
        members = ["Me"]
    raw_expenses = state.get("expenses") if isinstance(state.get("expenses"), list) else []
    expenses = []
    for index, expense in enumerate(raw_expenses[:300]):
        if not isinstance(expense, dict):
            continue
        amount = _number(expense.get("amount"))
        if amount <= 0 or amount > 10_000_000:
            continue
        split_between = []
        for member in expense.get("split_between", []) if isinstance(expense.get("split_between"), list) else []:
            name = str(member).strip()[:100]
            if name and name in members and name not in split_between:
                split_between.append(name)
        if not split_between:
            split_between = members[:max(1, min(len(members), int(_number(expense.get("split_count")) or len(members))))]
        paid_by = str(expense.get("paid_by") or members[0]).strip()[:100]
        if paid_by not in members:
            members.append(paid_by)
        expenses.append(
            {
                "id": str(expense.get("id") or f"expense-{index + 1}")[:80],
                "label": str(expense.get("label") or "Trip expense").strip()[:160],
                "category": str(expense.get("category") or "Other").strip()[:80],
                "amount": round(amount, 2),
                "paid_by": paid_by,
                "split_count": len(split_between),
                "split_between": split_between,
                "occurred_at": str(expense.get("occurred_at") or date.today().isoformat())[:32],
            }
        )
    settlements = []
    for index, settlement in enumerate(state.get("settlements", []) if isinstance(state.get("settlements"), list) else []):
        if not isinstance(settlement, dict):
            continue
        amount = _number(settlement.get("amount"))
        from_member = str(settlement.get("from") or "").strip()[:100]
        to_member = str(settlement.get("to") or "").strip()[:100]
        if amount <= 0 or from_member not in members or to_member not in members or from_member == to_member:
            continue
        settlements.append({
            "id": str(settlement.get("id") or f"settlement-{index + 1}")[:80],
            "from": from_member,
            "to": to_member,
            "amount": round(amount, 2),
            "settled_at": str(settlement.get("settled_at") or date.today().isoformat())[:32],
        })
    reserve_percent = max(0, min(50, _number(state.get("reserve_percent") or 10)))
    return {"expenses": expenses, "members": members[:50], "settlements": settlements[:300], "reserve_percent": reserve_percent, "updated_at": datetime.utcnow().isoformat() + "Z"}


def build_budget_guardian(trip: dict[str, Any], *, owner_id=None) -> dict[str, Any]:
    if owner_id is not None:
        from budget_view import saved_budget
        return saved_budget(owner_id, trip)
    state = normalize_budget_state(trip.get("budgetState"))
    structured = _dict(trip.get("structuredItinerary"))
    categories = [item for item in structured.get("budget_categories", []) if isinstance(item, dict)]
    budget = _number(_dict(trip.get("form")).get("budget"))
    committed = round(sum(_number(item.get("amount")) for item in categories), 2)
    actual = round(sum(_number(item.get("amount")) for item in state["expenses"]), 2)
    reserve = round(budget * state["reserve_percent"] / 100, 2)
    spendable = max(0, budget - reserve)
    forecast = max(committed, actual)
    remaining = round(budget - actual, 2)
    category_actuals: dict[str, float] = {}
    for expense in state["expenses"]:
        category = str(expense["category"])
        category_actuals[category] = round(category_actuals.get(category, 0) + _number(expense["amount"]), 2)
    breakdown = []
    names = {str(item.get("category") or "Other") for item in categories} | set(category_actuals)
    for name in sorted(names):
        planned = next((_number(item.get("amount")) for item in categories if str(item.get("category") or "Other") == name), 0)
        breakdown.append({"category": name, "planned": round(planned, 2), "actual": category_actuals.get(name, 0), "variance": round(planned - category_actuals.get(name, 0), 2)})
    alerts = []
    if budget and forecast > spendable:
        alerts.append(f"Forecast spending is {forecast - spendable:.0f} above the reserve-safe limit.")
    if actual > budget > 0:
        alerts.append(f"Actual spending is {actual - budget:.0f} over the total trip budget.")
    for item in breakdown:
        if item["planned"] and item["actual"] > item["planned"] * 1.1:
            alerts.append(f"{item['category']} is {item['actual'] - item['planned']:.0f} over plan.")
    status = "on_track" if not alerts else "watch" if actual <= budget else "over_budget"
    return {
        "currency": structured.get("currency_code") or _dict(trip.get("form")).get("currency_code") or "USD",
        "budget": round(budget, 2), "committed": committed, "actual": actual,
        "forecast": round(forecast, 2), "reserve": reserve, "spendable": round(spendable, 2),
        "remaining": remaining, "status": status, "alerts": alerts, "breakdown": breakdown,
        "expenses": state["expenses"], "reserve_percent": state["reserve_percent"],
    }


def build_offline_pack(trip: dict[str, Any]) -> dict[str, Any]:
    structured = _dict(trip.get("structuredItinerary"))
    options = _dict(trip.get("options"))
    days = [day for day in structured.get("days", []) if isinstance(day, dict)]
    pack = {
        "version": 2,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "trip": {"id": trip.get("id"), "name": trip.get("name"), "destination": trip.get("destination"), "date_range": trip.get("dateRange")},
        "days": days,
        "bookings": {
            "hotel": _offline_booking(_find_by_id(options.get("hotels"), structured.get("locked_hotel_id"))),
            "flight": _offline_booking(_find_by_id(options.get("flights"), structured.get("locked_flight_id"))),
        },
        "essentials": {"packing": structured.get("packing_list") or [], "logistics": structured.get("logistics") or [], "risks": structured.get("risks") or []},
        "emergency": {"local_emergency_number": "Verify locally before departure", "travel_insurance": "Add policy details to your trip notes", "offline_note": "Addresses and booking details are available without a connection."},
    }
    canonical = json.dumps(pack, sort_keys=True, default=str).encode("utf-8")
    pack["checksum"] = hashlib.sha256(canonical).hexdigest()[:16]
    pack["item_count"] = len(days) + sum(len(day.get("activities", [])) for day in days)
    return pack


def _offline_booking(value):
    if not value:
        return None
    # Deliberately exclude quote prices, provider tokens, documents and booking references.
    return {key: deepcopy(value[key]) for key in ("id", "name", "address", "segments", "check_in", "check_out") if key in value}


def _find_by_id(values: Any, option_id: Any) -> dict[str, Any] | None:
    if not isinstance(values, list) or not option_id:
        return None
    return next((value for value in values if isinstance(value, dict) and str(value.get("id")) == str(option_id)), None)


def update_memory(existing: dict[str, Any], feedback: dict[str, Any]) -> dict[str, Any]:
    memory = deepcopy(existing or {})
    signals = _dict(memory.get("signals"))
    sentiment = str(feedback.get("sentiment") or "").strip().lower()
    title = str(feedback.get("title") or "").strip()[:200]
    raw_tags = feedback.get("tags", [])
    if not isinstance(raw_tags, list):
        raise ValueError("Feedback tags must be a list.")
    tags = [str(tag).strip().lower()[:80] for tag in raw_tags if str(tag).strip()][:10]
    if sentiment not in {"loved", "liked", "neutral", "disliked", "skipped"}:
        raise ValueError("Unsupported feedback sentiment.")
    for tag in tags:
        value = _dict(signals.get(tag))
        value[sentiment] = int(value.get(sentiment, 0)) + 1
        signals[tag] = value
    history = list(memory.get("recent_feedback") or [])
    history.insert(0, {"title": title, "sentiment": sentiment, "tags": tags, "recorded_at": datetime.utcnow().isoformat() + "Z"})
    memory["signals"] = signals
    memory["recent_feedback"] = history[:30]
    return memory


def learned_preference_tags(memory: dict[str, Any], limit: int = 5) -> list[str]:
    scored: list[tuple[int, str]] = []
    for tag, values in _dict(memory.get("signals")).items():
        counts = _dict(values)
        score = (
            int(counts.get("loved", 0)) * 3
            + int(counts.get("liked", 0))
            - int(counts.get("disliked", 0)) * 3
            - int(counts.get("skipped", 0))
        )
        if score > 0:
            scored.append((score, str(tag)))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [tag for _, tag in scored[:limit]]


def _issue(issue_id: str, severity: str, category: str, message: str, repair: str, items: list[str] | None = None) -> dict[str, Any]:
    return {"id": issue_id, "severity": severity, "category": category, "message": message, "repair": repair, "items": items or []}


def _shift_time(value: str, minutes: int) -> str:
    try:
        parsed = datetime.strptime(value, "%H:%M") + timedelta(minutes=minutes)
    except ValueError:
        return ""
    return parsed.strftime("%H:%M")


def _safe_date(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _safe_url(value: Any) -> str:
    url = str(value or "").strip()
    if not url:
        return ""
    parsed = urlparse(url)
    return url if parsed.scheme in {"http", "https"} and bool(parsed.netloc) else ""
