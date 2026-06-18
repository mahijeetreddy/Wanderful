from __future__ import annotations

import os
import sys
import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

os.environ.setdefault(
    "CREWAI_STORAGE_DIR",
    str(Path.cwd() / ".crewai_runtime"),
)
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")
if os.getenv("USE_SYSTEM_PROXY", "false").lower() != "true":
    for proxy_var in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        os.environ.pop(proxy_var, None)

from dotenv import load_dotenv
from flask import Flask, jsonify, render_template, request, send_from_directory
from crewai import Crew, Process

from agents import create_orchestrator_agent
from data_collector import collect_trip_data, search_flight_options_from_instruction
from main import DATE_FORMAT, TravelInputs, build_travel_crew
from tasks import create_fast_itinerary_task


load_dotenv()

app = Flask(__name__)
executor = ThreadPoolExecutor(max_workers=1)


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _validate_payload(payload: dict[str, Any]) -> TravelInputs:
    origin = _clean_text(payload.get("origin"))
    destination = _clean_text(payload.get("destination"))
    start_date = _clean_text(payload.get("start_date"))
    end_date = _clean_text(payload.get("end_date"))
    budget = _clean_text(payload.get("budget")).replace(",", "").replace("$", "")
    interests = _clean_text(payload.get("interests"))
    currency_code = (_clean_text(payload.get("currency_code")) or "USD").upper()
    adults_raw = _clean_text(payload.get("adults")) or "1"

    required_fields = {
        "origin": origin,
        "destination": destination,
        "start_date": start_date,
        "end_date": end_date,
        "budget": budget,
        "interests": interests,
    }
    missing = [field for field, value in required_fields.items() if not value]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}.")

    try:
        start = datetime.strptime(start_date, DATE_FORMAT).date()
        end = datetime.strptime(end_date, DATE_FORMAT).date()
    except ValueError as exc:
        raise ValueError("Dates must use YYYY-MM-DD format.") from exc
    if end <= start:
        raise ValueError("End date must be after start date.")
    if start < date.today():
        raise ValueError("Start date cannot be in the past.")

    try:
        amount = Decimal(budget)
    except InvalidOperation as exc:
        raise ValueError("Budget must be numeric.") from exc
    if amount <= 0:
        raise ValueError("Budget must be greater than zero.")

    if len(currency_code) != 3 or not currency_code.isalpha():
        raise ValueError("Currency code must be a 3-letter ISO code.")

    try:
        adults = int(adults_raw)
    except ValueError as exc:
        raise ValueError("Adults must be a number from 1 to 9.") from exc
    if adults < 1 or adults > 9:
        raise ValueError("Adults must be between 1 and 9.")

    return TravelInputs(
        origin=origin,
        destination=destination,
        start_date=start_date,
        end_date=end_date,
        budget=f"{amount:.2f}",
        interests=interests,
        currency_code=currency_code,
        adults=adults,
    )


@app.get("/")
def index() -> str:
    dist_index = Path("dist/index.html")
    if dist_index.exists():
        return send_from_directory("dist", "index.html")
    return render_template("index.html")


@app.get("/assets/<path:filename>")
def vite_assets(filename: str):
    return send_from_directory("dist/assets", filename)


@app.post("/api/plan")
def create_plan():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        travel_inputs = _validate_payload(payload)
        future = executor.submit(_run_crew, travel_inputs)
        result = future.result(timeout=int(os.getenv("CREW_TIMEOUT_SECONDS", "360")))
        if isinstance(result, dict):
            return jsonify(result)
        return jsonify({"itinerary": str(result), "options": _empty_options()})
    except TimeoutError:
        return (
            jsonify(
                {
                    "error": (
                        "The planner is taking longer than expected. Try a shorter trip, "
                        "check API keys/quotas, or raise CREW_TIMEOUT_SECONDS."
                    )
                }
            ),
            504,
        )
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.post("/api/flight-options")
def create_flight_options():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        instruction = _clean_text(payload.get("instruction"))
        if not instruction:
            raise ValueError("Missing required field: instruction.")
        travel_inputs = _validate_payload(payload)
        return jsonify(search_flight_options_from_instruction(travel_inputs, instruction))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


def _run_crew(travel_inputs: TravelInputs) -> dict[str, Any]:
    try:
        result = _kickoff_planner(travel_inputs)
        return result
    except Exception as exc:
        if not _should_retry_with_groq(exc):
            raise
        original_provider = os.environ.get("LLM_PROVIDER")
        original_model = os.environ.get("LLM_MODEL")
        os.environ["LLM_PROVIDER"] = "groq"
        os.environ["LLM_MODEL"] = os.getenv("GROQ_MODEL", "groq/llama-3.1-8b-instant")
        try:
            result = _kickoff_planner(travel_inputs)
            return result
        finally:
            if original_provider is None:
                os.environ.pop("LLM_PROVIDER", None)
            else:
                os.environ["LLM_PROVIDER"] = original_provider
            if original_model is None:
                os.environ.pop("LLM_MODEL", None)
            else:
                os.environ["LLM_MODEL"] = original_model


def _kickoff_planner(travel_inputs: TravelInputs) -> dict[str, Any]:
    if os.getenv("FAST_PLANNER", "true").lower() != "true":
        crew = build_travel_crew()
        return {"itinerary": str(crew.kickoff(inputs=travel_inputs.as_crew_inputs())), "options": _empty_options()}

    trip_data = collect_trip_data(travel_inputs)
    agent = create_orchestrator_agent()
    task = create_fast_itinerary_task(agent)
    crew = Crew(
        agents=[agent],
        tasks=[task],
        process=Process.sequential,
        verbose=os.getenv("CREW_VERBOSE", "false").lower() == "true",
        max_rpm=int(os.getenv("CREW_MAX_RPM", "8")),
        tracing=os.getenv("CREWAI_TRACING_ENABLED", "false").lower() == "true",
    )
    inputs = {
        **travel_inputs.as_crew_inputs(),
        "trip_data": json.dumps(trip_data, ensure_ascii=False, indent=2),
    }
    return {
        "itinerary": str(crew.kickoff(inputs=inputs)),
        "options": trip_data.get("options", _empty_options()),
    }


def _empty_options() -> dict[str, Any]:
    return {
        "hotels": [],
        "flights": [],
        "flight_recovery": [],
        "map_center": None,
    }


def _should_retry_with_groq(exc: Exception) -> bool:
    if not os.getenv("GROQ_API_KEY"):
        return False
    if os.getenv("LLM_PROVIDER", "").lower() == "groq":
        return False
    message = str(exc).lower()
    return any(
        marker in message
        for marker in (
            "resource_exhausted",
            "quota",
            "429",
            "gemini",
            "llm",
            "rate limit",
        )
    )


def _friendly_error(exc: Exception) -> str:
    message = str(exc)
    lowered = message.lower()
    if "no module named 'crewai.llms.cache'" in lowered:
        return (
            "The CrewAI Python environment was inconsistent. Reinstall dependencies with "
            "`pip install -r requirements.txt --upgrade`, then restart Flask."
        )
    if "brave_search" in lowered or "tool call validation failed" in lowered:
        return (
            "The fallback LLM attempted an unsupported tool call. The web planner now uses "
            "a no-tools fast path; restart Flask so the new runtime is active."
        )
    if "RESOURCE_EXHAUSTED" in message or "429" in message or "quota" in message.lower():
        return (
            "Gemini free-tier quota was reached. Wait about a minute and try again, "
            "or use a lighter model / paid quota. The app now throttles requests, "
            "but repeated runs can still hit Google's per-minute limit."
        )
    if "check_in_date" in message and "past" in message:
        return "Hotel search failed because the check-in date is in the past. Choose future travel dates."
    return f"Travel planner failed: {message}"


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5000")),
        debug=False,
        use_reloader=False,
    )
