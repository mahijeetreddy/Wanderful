from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

os.environ.setdefault("CREWAI_STORAGE_DIR", str(Path.cwd() / ".crewai_runtime"))
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))

from crewai import Agent, Crew, Process, Task

from agents import create_llm
from itinerary_schema import ActivityBlock, BudgetCategory, StructuredDay, StructuredItinerary
from main import TravelInputs
from ranking import score_activity


def generate_structured_plan(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
) -> tuple[StructuredItinerary, dict[str, Any]]:
    started = time.perf_counter()
    outline_started = time.perf_counter()
    outline, outline_fallback = _generate_outline(travel_inputs, trip_data)
    outline_ms = round((time.perf_counter() - outline_started) * 1000)

    expansion_started = time.perf_counter()
    expanded_days, day_failures = _expand_days(travel_inputs, trip_data, outline.days)
    expansion_ms = round((time.perf_counter() - expansion_started) * 1000)
    outline.days = expanded_days
    validated = validate_structured_itinerary(outline, travel_inputs)

    metrics = {
        "outline_ms": outline_ms,
        "day_expansion_ms": expansion_ms,
        "total_ms": round((time.perf_counter() - started) * 1000),
        "day_count": len(validated.days),
        "day_failures": day_failures,
        "outline_fallback": outline_fallback,
        "parallel_workers": _day_workers(),
    }
    return validated, metrics


def regenerate_single_day(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
    plan: StructuredItinerary,
    day_number: int,
) -> StructuredItinerary:
    for index, day in enumerate(plan.days):
        if day.day_number == day_number:
            plan.days[index] = _expand_day(travel_inputs, trip_data, day)
            break
    else:
        raise ValueError(f"Day {day_number} not found in itinerary.")
    return validate_structured_itinerary(plan, travel_inputs)


def render_itinerary_markdown(plan: StructuredItinerary) -> str:
    lines = [
        f"# {plan.destination} Travel Plan",
        "",
        f"**Route:** {plan.origin} to {plan.destination}",
        f"**Dates:** {plan.start_date} to {plan.end_date}",
        f"**Travelers:** {plan.adults}",
        "",
        "## Trip Summary",
        plan.trip_summary or "A structured trip plan based on live provider data and traveler preferences.",
        "",
        "## Budget",
    ]
    for item in plan.budget_categories:
        lines.append(f"- **{item.category}:** {plan.currency_code} {item.amount:.2f} - {item.note}".rstrip(" -"))
    lines.extend(["", f"**Estimated total:** {plan.currency_code} {plan.estimated_total:.2f}", ""])

    for day in plan.days:
        lines.extend(
            [
                f"## Day {day.day_number}: {day.title}",
                f"**Date:** {day.date}",
                "",
                day.summary,
                "",
            ]
        )
        for activity in day.activities:
            prefix = f"{activity.time} - " if activity.time else ""
            cost = f" ({plan.currency_code} {activity.estimated_cost:.2f})" if activity.estimated_cost else ""
            lines.append(f"- **{prefix}{activity.title}**{cost}: {activity.description}")
        if day.weather_note:
            lines.append(f"- **Weather:** {day.weather_note}")
        if day.transit_note:
            lines.append(f"- **Transit:** {day.transit_note}")
        if day.backup_plan:
            lines.append(f"- **Backup:** {day.backup_plan}")
        lines.append("")

    if plan.packing_list:
        lines.extend(["## Packing List", *[f"- {item}" for item in plan.packing_list], ""])
    if plan.logistics:
        lines.extend(["## Logistics", *[f"- {item}" for item in plan.logistics], ""])
    if plan.risks or plan.validation_warnings:
        lines.extend(
            [
                "## Risks and Validation Notes",
                *[f"- {item}" for item in [*plan.risks, *plan.validation_warnings]],
                "",
            ]
        )
    return "\n".join(lines).strip()


def validate_structured_itinerary(
    plan: StructuredItinerary,
    travel_inputs: TravelInputs,
) -> StructuredItinerary:
    expected_dates = _trip_dates(travel_inputs.start_date, travel_inputs.end_date)
    warnings = list(plan.validation_warnings)
    by_date = {day.date: day for day in plan.days if day.date}
    validated_days: list[StructuredDay] = []
    seen_titles: set[str] = set()

    for index, date_value in enumerate(expected_dates, start=1):
        day = by_date.get(date_value)
        if day is None and index - 1 < len(plan.days):
            day = plan.days[index - 1]
        if day is None:
            day = _fallback_day(index, date_value, travel_inputs.destination)
            warnings.append(f"Day {index} was missing and received a deterministic fallback plan.")
        day.day_number = index
        day.date = date_value
        unique_activities: list[ActivityBlock] = []
        for activity in day.activities:
            key = activity.title.strip().lower()
            if not key or key in seen_titles:
                continue
            seen_titles.add(key)
            score, reasons = score_activity(
                activity.model_dump(),
                travel_inputs.interests,
                day.weather_note,
                max(1.0, float(travel_inputs.budget) * 0.06 / max(1, len(expected_dates))),
            )
            activity.rank_score = score
            activity.rank_reasons = reasons
            unique_activities.append(activity)
        day.activities = unique_activities[:6]
        day.estimated_cost = round(sum(item.estimated_cost for item in day.activities), 2)
        validated_days.append(day)

    plan.days = validated_days
    category_total = round(sum(item.amount for item in plan.budget_categories), 2)
    activity_total = round(sum(day.estimated_cost for day in plan.days), 2)
    plan.estimated_total = category_total if category_total else activity_total
    budget = float(travel_inputs.budget)
    if plan.estimated_total > budget:
        warnings.append(
            f"Estimated total exceeds the stated budget by {travel_inputs.currency_code} "
            f"{plan.estimated_total - budget:.2f}."
        )
    plan.validation_warnings = list(dict.fromkeys(warnings))
    return plan


def _generate_outline(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
) -> tuple[StructuredItinerary, bool]:
    prompt = _outline_prompt(travel_inputs, trip_data)
    try:
        result = _run_json_task("Structured itinerary architect", prompt)
        payload = _extract_json_object(result)
        return StructuredItinerary.model_validate(payload), False
    except Exception:
        return _fallback_outline(travel_inputs, trip_data), True


def _expand_days(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
    outline_days: list[StructuredDay],
) -> tuple[list[StructuredDay], int]:
    workers = _day_workers()
    if not outline_days:
        return [], 0
    expanded: dict[int, StructuredDay] = {}
    failures = 0
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_expand_day, travel_inputs, trip_data, day): day
            for day in outline_days
        }
        for future in as_completed(futures):
            original = futures[future]
            try:
                expanded[original.day_number] = future.result()
            except Exception:
                failures += 1
                expanded[original.day_number] = original
    return [expanded[index] for index in sorted(expanded)], failures


def _expand_day(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
    day: StructuredDay,
) -> StructuredDay:
    provider_context = _provider_context(trip_data)
    prompt = f"""
Return one JSON object only. Expand this travel day without inventing live prices or links.

Destination: {travel_inputs.destination}
Interests: {travel_inputs.interests}
Currency: {travel_inputs.currency_code}
Day outline: {day.model_dump_json()}
Provider context: {provider_context}

Required keys:
day_number, date, title, summary, activities, estimated_cost, weather_note,
transit_note, backup_plan.
Each activity requires: time, period, title, description, location,
estimated_cost, indoor, source_url.
Use 3-5 realistically paced activities. Keep costs numeric.
""".strip()
    result = _run_json_task(f"Day {day.day_number} itinerary specialist", prompt)
    payload = _extract_json_object(result)
    expanded = StructuredDay.model_validate(payload)
    expanded.day_number = day.day_number
    expanded.date = day.date
    return expanded


def _run_json_task(role: str, prompt: str) -> str:
    agent = Agent(
        role=role,
        goal="Produce valid, grounded travel-planning JSON with no commentary.",
        backstory="You are a precise travel operations planner and structured data specialist.",
        llm=create_llm(),
        allow_delegation=False,
        allow_code_execution=False,
        verbose=False,
        max_iter=3,
        max_retry_limit=1,
    )
    task = Task(
        description=prompt,
        expected_output="One valid JSON object and no Markdown fences or commentary.",
        agent=agent,
    )
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=False,
        max_rpm=int(os.getenv("STRUCTURED_MAX_RPM", "12")),
        tracing=False,
    )
    return str(crew.kickoff())


def _outline_prompt(travel_inputs: TravelInputs, trip_data: dict[str, Any]) -> str:
    dates = _trip_dates(travel_inputs.start_date, travel_inputs.end_date)
    return f"""
Return one JSON object only for a structured itinerary outline.

Inputs:
{json.dumps(travel_inputs.as_crew_inputs(), indent=2)}
Trip dates (one day object for every date):
{json.dumps(dates)}
Provider context:
{_provider_context(trip_data)}

Required top-level keys:
origin, destination, start_date, end_date, currency_code, adults, trip_summary,
recommended_hotel_id, recommended_flight_id, budget_categories, days,
packing_list, logistics, risks, estimated_total, validation_warnings.

Each budget category requires category, amount, note.
Each day requires day_number, date, title, summary, activities, estimated_cost,
weather_note, transit_note, backup_plan.
For the outline, activities may contain 1-2 broad placeholders. Do not invent live data.
""".strip()


def _provider_context(trip_data: dict[str, Any]) -> str:
    compact = {
        "budget_guidance": trip_data.get("budget_guidance", {}),
        "options": trip_data.get("options", {}),
        "provider_results": trip_data.get("provider_results", {}),
    }
    return json.dumps(compact, ensure_ascii=False, default=str)[:18000]


def _fallback_outline(
    travel_inputs: TravelInputs,
    trip_data: dict[str, Any],
) -> StructuredItinerary:
    dates = _trip_dates(travel_inputs.start_date, travel_inputs.end_date)
    budget = float(travel_inputs.budget)
    allocations = [
        ("Flights", 0.35),
        ("Hotels", 0.38),
        ("Food", 0.12),
        ("Transportation", 0.06),
        ("Activities", 0.06),
        ("Contingency", 0.03),
    ]
    options = trip_data.get("options", {})
    hotels = options.get("hotels", [])
    flights = options.get("flights", [])
    return StructuredItinerary(
        origin=travel_inputs.origin,
        destination=travel_inputs.destination,
        start_date=travel_inputs.start_date,
        end_date=travel_inputs.end_date,
        currency_code=travel_inputs.currency_code,
        adults=travel_inputs.adults,
        trip_summary=f"A {len(dates)}-day trip to {travel_inputs.destination} focused on {travel_inputs.interests}.",
        recommended_hotel_id=str(hotels[0].get("id", "")) if hotels else "",
        recommended_flight_id=str(flights[0].get("id", "")) if flights else "",
        budget_categories=[
            BudgetCategory(category=name, amount=round(budget * ratio, 2), note="Planning allocation")
            for name, ratio in allocations
        ],
        days=[
            _fallback_day(index, date_value, travel_inputs.destination)
            for index, date_value in enumerate(dates, start=1)
        ],
        packing_list=["Weather-appropriate layers", "Comfortable walking shoes", "Travel documents"],
        logistics=["Confirm live availability and booking terms before purchase."],
        risks=["Structured outline used deterministic fallback because the LLM JSON was unavailable."],
        estimated_total=budget,
    )


def _fallback_day(day_number: int, date_value: str, destination: str) -> StructuredDay:
    return StructuredDay(
        day_number=day_number,
        date=date_value,
        title=f"Explore {destination}",
        summary="A balanced day with local exploration, meals, and flexible pacing.",
        activities=[
            ActivityBlock(
                time="09:00",
                period="morning",
                title="Neighborhood orientation",
                description=f"Explore a central neighborhood in {destination} and confirm live opening hours.",
                location=destination,
                estimated_cost=0,
                indoor=False,
            ),
            ActivityBlock(
                time="13:00",
                period="afternoon",
                title="Interest-based activity",
                description="Choose a live provider-backed attraction matching traveler interests.",
                location=destination,
                estimated_cost=0,
                indoor=False,
            ),
            ActivityBlock(
                time="18:30",
                period="evening",
                title="Local dinner",
                description="Select a well-reviewed local restaurant near the chosen hotel.",
                location=destination,
                estimated_cost=0,
                indoor=True,
            ),
        ],
        weather_note="Check the latest forecast before departure.",
        transit_note="Group nearby activities to reduce travel time.",
        backup_plan="Replace outdoor stops with a nearby indoor attraction if needed.",
    )


def _extract_json_object(value: str) -> dict[str, Any]:
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", value.strip(), flags=re.IGNORECASE)
    try:
        payload = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("LLM did not return a JSON object.")
        payload = json.loads(cleaned[start : end + 1])
    if not isinstance(payload, dict):
        raise ValueError("LLM JSON response was not an object.")
    return payload


def _trip_dates(start_date: str, end_date: str) -> list[str]:
    start = datetime.strptime(start_date, "%Y-%m-%d").date()
    end = datetime.strptime(end_date, "%Y-%m-%d").date()
    count = max(1, (end - start).days + 1)
    return [(start + timedelta(days=index)).isoformat() for index in range(count)]


def _day_workers() -> int:
    try:
        return max(1, min(4, int(os.getenv("DAY_LLM_WORKERS", "2"))))
    except ValueError:
        return 2
