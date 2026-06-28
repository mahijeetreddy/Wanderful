from __future__ import annotations

import os
import sys
import json
import uuid
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
from flask import Flask, jsonify, render_template, request, send_from_directory, session
from crewai import Crew, Process

from agents import create_orchestrator_agent
from auth_store import (
    authenticate_user,
    change_user_password,
    create_saved_trip,
    create_user,
    delete_saved_trip,
    get_user,
    get_user_preferences,
    init_auth_store,
    list_saved_trips,
    upsert_user_preferences,
)
from data_collector import collect_trip_data, search_flight_options_from_instruction, search_hotel_options_with_budget
from main import DATE_FORMAT, TravelInputs, build_travel_crew
from runtime_store import create_plan_job, get_plan_job, init_runtime_store, update_plan_job
from tasks import create_fast_itinerary_task
from tools import fetch_flight_booking_options, fetch_return_flight_options


load_dotenv()

app = Flask(__name__)
app.secret_key = os.getenv("AUTH_SECRET_KEY", "dev-only-change-me")
executor = ThreadPoolExecutor(max_workers=int(os.getenv("PLAN_WORKERS", "2")))
init_auth_store()
init_runtime_store()


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


def _current_user_id() -> int:
    user_id = session.get("user_id")
    if not user_id:
        raise PermissionError("Sign in to use this feature.")
    return int(user_id)


@app.get("/")
def index() -> str:
    dist_index = Path("dist/index.html")
    if dist_index.exists():
        return send_from_directory("dist", "index.html")
    return render_template("index.html")


@app.get("/assets/<path:filename>")
def vite_assets(filename: str):
    return send_from_directory("dist/assets", filename)


@app.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")
    if not user_id:
        return jsonify({"user": None})
    user = get_user(int(user_id))
    if not user:
        session.clear()
        return jsonify({"user": None})
    return jsonify({"user": user})


@app.post("/api/auth/register")
def auth_register():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        name = _clean_text(payload.get("name"))
        email = _clean_text(payload.get("email")).lower()
        password = str(payload.get("password") or "")
        if len(name) < 2:
            raise ValueError("Name must be at least 2 characters.")
        if "@" not in email or "." not in email:
            raise ValueError("Enter a valid email address.")
        if len(password) < 8:
            raise ValueError("Password must be at least 8 characters.")
        user = create_user(name, email, password)
        session["user_id"] = user["id"]
        return jsonify({"user": user})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.post("/api/auth/login")
def auth_login():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        email = _clean_text(payload.get("email")).lower()
        password = str(payload.get("password") or "")
        user = authenticate_user(email, password)
        if not user:
            return jsonify({"error": "Invalid email or password."}), 401
        session["user_id"] = user["id"]
        return jsonify({"user": user})
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"user": None})


@app.put("/api/auth/password")
def auth_password_change():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        current_password = str(payload.get("current_password") or "")
        new_password = str(payload.get("new_password") or "")
        if len(new_password) < 8:
            raise ValueError("New password must be at least 8 characters.")
        change_user_password(_current_user_id(), current_password, new_password)
        return jsonify({"ok": True})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.get("/api/trips")
def trips_list():
    try:
        return jsonify({"trips": list_saved_trips(_current_user_id())})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.post("/api/trips")
def trips_create():
    try:
        user_id = _current_user_id()
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        for field in ("name", "destination", "dateRange", "form", "itinerary"):
            if field not in payload:
                raise ValueError(f"Missing required field: {field}.")
        trip = create_saved_trip(user_id, payload)
        return jsonify({"trip": trip})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.delete("/api/trips/<int:trip_id>")
def trips_delete(trip_id: int):
    try:
        deleted = delete_saved_trip(_current_user_id(), trip_id)
        if not deleted:
            return jsonify({"error": "Saved trip not found."}), 404
        return jsonify({"ok": True})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.get("/api/preferences")
def preferences_get():
    try:
        return jsonify({"preferences": get_user_preferences(_current_user_id())})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.put("/api/preferences")
def preferences_put():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        return jsonify({"preferences": upsert_user_preferences(_current_user_id(), payload)})
    except PermissionError as exc:
        return jsonify({"error": str(exc)}), 401
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


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


@app.post("/api/plan-jobs")
def create_plan_job_route():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        travel_inputs = _validate_payload(payload)
        job_id = uuid.uuid4().hex
        job = create_plan_job(job_id, travel_inputs.as_crew_inputs())
        executor.submit(_run_plan_job, job_id, travel_inputs)
        return jsonify({"job_id": job_id, "job": job}), 202
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.get("/api/plan-jobs/<job_id>")
def get_plan_job_route(job_id: str):
    job = get_plan_job(job_id)
    if not job:
        return jsonify({"error": "Plan job not found."}), 404
    return jsonify({"job": job})


@app.post("/api/hotel-options")
def create_hotel_options():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        travel_inputs = _validate_payload(payload)
        nightly_budget = float(_clean_text(payload.get("nightly_budget")) or 0)
        if nightly_budget <= 0:
            raise ValueError("nightly_budget must be greater than zero.")
        return jsonify(search_hotel_options_with_budget(travel_inputs, nightly_budget))
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


@app.post("/api/flight-booking-options")
def create_flight_booking_options():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        booking_token = _clean_text(payload.get("booking_token"))
        currency_code = _clean_text(payload.get("currency_code")) or "USD"
        return jsonify(fetch_flight_booking_options(booking_token, currency_code))
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 400
    except Exception as exc:
        return jsonify({"error": _friendly_error(exc)}), 500


@app.post("/api/flight-return-options")
def create_flight_return_options():
    try:
        payload = request.get_json(force=True)
        if not isinstance(payload, dict):
            raise ValueError("Request body must be a JSON object.")
        departure_token = _clean_text(payload.get("departure_token"))
        currency_code = _clean_text(payload.get("currency_code")) or "USD"
        return jsonify(fetch_return_flight_options(departure_token, currency_code))
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


def _run_plan_job(job_id: str, travel_inputs: TravelInputs) -> None:
    try:
        update_plan_job(job_id, status="collecting", progress="Collecting live provider data in parallel.")
        if os.getenv("FAST_PLANNER", "true").lower() != "true":
            update_plan_job(job_id, status="planning", progress="Running the full CrewAI workflow.")
            result = _run_crew(travel_inputs)
            update_plan_job(
                job_id,
                status="complete",
                progress="Itinerary complete.",
                itinerary=str(result.get("itinerary", "")),
                options=result.get("options", _empty_options()),
            )
            return

        trip_data = collect_trip_data(travel_inputs)
        options = trip_data.get("options", _empty_options())
        update_plan_job(
            job_id,
            status="planning",
            progress="Provider data ready. Writing the itinerary.",
            options=options,
        )
        itinerary = _generate_fast_itinerary(travel_inputs, trip_data)
        update_plan_job(
            job_id,
            status="complete",
            progress="Itinerary complete.",
            itinerary=itinerary,
            options=options,
        )
    except Exception as exc:
        update_plan_job(job_id, status="failed", progress="Planner failed.", error=_friendly_error(exc))


def _kickoff_planner(travel_inputs: TravelInputs) -> dict[str, Any]:
    if os.getenv("FAST_PLANNER", "true").lower() != "true":
        crew = build_travel_crew()
        return {"itinerary": str(crew.kickoff(inputs=travel_inputs.as_crew_inputs())), "options": _empty_options()}

    trip_data = collect_trip_data(travel_inputs)
    return {
        "itinerary": _generate_fast_itinerary(travel_inputs, trip_data),
        "options": trip_data.get("options", _empty_options()),
    }


def _generate_fast_itinerary(travel_inputs: TravelInputs, trip_data: dict[str, Any]) -> str:
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
    return str(crew.kickoff(inputs=inputs))


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
