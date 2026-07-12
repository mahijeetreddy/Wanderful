from __future__ import annotations

import logging
import os
import secrets
import sys
import time as monotonic_time
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

os.environ.setdefault("CREWAI_STORAGE_DIR", str(Path.cwd() / ".crewai_runtime"))
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")

from dotenv import load_dotenv

load_dotenv()

import sentry_sdk
from flask import Flask, g, jsonify, render_template, request, send_from_directory, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import text

from auth_store import (
    authenticate_user,
    change_user_password,
    consume_password_reset,
    create_password_reset,
    create_saved_trip,
    create_user,
    delete_user_account,
    delete_saved_trip,
    get_user,
    get_user_preferences,
    init_auth_store,
    list_pending_users,
    list_saved_trips,
    set_user_status,
    upsert_user_preferences,
)
from config import settings
from data_collector import (
    search_activity_alternatives,
    search_flight_options_from_instruction,
    search_hotel_options_with_budget,
)
from database import engine
from email_service import notify_admin_pending_user, send_password_reset
from main import DATE_FORMAT, TravelInputs
from observability import configure_json_logging
from queue_service import enqueue_plan_job, enqueue_regenerate_day_job
from runtime_store import (
    active_job_count,
    begin_day_regeneration,
    completed_jobs_since,
    create_plan_job,
    get_plan_job,
    init_runtime_store,
    list_plan_jobs,
    metrics_snapshot,
    redis_ready,
    request_job_cancellation,
    update_plan_job_locks,
)
from security import csrf_token, current_user, require_active_user, require_admin, validate_csrf
from tools import fetch_flight_booking_options, fetch_return_flight_options


configure_json_logging()
logger = logging.getLogger("wanderful.api")

if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.environment,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1")),
        send_default_pii=False,
    )

app = Flask(__name__)
app.secret_key = settings.auth_secret_key
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=settings.secure_cookies,
    SESSION_COOKIE_SAMESITE="Lax",
    MAX_CONTENT_LENGTH=1_000_000,
)
limiter = Limiter(
    key_func=lambda: str(session.get("user_id") or get_remote_address()),
    app=app,
    storage_uri=settings.redis_url or "memory://",
    default_limits=["120 per minute"],
    enabled=settings.environment != "test",
)
init_auth_store()
init_runtime_store()


@app.before_request
def prepare_request():
    g.correlation_id = request.headers.get("X-Correlation-ID") or uuid.uuid4().hex
    g.request_started = monotonic_time.perf_counter()
    csrf_error = validate_csrf()
    if csrf_error:
        return csrf_error
    return None


@app.after_request
def finalize_response(response):
    response.headers["X-Correlation-ID"] = g.get("correlation_id", "")
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    response.set_cookie(
        "wanderful_csrf",
        csrf_token(),
        secure=settings.secure_cookies,
        httponly=False,
        samesite="Lax",
    )
    logger.info(
        "request_complete",
        extra={
            "correlation_id": g.get("correlation_id"),
            "path": request.path,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": round((monotonic_time.perf_counter() - g.get("request_started", monotonic_time.perf_counter())) * 1000, 2),
            "user_id": session.get("user_id"),
        },
    )
    return response


@app.errorhandler(404)
def not_found(_error):
    if request.path.startswith("/api/"):
        return jsonify({"error": "API route not found.", "correlation_id": g.correlation_id}), 404
    return send_from_directory("dist", "index.html") if Path("dist/index.html").exists() else ("Not found", 404)


@app.errorhandler(429)
def rate_limited(_error):
    return jsonify({"error": "Rate limit exceeded. Try again later.", "correlation_id": g.correlation_id}), 429


@app.errorhandler(ValueError)
def invalid_request(error):
    return jsonify({"error": str(error), "correlation_id": g.correlation_id}), 400


@app.errorhandler(PermissionError)
def permission_denied(error):
    return jsonify({"error": str(error), "correlation_id": g.correlation_id}), 403


@app.errorhandler(Exception)
def unhandled_error(error):
    logger.exception(
        "Unhandled request error",
        extra={"correlation_id": g.get("correlation_id"), "path": request.path},
    )
    return jsonify(
        {
            "error": _friendly_error(error),
            "correlation_id": g.get("correlation_id"),
        }
    ), 500


@app.get("/")
def index():
    if Path("dist/index.html").exists():
        return send_from_directory("dist", "index.html")
    return render_template("index.html")


@app.get("/assets/<path:filename>")
def vite_assets(filename: str):
    return send_from_directory("dist/assets", filename)


@app.get("/health/live")
def health_live():
    return jsonify({"status": "ok"})


@app.get("/health/ready")
def health_ready():
    checks = {"database": False, "redis": False}
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
        checks["database"] = True
    except Exception:
        pass
    checks["redis"] = redis_ready() if settings.redis_url else not settings.production
    status = 200 if all(checks.values()) else 503
    return jsonify({"status": "ready" if status == 200 else "not_ready", "checks": checks}), status


@app.get("/api/auth/me")
def auth_me():
    user_id = session.get("user_id")
    return jsonify({"user": get_user(int(user_id)) if user_id else None, "csrf_token": csrf_token()})


@app.get("/api/auth/status")
def auth_status():
    try:
        user = current_user()
    except PermissionError:
        return jsonify({"user": None, "csrf_token": csrf_token(), "remaining_plans": 0})
    return jsonify(
        {
            "user": user,
            "csrf_token": csrf_token(),
            "remaining_plans": _remaining_daily_plans(user["id"]),
            "planning_enabled": settings.planning_enabled,
        }
    )


@app.post("/api/auth/register")
@limiter.limit("5 per hour")
def auth_register():
    payload = _json_body()
    name = _clean_text(payload.get("name"))
    email = _clean_text(payload.get("email")).lower()
    password = str(payload.get("password") or "")
    if len(name) < 2:
        return jsonify({"error": "Name must be at least 2 characters."}), 400
    if "@" not in email or "." not in email:
        return jsonify({"error": "Enter a valid email address."}), 400
    if len(password) < 10:
        return jsonify({"error": "Password must be at least 10 characters."}), 400
    try:
        user = create_user(name, email, password)
    except ValueError as exc:
        return jsonify({"error": str(exc)}), 409
    session.clear()
    session["user_id"] = user["id"]
    csrf_token()
    if user["status"] == "pending":
        notify_admin_pending_user(name, email)
    return jsonify({"user": user, "approval_required": user["status"] != "active"}), 201


@app.post("/api/auth/login")
@limiter.limit("10 per 15 minutes")
def auth_login():
    payload = _json_body()
    user = authenticate_user(_clean_text(payload.get("email")).lower(), str(payload.get("password") or ""))
    if not user:
        return jsonify({"error": "Invalid email or password."}), 401
    if user["status"] == "rejected":
        return jsonify({"error": "This account is not approved."}), 403
    session.clear()
    session["user_id"] = user["id"]
    csrf_token()
    return jsonify({"user": user, "approval_required": user["status"] != "active"})


@app.post("/api/auth/logout")
def auth_logout():
    session.clear()
    return jsonify({"user": None})


@app.put("/api/auth/password")
def auth_password_change():
    payload = _json_body()
    new_password = str(payload.get("new_password") or "")
    if len(new_password) < 10:
        return jsonify({"error": "New password must be at least 10 characters."}), 400
    try:
        user = current_user()
        change_user_password(user["id"], str(payload.get("current_password") or ""), new_password)
    except (PermissionError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"ok": True})


@app.post("/api/auth/password/request-reset")
@limiter.limit("5 per hour")
def password_reset_request():
    email = _clean_text(_json_body().get("email")).lower()
    token = create_password_reset(email)
    if token:
        send_password_reset(email, token)
    return jsonify({"ok": True, "message": "If the account exists, a reset link was sent."})


@app.post("/api/auth/password/reset")
@limiter.limit("10 per hour")
def password_reset_complete():
    payload = _json_body()
    new_password = str(payload.get("new_password") or "")
    if len(new_password) < 10:
        return jsonify({"error": "New password must be at least 10 characters."}), 400
    if not consume_password_reset(_clean_text(payload.get("token")), new_password):
        return jsonify({"error": "Reset token is invalid or expired."}), 400
    return jsonify({"ok": True})


@app.get("/api/admin/users")
@require_admin
def admin_users():
    return jsonify({"users": list_pending_users()})


@app.post("/api/admin/users/<int:user_id>/approve")
@require_admin
def admin_approve_user(user_id: int):
    return _admin_set_status(user_id, "active")


@app.post("/api/admin/users/<int:user_id>/reject")
@require_admin
def admin_reject_user(user_id: int):
    return _admin_set_status(user_id, "rejected")


@app.get("/api/admin/metrics")
@require_admin
def admin_metrics():
    return jsonify({"metrics": metrics_snapshot()})


@app.get("/api/trips")
@require_active_user
def trips_list():
    user = current_user(require_active=True)
    return jsonify({"trips": list_saved_trips(user["id"])})


@app.post("/api/trips")
@require_active_user
@limiter.limit("30 per hour")
def trips_create():
    user = current_user(require_active=True)
    payload = _json_body()
    for field in ("name", "destination", "dateRange", "form", "itinerary"):
        if field not in payload:
            return jsonify({"error": f"Missing required field: {field}."}), 400
    return jsonify({"trip": create_saved_trip(user["id"], payload)}), 201


@app.delete("/api/trips/<int:trip_id>")
@require_active_user
def trips_delete(trip_id: int):
    user = current_user(require_active=True)
    if not delete_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"ok": True})


@app.delete("/api/account")
def account_delete():
    user = current_user()
    if not delete_user_account(user["id"]):
        return jsonify({"error": "Account not found."}), 404
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/preferences")
@require_active_user
def preferences_get():
    user = current_user(require_active=True)
    return jsonify({"preferences": get_user_preferences(user["id"])})


@app.put("/api/preferences")
@require_active_user
def preferences_put():
    user = current_user(require_active=True)
    return jsonify({"preferences": upsert_user_preferences(user["id"], _json_body())})


@app.post("/api/plan")
def legacy_plan():
    return jsonify({"error": "Use the asynchronous /api/plan-jobs endpoint."}), 410


@app.post("/api/plan-jobs")
@require_active_user
@limiter.limit("10 per hour")
def create_plan_job_route():
    if not settings.planning_enabled:
        return jsonify({"error": "New planning jobs are temporarily disabled."}), 503
    user = current_user(require_active=True)
    if _remaining_daily_plans(user["id"]) <= 0:
        return jsonify({"error": "Daily planning quota reached."}), 429
    if active_job_count(user["id"]) >= settings.concurrent_plans_per_user:
        return jsonify({"error": "A planning job is already running for this account."}), 409
    payload = _json_body()
    travel_inputs = _validate_payload(payload)
    idempotency_key = request.headers.get("Idempotency-Key") or _clean_text(payload.get("idempotency_key"))
    if not idempotency_key:
        return jsonify({"error": "Idempotency-Key header is required."}), 400
    job_id = uuid.uuid4().hex
    job = create_plan_job(job_id, user["id"], idempotency_key[:128], travel_inputs.as_crew_inputs())
    if job["id"] == job_id:
        queue_backend = enqueue_plan_job(job_id, travel_inputs.as_crew_inputs())
    else:
        queue_backend = "existing"
    return jsonify({"job_id": job["id"], "job": job, "queue_backend": queue_backend}), 202


@app.get("/api/plan-jobs")
@require_active_user
def plan_job_history():
    user = current_user(require_active=True)
    return jsonify({"jobs": list_plan_jobs(user["id"])})


@app.get("/api/plan-jobs/<job_id>")
@require_active_user
def get_plan_job_route(job_id: str):
    user = current_user(require_active=True)
    job = get_plan_job(job_id, user["id"])
    if not job:
        return jsonify({"error": "Plan job not found."}), 404
    return jsonify({"job": job})


@app.post("/api/plan-jobs/<job_id>/cancel")
@require_active_user
def cancel_plan_job_route(job_id: str):
    user = current_user(require_active=True)
    if not request_job_cancellation(job_id, user["id"]):
        return jsonify({"error": "Job cannot be cancelled."}), 409
    return jsonify({"ok": True})


@app.patch("/api/plan-jobs/<job_id>/locks")
@require_active_user
def update_plan_job_locks_route(job_id: str):
    user = current_user(require_active=True)
    payload = _json_body()
    job = update_plan_job_locks(
        job_id,
        user["id"],
        locked_hotel_id=payload.get("locked_hotel_id"),
        locked_flight_id=payload.get("locked_flight_id"),
    )
    if not job:
        return jsonify({"error": "Plan job not found or not ready for locks."}), 404
    return jsonify({"job": job})


@app.post("/api/plan-jobs/<job_id>/regenerate-day")
@require_active_user
@limiter.limit("20 per hour")
def regenerate_plan_job_day_route(job_id: str):
    user = current_user(require_active=True)
    payload = _json_body()
    day_number = payload.get("day_number")
    if not isinstance(day_number, int) or isinstance(day_number, bool) or day_number < 1:
        raise ValueError("day_number must be a positive integer.")
    job = get_plan_job(job_id, user["id"])
    if not job:
        return jsonify({"error": "Plan job not found."}), 404
    if job["status"] != "complete":
        return jsonify({"error": "Job must be complete before regenerating a day."}), 409
    days = (job.get("structured_itinerary") or {}).get("days") or []
    if not any(day.get("day_number") == day_number for day in days):
        return jsonify({"error": "Day not found in itinerary."}), 404
    if not begin_day_regeneration(job_id, user["id"]):
        return jsonify({"error": "A regeneration is already running for this job."}), 409
    queue_backend = enqueue_regenerate_day_job(job_id, day_number, job["form"])
    return jsonify({"job_id": job_id, "day_number": day_number, "queue_backend": queue_backend}), 202


@app.post("/api/hotel-options")
@require_active_user
@limiter.limit("20 per day")
def create_hotel_options():
    payload = _json_body()
    travel_inputs = _validate_payload(payload)
    nightly_budget = float(_clean_text(payload.get("nightly_budget")) or 0)
    if nightly_budget <= 0:
        return jsonify({"error": "nightly_budget must be greater than zero."}), 400
    return jsonify(search_hotel_options_with_budget(travel_inputs, nightly_budget))


@app.post("/api/activity-options")
@require_active_user
@limiter.limit("10 per day")
def create_activity_options():
    payload = _json_body()
    travel_inputs = _validate_payload(payload)
    exclude_titles = payload.get("exclude_titles") if isinstance(payload.get("exclude_titles"), list) else []
    return jsonify(
        search_activity_alternatives(
            travel_inputs,
            period=_clean_text(payload.get("period")) or "activity",
            weather_note=_clean_text(payload.get("weather_note")),
            exclude_titles=[str(title) for title in exclude_titles],
        )
    )


@app.post("/api/flight-options")
@require_active_user
@limiter.limit("20 per day")
def create_flight_options():
    payload = _json_body()
    instruction = _clean_text(payload.get("instruction"))
    if not instruction:
        return jsonify({"error": "Missing required field: instruction."}), 400
    return jsonify(search_flight_options_from_instruction(_validate_payload(payload), instruction))


@app.post("/api/flight-booking-options")
@require_active_user
@limiter.limit("20 per day")
def create_flight_booking_options():
    payload = _json_body()
    return jsonify(
        fetch_flight_booking_options(
            _clean_text(payload.get("booking_token")),
            _clean_text(payload.get("currency_code")) or "USD",
        )
    )


@app.post("/api/flight-return-options")
@require_active_user
@limiter.limit("20 per day")
def create_flight_return_options():
    payload = _json_body()
    return jsonify(
        fetch_return_flight_options(
            _clean_text(payload.get("departure_token")),
            _clean_text(payload.get("currency_code")) or "USD",
        )
    )


def _admin_set_status(user_id: int, status: str):
    admin = current_user(require_active=True)
    try:
        user = set_user_status(admin["id"], user_id, status)
    except (PermissionError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 400
    return jsonify({"user": user})


def _remaining_daily_plans(user_id: int) -> int:
    today = datetime.combine(date.today(), time.min, tzinfo=timezone.utc)
    used = completed_jobs_since(user_id, today)
    return max(0, settings.plans_per_day - used)


def _validate_payload(payload: dict[str, Any]) -> TravelInputs:
    origin = _clean_text(payload.get("origin"))
    destination = _clean_text(payload.get("destination"))
    start_date = _clean_text(payload.get("start_date"))
    end_date = _clean_text(payload.get("end_date"))
    budget = _clean_text(payload.get("budget")).replace(",", "").replace("$", "")
    interests = _clean_text(payload.get("interests"))
    currency_code = (_clean_text(payload.get("currency_code")) or "USD").upper()
    adults_raw = _clean_text(payload.get("adults")) or "1"
    missing = [
        field
        for field, value in {
            "origin": origin,
            "destination": destination,
            "start_date": start_date,
            "end_date": end_date,
            "budget": budget,
            "interests": interests,
        }.items()
        if not value
    ]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}.")
    if max(len(origin), len(destination)) > 200 or len(interests) > 1000:
        raise ValueError("Trip input exceeds allowed length.")
    try:
        start = datetime.strptime(start_date, DATE_FORMAT).date()
        end = datetime.strptime(end_date, DATE_FORMAT).date()
    except ValueError as exc:
        raise ValueError("Dates must use YYYY-MM-DD format.") from exc
    trip_days = (end - start).days + 1
    if end <= start:
        raise ValueError("End date must be after start date.")
    if start < date.today():
        raise ValueError("Start date cannot be in the past.")
    if trip_days > settings.max_trip_days:
        raise ValueError(f"Trips are limited to {settings.max_trip_days} days.")
    try:
        amount = Decimal(budget)
        adults = int(adults_raw)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("Budget and adults must be numeric.") from exc
    if amount <= 0 or amount > Decimal("1000000"):
        raise ValueError("Budget must be between 0 and 1,000,000.")
    if not 1 <= adults <= 9:
        raise ValueError("Adults must be between 1 and 9.")
    if len(currency_code) != 3 or not currency_code.isalpha():
        raise ValueError("Currency code must be a 3-letter ISO code.")
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


def _json_body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("Request body must be a JSON object.")
    return payload


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _friendly_error(error: Exception) -> str:
    if isinstance(error, ValueError):
        return str(error)
    lowered = str(error).lower()
    if "quota" in lowered or "429" in lowered:
        return "An external AI provider quota was reached. Try again later."
    if "timeout" in lowered:
        return "An external provider timed out. Try again later."
    return str(error) if not settings.production else "An unexpected server error occurred."


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5052")),
        debug=False,
        use_reloader=False,
    )
