from __future__ import annotations

import logging
import os
from typing import Any

from auth_store import get_user
from data_collector import collect_trip_data
from email_service import send_plan_ready
from itinerary_schema import StructuredItinerary
from main import TravelInputs
from planner_engine import generate_structured_plan, regenerate_single_day, render_itinerary_markdown
from runtime_store import cancellation_requested, get_plan_job, update_plan_job


logger = logging.getLogger(__name__)


def execute_plan_job(job_id: str, travel_input_values: dict[str, Any]) -> None:
    travel_inputs = TravelInputs(**travel_input_values)
    try:
        if cancellation_requested(job_id):
            update_plan_job(job_id, status="cancelled", progress="Planning cancelled.")
            return
        update_plan_job(
            job_id,
            status="collecting",
            progress="Collecting live provider data in parallel.",
        )
        trip_data = collect_trip_data(travel_inputs)
        options = trip_data.get("options", {})
        update_plan_job(
            job_id,
            status="planning",
            progress="Provider data ready. Writing the structured itinerary.",
            options=options,
        )
        if cancellation_requested(job_id):
            update_plan_job(job_id, status="cancelled", progress="Planning cancelled.")
            return

        structured, metrics = generate_structured_plan(travel_inputs, trip_data)
        itinerary = render_itinerary_markdown(structured)
        update_plan_job(
            job_id,
            status="complete",
            progress="Itinerary complete.",
            itinerary=itinerary,
            options=options,
            structured_itinerary=structured.model_dump(mode="json"),
            metrics=metrics,
        )
        try:
            job_record = get_plan_job(job_id)
            recipient = get_user(job_record["user_id"])["email"] if job_record else None
            if recipient:
                send_plan_ready(recipient, job_id, travel_inputs.destination)
        except Exception:
            logger.exception("Failed to send plan-ready email", extra={"job_id": job_id})
    except Exception as exc:
        update_plan_job(
            job_id,
            status="failed",
            progress="Planner failed.",
            error=_safe_job_error(exc),
        )


def regenerate_plan_job_day(job_id: str, day_number: int, travel_input_values: dict[str, Any]) -> None:
    travel_inputs = TravelInputs(**travel_input_values)
    job = get_plan_job(job_id)
    if not job or not job.get("structured_itinerary"):
        update_plan_job(job_id, status="failed", progress="Day regeneration failed.", error="Plan job missing itinerary for regeneration.")
        return
    try:
        trip_data = {"options": job.get("options") or {}}
        plan = StructuredItinerary.model_validate(job["structured_itinerary"])
        updated_plan = regenerate_single_day(travel_inputs, trip_data, plan, day_number)
        update_plan_job(
            job_id,
            status="complete",
            progress=f"Day {day_number} regenerated.",
            itinerary=render_itinerary_markdown(updated_plan),
            structured_itinerary=updated_plan.model_dump(mode="json"),
        )
    except Exception as exc:
        update_plan_job(
            job_id,
            status="complete",
            progress="Day regeneration failed; previous itinerary kept.",
            error=_safe_job_error(exc),
        )


def _safe_job_error(exc: Exception) -> str:
    message = str(exc)
    lowered = message.lower()
    if "429" in lowered or "quota" in lowered or "resource_exhausted" in lowered:
        return "The AI provider quota was reached. Retry after the provider reset window."
    if "timeout" in lowered:
        return "Planning timed out while waiting for an external provider."
    if os.getenv("APP_ENV", "development").lower() == "development":
        return f"Planning failed: {message}"
    return "Planning failed. Use the correlation ID from the API response when reporting this issue."
