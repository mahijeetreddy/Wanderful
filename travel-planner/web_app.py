from __future__ import annotations

import logging
import os
import secrets
import sys
import time as monotonic_time
import uuid
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from dataclasses import replace
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
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
import requests
from flask import Flask, g, jsonify, render_template, request, send_file, send_from_directory, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from sqlalchemy import text

from auth_store import (
    apply_disruption_scenario,
    apply_trip_adjustment,
    authenticate_user,
    change_user_password,
    consume_password_reset,
    create_journal_entry,
    create_password_reset,
    create_saved_trip,
    create_travel_document,
    create_user,
    delete_journal_entry,
    delete_user_account,
    delete_saved_trip,
    delete_travel_document,
    disable_trip_sharing,
    enable_trip_sharing,
    get_public_trip_by_share_token,
    get_saved_trip,
    get_travel_document,
    get_user,
    get_user_preferences,
    init_auth_store,
    list_journal_entries,
    list_pending_users,
    list_saved_trips,
    list_travel_documents,
    record_activity_feedback,
    set_user_status,
    update_journal_entry,
    update_trip_budget,
    update_trip_constraints,
    upsert_user_preferences,
)
from config import settings, validate_production_settings
from data_collector import (
    search_activity_alternatives,
    search_flight_options_from_instruction,
    search_hotel_options_with_budget,
)
from database import engine
from email_service import notify_admin_pending_user, send_password_reset
from guidebook_store import create_or_reset_guidebook, get_guidebook
from main import DATE_FORMAT, TravelInputs
from observability import configure_json_logging
from queue_service import enqueue_guidebook_job, enqueue_plan_job, enqueue_regenerate_day_job
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
from trip_intelligence import (
    assess_trip,
    build_budget_guardian,
    build_disruption_scenarios,
    build_live_view,
    build_offline_pack,
    learned_preference_tags,
    normalize_budget_state,
    preview_adjustment,
)


configure_json_logging()
logger = logging.getLogger("wanderful.api")
validate_production_settings(settings)

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
    MAX_CONTENT_LENGTH=10_000_000,
)
from vault_storage import configured_vault
vault_storage = configured_vault(production=settings.production)
ALLOWED_DOCUMENT_TYPES = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
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
    if request.path.startswith("/api/auth/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
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
@app.get("/offline")
@app.get("/index.html")
def index():
    if Path("dist/index.html").exists():
        return send_from_directory("dist", "index.html")
    return render_template("index.html")


@app.get("/sw.js")
@app.get("/manifest.webmanifest")
def offline_public_asset():
    filename = request.path.lstrip("/")
    response = send_from_directory("dist", filename)
    response.headers["Cache-Control"] = "no-cache"
    if filename == "sw.js":
        response.headers["Service-Worker-Allowed"] = "/"
        response.headers["Content-Type"] = "application/javascript"
    return response


@app.get("/assets/<path:filename>")
def vite_assets(filename: str):
    return send_from_directory("dist/assets", filename)


@app.get("/health/live")
def health_live():
    return jsonify({"status": "ok"})


@app.get("/health/ready")
def health_ready():
    checks = {"database": False, "schema": False, "redis": False}
    try:
        with engine.connect() as connection:
            connection.execute(text("select 1"))
            current_revision = MigrationContext.configure(connection).get_current_revision()
        expected_revision = ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()
        checks["database"] = True
        checks["schema"] = current_revision == expected_revision
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


from sqlalchemy.orm.exc import StaleDataError
from trip_mutations import TripRevisionConflict, update_workspace


@app.errorhandler(TripRevisionConflict)
@app.errorhandler(StaleDataError)
def trip_revision_conflict(error):
    message = str(error) if isinstance(error, TripRevisionConflict) else "This trip changed while saving. Your draft is retained; reopen the saved version to reconcile."
    return jsonify({"error": message, "code": "revision_conflict"}), 409


@app.put("/api/trips/<int:trip_id>")
@require_active_user
def trips_update(trip_id):
    trip = update_workspace(current_user(require_active=True)["id"], trip_id, _json_body())
    return (jsonify({"trip": trip}), 200) if trip else (jsonify({"error": "Saved trip not found."}), 404)


@app.delete("/api/trips/<int:trip_id>")
@require_active_user
def trips_delete(trip_id: int):
    user = current_user(require_active=True)
    if not delete_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"ok": True})


@app.get("/api/trips/<int:trip_id>/intelligence")
@require_active_user
def trip_intelligence_get(trip_id: int):
    user = current_user(require_active=True)
    trip = get_saved_trip(user["id"], trip_id)
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify(
        {
            "health": assess_trip(trip),
            "live": build_live_view(trip),
            "constraints": trip.get("constraints") or {},
            "live_state": trip.get("liveState") or {},
            "budget": build_budget_guardian(trip),
            "disruption_history": trip.get("disruptionHistory") or [],
        }
    )


@app.put("/api/trips/<int:trip_id>/budget")
@require_active_user
@limiter.limit("120 per hour")
def trip_budget_put(trip_id: int):
    user = current_user(require_active=True)
    if not get_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    body = _json_body()
    expected = _required_revision(body)
    state = normalize_budget_state(body)
    trip = update_trip_budget(user["id"], trip_id, state, expected)
    return jsonify({"trip": trip, "budget": build_budget_guardian(trip or {})})


@app.get("/api/trips/<int:trip_id>/documents")
@require_active_user
def trip_documents_get(trip_id: int):
    user = current_user(require_active=True)
    if not get_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    documents = list_travel_documents(user["id"], trip_id)
    return jsonify({"documents": [{key: value for key, value in document.items() if key != "storage_name"} for document in documents]})


@app.post("/api/trips/<int:trip_id>/documents")
@require_active_user
@limiter.limit("30 per hour")
def trip_documents_post(trip_id: int):
    user = current_user(require_active=True)
    if not get_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"error": "Choose a PDF or image to upload."}), 400
    content = upload.read(8_000_001)
    if not content:
        return jsonify({"error": "The selected file is empty."}), 400
    if len(content) > 8_000_000:
        return jsonify({"error": "Documents must be 8 MB or smaller."}), 400
    mime_type = _document_mime_type(content, upload.mimetype)
    if mime_type not in ALLOWED_DOCUMENT_TYPES:
        return jsonify({"error": "Only PDF, JPG, PNG, and WebP files are supported."}), 400
    extension = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime_type]
    storage_name = f"{user['id']}-{trip_id}-{uuid.uuid4().hex}{extension}"
    vault_storage.put(storage_name, content)
    try:
        document = create_travel_document(user["id"], trip_id, {
            "name": Path(upload.filename).name,
            "category": _clean_text(request.form.get("category")) or "Other",
            "mime_type": mime_type,
            "size_bytes": len(content),
            "storage_name": storage_name,
            "expires_on": _clean_text(request.form.get("expires_on")),
        })
    except Exception:
        vault_storage.delete(storage_name)
        raise
    return jsonify({"document": {key: value for key, value in document.items() if key != "storage_name"}}), 201


@app.get("/api/trips/<int:trip_id>/documents/<document_id>/download")
@require_active_user
def trip_document_download(trip_id: int, document_id: str):
    user = current_user(require_active=True)
    document = get_travel_document(user["id"], trip_id, document_id)
    if not document:
        return jsonify({"error": "Document not found."}), 404
    target = vault_storage.path(document["storage_name"])
    if not target.is_file():
        return jsonify({"error": "Document file is unavailable."}), 404
    response = send_file(target, mimetype=document["mime_type"], as_attachment=True, download_name=document["name"], conditional=False)
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.delete("/api/trips/<int:trip_id>/documents/<document_id>")
@require_active_user
def trip_document_delete(trip_id: int, document_id: str):
    user = current_user(require_active=True)
    document = get_travel_document(user["id"], trip_id, document_id)
    if not document:
        return jsonify({"error": "Document not found."}), 404
    try:
        vault_storage.delete(document["storage_name"])
    except PermissionError:
        return jsonify({"error": "Document is currently open. Close the download and try again."}), 409
    delete_travel_document(user["id"], trip_id, document_id)
    return jsonify({"ok": True})


@app.post("/api/route-map")
@require_active_user
@limiter.limit("60 per hour")
def route_map_post():
    payload = _json_body()
    destination = _clean_text(payload.get("destination"))[:160]
    raw_stops = payload.get("stops") if isinstance(payload.get("stops"), list) else []
    stops = []
    for index, stop in enumerate(raw_stops[:8]):
        if not isinstance(stop, dict):
            continue
        title = _clean_text(stop.get("title"))[:160]
        location = _clean_text(stop.get("location"))[:180]
        if title or location:
            stops.append({"index": index, "title": title or location, "location": location or title})
    if not destination or not stops:
        return jsonify({"error": "Destination and at least one stop are required."}), 400
    with ThreadPoolExecutor(max_workers=min(4, len(stops))) as executor:
        from places import lookup_place
        coordinates = list(executor.map(lambda stop: lookup_place(stop, destination), stops))
    resolved = [{**stop, **point} for stop, point in zip(stops, coordinates) if point]
    return jsonify({"stops": resolved, "unresolved": len(stops) - len(resolved)})


@app.get("/api/trips/<int:trip_id>/offline-pack")
@require_active_user
def trip_offline_pack_get(trip_id: int):
    user = current_user(require_active=True)
    trip = get_saved_trip(user["id"], trip_id)
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"pack": {**build_offline_pack(trip), "owner_id": user["id"]}})


@app.post("/api/trips/<int:trip_id>/disruptions")
@require_active_user
@limiter.limit("60 per hour")
def trip_disruption_post(trip_id: int):
    user = current_user(require_active=True)
    trip = get_saved_trip(user["id"], trip_id)
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    payload = _json_body()
    event = _clean_text(payload.get("event"))
    day_number = payload.get("day_number")
    if day_number is not None and (not isinstance(day_number, int) or isinstance(day_number, bool)):
        raise ValueError("day_number must be an integer.")
    scenarios = build_disruption_scenarios(trip, event, day_number)
    strategy = _clean_text(payload.get("strategy"))
    if not bool(payload.get("apply")):
        return jsonify({"scenarios": [{key: value for key, value in scenario.items() if key != "structuredItinerary"} for scenario in scenarios]})
    selected = next((scenario for scenario in scenarios if scenario["strategy"] == strategy), None)
    if selected is None:
        raise ValueError("Choose a valid disruption scenario.")
    applied_at = datetime.now(timezone.utc).isoformat()
    live_state = {
        "last_event": event,
        "strategy": strategy,
        "day_number": selected["day_number"],
        "applied_at": applied_at,
        "changes": selected["changes"],
    }
    history_entry = {
        "event": event,
        "strategy": strategy,
        "title": selected["title"],
        "changes": selected["changes"],
        "cost_delta": selected["cost_delta"],
        "applied_at": applied_at,
    }
    updated = apply_disruption_scenario(
        user["id"], trip_id, selected["structuredItinerary"], live_state, history_entry, _required_revision(payload)
    )
    return jsonify({
        "trip": updated,
        "health": assess_trip(updated or trip),
        "live": build_live_view(updated or trip),
        "budget": build_budget_guardian(updated or trip),
    })


@app.put("/api/trips/<int:trip_id>/constraints")
@require_active_user
def trip_constraints_put(trip_id: int):
    user = current_user(require_active=True)
    body = _json_body()
    constraints = body.get("constraints")
    if not isinstance(constraints, dict):
        raise ValueError("constraints must be an object.")
    if len(constraints) > 500:
        raise ValueError("A trip cannot contain more than 500 activity constraints.")
    trip = update_trip_constraints(user["id"], trip_id, constraints, _required_revision(body))
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"trip": trip, "health": assess_trip(trip)})


@app.post("/api/trips/<int:trip_id>/live-adjust")
@require_active_user
@limiter.limit("30 per hour")
def trip_live_adjust(trip_id: int):
    user = current_user(require_active=True)
    trip = get_saved_trip(user["id"], trip_id)
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    payload = _json_body()
    day_number = payload.get("day_number")
    if day_number is not None and (not isinstance(day_number, int) or isinstance(day_number, bool)):
        raise ValueError("day_number must be an integer.")
    preview = preview_adjustment(trip, _clean_text(payload.get("event")), day_number)
    if not bool(payload.get("apply")):
        return jsonify({"preview": preview})
    live_state = {
        "last_event": preview["event"],
        "day_number": preview["day_number"],
        "applied_at": datetime.now(timezone.utc).isoformat(),
        "changes": preview["changes"],
    }
    updated = apply_trip_adjustment(
        user["id"], trip_id, preview["structuredItinerary"], live_state, _required_revision(payload)
    )
    return jsonify(
        {
            "trip": updated,
            "health": assess_trip(updated or trip),
            "live": build_live_view(updated or trip),
        }
    )


@app.post("/api/trips/<int:trip_id>/feedback")
@require_active_user
@limiter.limit("120 per hour")
def trip_feedback_create(trip_id: int):
    user = current_user(require_active=True)
    if not get_saved_trip(user["id"], trip_id):
        return jsonify({"error": "Saved trip not found."}), 404
    payload = _json_body()
    if not _clean_text(payload.get("title")):
        raise ValueError("Feedback title is required.")
    preferences = record_activity_feedback(user["id"], payload)
    return jsonify({"preferences": preferences}), 201


@app.get("/api/trips/<int:trip_id>/journal")
@require_active_user
def journal_list(trip_id: int):
    user = current_user(require_active=True)
    entries = list_journal_entries(user["id"], trip_id)
    if entries is None:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"entries": entries})


@app.post("/api/trips/<int:trip_id>/journal")
@require_active_user
@limiter.limit("60 per hour")
def journal_create(trip_id: int):
    user = current_user(require_active=True)
    payload = _json_body()
    body = str(payload.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Journal entry body is required."}), 400
    entry = create_journal_entry(user["id"], trip_id, body[:10000])
    if entry is None:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify({"entry": entry}), 201


@app.patch("/api/trips/<int:trip_id>/journal/<int:entry_id>")
@require_active_user
def journal_update(trip_id: int, entry_id: int):
    user = current_user(require_active=True)
    payload = _json_body()
    body = str(payload.get("body") or "").strip()
    if not body:
        return jsonify({"error": "Journal entry body is required."}), 400
    entry = update_journal_entry(user["id"], trip_id, entry_id, body[:10000])
    if entry is None:
        return jsonify({"error": "Journal entry not found."}), 404
    return jsonify({"entry": entry})


@app.delete("/api/trips/<int:trip_id>/journal/<int:entry_id>")
@require_active_user
def journal_delete(trip_id: int, entry_id: int):
    user = current_user(require_active=True)
    if not delete_journal_entry(user["id"], trip_id, entry_id):
        return jsonify({"error": "Journal entry not found."}), 404
    return jsonify({"ok": True})


@app.get("/api/trips/<int:trip_id>/guidebook")
@require_active_user
def guidebook_get(trip_id: int):
    user = current_user(require_active=True)
    guidebook = get_guidebook(user["id"], trip_id)
    if guidebook is None:
        return jsonify({"error": "Guidebook not found."}), 404
    return jsonify({"guidebook": guidebook})


@app.post("/api/trips/<int:trip_id>/guidebook")
@require_active_user
@limiter.limit("10 per hour")
def guidebook_generate(trip_id: int):
    user = current_user(require_active=True)
    trip = get_saved_trip(user["id"], trip_id)
    if not trip:
        return jsonify({"error": "Saved trip not found."}), 404
    guidebook = create_or_reset_guidebook(user["id"], trip_id)
    if guidebook is None:
        return jsonify({"error": "Saved trip not found."}), 404
    form = trip.get("form") or {}
    enqueue_guidebook_job(
        guidebook["id"],
        trip.get("destination", ""),
        str(form.get("start_date") or ""),
        str(form.get("end_date") or ""),
        str(form.get("interests") or ""),
    )
    return jsonify({"guidebook": guidebook}), 202


@app.post("/api/trips/<int:trip_id>/share")
@require_active_user
def trip_share_enable(trip_id: int):
    user = current_user(require_active=True)
    result = enable_trip_sharing(user["id"], trip_id)
    if result is None:
        return jsonify({"error": "Saved trip not found."}), 404
    return jsonify(result)


@app.delete("/api/trips/<int:trip_id>/share")
@require_active_user
def trip_share_disable(trip_id: int):
    user = current_user(require_active=True)
    if not disable_trip_sharing(user["id"], trip_id):
        return jsonify({"error": "Trip is not currently shared."}), 404
    return jsonify({"ok": True})


@app.get("/api/share/<token>")
@limiter.limit("120 per hour")
def public_shared_trip(token: str):
    trip = get_public_trip_by_share_token(token)
    if not trip:
        return jsonify({"error": "This share link is invalid or no longer active."}), 404
    return jsonify({"trip": trip})


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
    learned_tags = learned_preference_tags(get_user_preferences(user["id"]).get("memory") or {})
    if learned_tags:
        travel_inputs = replace(
            travel_inputs,
            interests=f"{travel_inputs.interests}; learned preferences: {', '.join(learned_tags)}",
        )
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
        snapshot_ids=payload.get("snapshot_ids") if isinstance(payload.get("snapshot_ids"), list) else [],
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
    from search_service import record_options
    return jsonify(record_options(current_user()["id"], "hotels", travel_inputs.as_crew_inputs(), search_hotel_options_with_budget(travel_inputs, nightly_budget)))


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
    from search_service import record_options
    inputs = _validate_payload(payload)
    return jsonify(record_options(current_user()["id"], "flights", inputs.as_crew_inputs(), search_flight_options_from_instruction(inputs, instruction)))


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
    if payload.get("snapshot_id"):
        from search_service import read_offer, read_search, record_options
        from offers import stable_offer_id
        user_id = current_user()["id"]
        outbound = read_offer(str(payload["snapshot_id"]), user_id)
        if not outbound or outbound["kind"] != "flights":
            return jsonify({"error": "Outbound offer not found."}), 404
        result = fetch_return_flight_options(outbound.get("departure_token", ""), outbound.get("currency", "USD"))
        completed = []
        for inbound in result.get("return_options", []):
            segments = [*(outbound.get("segments") or []), *(inbound.get("segments") or [])]
            completed.append({**outbound, **inbound,
                "id": stable_offer_id("flight", [segments, outbound.get("search_context")]),
                "segments": segments,
                "total_duration_minutes": outbound["total_duration_minutes"] + inbound["total_duration_minutes"] if isinstance(outbound.get("total_duration_minutes"), (int, float)) and isinstance(inbound.get("total_duration_minutes"), (int, float)) else None,
                "outbound_duration_minutes": outbound.get("total_duration_minutes"),
                "return_duration_minutes": inbound.get("total_duration_minutes"),
                "layovers": [*(outbound.get("layovers") or []), *(inbound.get("layovers") or [])],
                "has_return_details": True, "outbound_segment_count": len(outbound.get("segments") or [])})
        search = read_search(outbound["search_id"], user_id)
        saved = record_options(user_id, "flights", search["context"], {"flights": completed})
        return jsonify({"return_options": saved["flights"]})
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


def _document_mime_type(content: bytes, _claimed: str | None) -> str:
    if content.startswith(b"%PDF-"):
        return "application/pdf"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return "image/webp"
    return ""


@lru_cache(maxsize=800)
def _geocode_place(query: str) -> dict[str, float] | None:
    api_key = os.getenv("OPENWEATHER_API_KEY", "").strip()
    if not api_key:
        return None
    try:
        response = requests.get(
            "https://api.openweathermap.org/geo/1.0/direct",
            params={"q": query, "limit": 1, "appid": api_key},
            timeout=7,
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, list) and payload:
            return {"lat": round(float(payload[0]["lat"]), 6), "lng": round(float(payload[0]["lon"]), 6)}
    except (requests.RequestException, KeyError, TypeError, ValueError):
        logger.warning("Route stop geocoding failed", extra={"query": query})
    return None


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _required_revision(body):
    value = body.get("expected_revision")
    if type(value) is not int or value < 1:
        raise ValueError("A positive expected_revision is required. Refresh the saved trip first.")
    return value


def _friendly_error(error: Exception) -> str:
    if isinstance(error, ValueError):
        return str(error)
    lowered = str(error).lower()
    if "quota" in lowered or "429" in lowered:
        return "An external AI provider quota was reached. Try again later."
    if "timeout" in lowered:
        return "An external provider timed out. Try again later."
    return str(error) if not settings.production else "An unexpected server error occurred."


from search_routes import make_search_blueprint
app.register_blueprint(make_search_blueprint(_validate_payload, limiter))
from workspace_routes import make_workspace_blueprint
app.register_blueprint(make_workspace_blueprint())


if __name__ == "__main__":
    app.run(
        host="127.0.0.1",
        port=int(os.getenv("PORT", "5052")),
        debug=False,
        use_reloader=False,
    )
