"""Owner-only product tools. Scenarios and inbox entries never mutate bookings or money."""
from copy import deepcopy
from datetime import date, datetime, timezone
from email import policy
from email.parser import Parser
import hashlib
import json
import re

from flask import Blueprint, jsonify, request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from database import session_scope
from models import SavedTrip, TripRecord, UserPreference, utcnow
from security import current_user, require_active_user
from trip_mutations import check_revision, TripRevisionConflict
from workspace_routes import _response_trip
from auth_store import _trip_dict
from search_service import read_offer, read_search
from decisions import impact
from money import offer_minor, exponent, major
from ledger import summary


DEFAULTS = {"pace": "balanced", "walking": "moderate", "flight_time": "any", "stay_priority": "location", "interests": ""}
CHOICES = {"pace": {"relaxed", "balanced", "packed"}, "walking": {"low", "moderate", "high"}, "flight_time": {"any", "morning", "afternoon", "evening"}, "stay_priority": {"location", "value", "comfort"}}


def clean_preferences(body):
    if not isinstance(body, dict):
        raise ValueError("Preferences must be an object.")
    value = {**DEFAULTS, **{key: body[key] for key in DEFAULTS if key in body}}
    for key, choices in CHOICES.items():
        if not isinstance(value[key], str) or value[key] not in choices:
            raise ValueError(f"Choose a valid {key} preference.")
    value["interests"] = text(value["interests"], 600)
    return value


def preference_prompt(value):
    prefs = clean_preferences(value)
    return f"Traveler preferences (not hard constraints): pace {prefs['pace']}; walking tolerance {prefs['walking']}; preferred flight time {prefs['flight_time']}; stay priority {prefs['stay_priority']}; interests {prefs['interests']}"


def text(value, limit, required=False):
    if not isinstance(value, str) or len(value) > limit:
        raise ValueError(f"Text must be at most {limit} characters.")
    value = value.strip()
    if required and not value:
        raise ValueError("A name is required.")
    return value


def body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise ValueError("A JSON object is required.")
    return value


def owned(db, trip_id):
    return db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == current_user()["id"]))


def iso_day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("Use dates in YYYY-MM-DD format.")
    return date.fromisoformat(value)


def scenario(trip, inputs, owner):
    """Freeze quotes and deterministic impacts. Never infer new-date prices."""
    form = deepcopy(trip.get("form") or {})
    form.update(start_date=inputs.get("start_date", form.get("start_date")), end_date=inputs.get("end_date", form.get("end_date")))
    start, end = iso_day(form["start_date"]), iso_day(form["end_date"])
    if not 0 < (end-start).days <= 90:
        raise ValueError("Choose a trip of 1 to 90 nights.")
    changed_dates = any(form[key] != trip["form"].get(key) for key in ("start_date", "end_date"))
    currency = form.get("currency_code", "USD")
    selected, impacts, prices, baseline = {}, [], [], []
    warnings = ["Historical estimates, not availability or booking confirmation."]
    if changed_dates:
        warnings.append("Dates changed: existing activities are not moved; review their dates. Other trip costs require replanning.")
    for kind, lock in (("flights", "locked_flight_id"), ("hotels", "locked_hotel_id")):
        old = next((item for item in trip.get("options", {}).get(kind, []) if item.get("id") == trip.get("structuredItinerary", {}).get(lock)), None)
        baseline.append(offer_minor(old, currency))
        identity = inputs.get(kind + "_snapshot_id")
        offer = None
        if identity:
            offer = read_offer(text(identity, 100), owner)
            if not offer or offer.pop("kind") != kind:
                raise ValueError("Offer is unavailable to this account.")
            search = read_search(offer["search_id"], owner)
            if not search or any(str(search["context"].get(key)) != str(form.get(key)) for key in ("origin", "destination", "start_date", "end_date", "adults", "currency_code")):
                raise ValueError("Search dates or travelers do not match this scenario.")
            if kind == "flights" and not offer.get("has_return_details"):
                raise ValueError("Use a complete round-trip quote for comparison.")
        elif not changed_dates:
            offer = deepcopy(old)
        selected[kind] = offer
        prices.append(offer_minor(offer, currency))
        if offer:
            result = impact({**trip, "form": form}, offer, kind, inputs.get("assumptions"))
            result.pop("structured")
            impacts.append(result)
            warnings.extend(result["warnings"])
        else:
            warnings.append(f"Choose a matching {kind} quote to complete this estimate.")
    total = sum(prices) if all(value is not None for value in prices) else None
    original = sum(baseline) if all(value is not None for value in baseline) else None
    window = next((item["activity_windows"] for item in impacts if item["activity_windows"]), {})
    hours = None
    if window:
        hours = max(0, (datetime.fromisoformat(window["available_until"]).astimezone(timezone.utc) - datetime.fromisoformat(window["available_from"]).astimezone(timezone.utc)).total_seconds() / 3600)
    return {"name": text(inputs.get("name", "Alternative"), 100, True), "base_revision": trip["revision"], "form": form,
            "selected": selected, "currency": currency, "exponent": exponent(currency), "travel_total_minor": total,
            "baseline_travel_total_minor": original, "delta_minor": total-original if total is not None and original is not None else None,
            "available_hours": hours, "activity_windows": window, "impacts": impacts, "warnings": list(dict.fromkeys(warnings)), "created_at": utcnow().isoformat()}


def extract_confirmation(raw, filename=""):
    raw = text(raw, 100_000, True)
    if filename.lower().endswith(".eml"):
        message = Parser(policy=policy.default).parsestr(raw)
        part = message.get_body(preferencelist=("plain",)) if message.is_multipart() else message
        if not part or part.get_content_type() != "text/plain":
            raise ValueError("This email has no plain-text body. Paste the confirmation text or enter it manually.")
        raw = part.get_content()
    # Deliberately conservative: only explicit labeled fields; no external LLM.
    aliases = {"title": "hotel|property|airline|title", "reference": "booking reference|confirmation number|confirmation|reference|pnr", "start_date": "check-in|check in|departure date|start date|date", "end_date": "check-out|check out|return date|end date", "address": "address|location", "time": "departure time|check-in time|time"}
    result = {key: "" for key in aliases}
    for key, labels in aliases.items():
        match = re.search(rf"(?im)^\s*(?:{labels})\s*:\s*([^\r\n]+)", raw)
        if match:
            result[key] = match[1].strip()[:300 if key == "address" else 120]
    for key in ("start_date", "end_date"):
        try:
            result[key] = iso_day(result[key]).isoformat()
        except ValueError:
            result[key] = ""
    if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", result["time"]):
        result["time"] = ""
    result["kind"] = "stay" if re.search(r"(?i)hotel|check.in|property", raw) else "flight" if re.search(r"(?i)airline|flight|pnr", raw) else "activity"
    return result


def booking(inputs):
    kind = inputs.get("kind")
    if kind not in ("flight", "stay", "activity", "transport", "other"):
        raise ValueError("Choose a booking type.")
    value = {key: text(inputs.get(key, ""), limit, key == "title") for key, limit in (("title", 120), ("reference", 120), ("address", 300), ("start_date", 10), ("end_date", 10), ("time", 5), ("notes", 1000))}
    for key in ("start_date", "end_date"):
        if value[key]: iso_day(value[key])
    if value["end_date"] and (not value["start_date"] or value["end_date"] < value["start_date"]):
        raise ValueError("End date must be on or after the start date.")
    if value["time"] and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value["time"]):
        raise ValueError("Use a valid local time (HH:MM).")
    status = inputs.get("status", "draft")
    if status not in ("draft", "confirmed", "cancelled"):
        raise ValueError("Choose a valid booking status.")
    return {**value, "kind": kind, "status": status, "confirmation_source": "user_recorded", "payment_status": "not_recorded"}


def make_travel_workspace_blueprint():
    bp = Blueprint("travel_workspace", __name__)

    @bp.route("/api/travel-preferences", methods=["GET", "PUT"])
    @require_active_user
    def preferences():
        owner = current_user()["id"]
        with session_scope() as db:
            row = db.get(UserPreference, owner)
            memory = deepcopy(row.memory_json or {}) if row else {}
            current = memory.get("travel_preferences", DEFAULTS)
            revision = memory.get("travel_preferences_revision", 0)
            if request.method == "PUT":
                data = body()
                if type(data.get("expected_revision")) is not int or data["expected_revision"] != revision:
                    raise TripRevisionConflict("Preferences changed elsewhere. Reopen this dialog before saving; your draft is retained.")
                current = clean_preferences(data.get("preferences"))
                revision += 1
                memory.update(travel_preferences=current, travel_preferences_revision=revision)
                if row:
                    changed = db.execute(update(UserPreference).where(UserPreference.user_id == owner, UserPreference.updated_at == row.updated_at).values(memory_json=memory, updated_at=utcnow()))
                    if changed.rowcount != 1:
                        raise TripRevisionConflict("Preferences changed elsewhere. Reopen and try again.")
                else:
                    db.add(UserPreference(user_id=owner, memory_json=memory))
                    try: db.flush()
                    except IntegrityError as exc: raise TripRevisionConflict("Preferences were created elsewhere. Reopen and try again.") from exc
            return jsonify({"preferences": current, "revision": revision})

    @bp.post("/api/trips/<int:trip_id>/booking-inbox/extract")
    @require_active_user
    def extract(trip_id):
        with session_scope() as db:
            if not owned(db, trip_id): return jsonify({"error": "Trip not found."}), 404
        data = body()
        return jsonify({"draft": extract_confirmation(data.get("text"), text(data.get("filename", ""), 240)), "notice": "Review all fields. Unrecognized fields remain blank. Nothing has been saved."})

    @bp.route("/api/trips/<int:trip_id>/travel-tools", methods=["GET", "POST"])
    @require_active_user
    def records(trip_id):
        with session_scope() as db:
            trip = owned(db, trip_id)
            if not trip: return jsonify({"error": "Trip not found."}), 404
            if request.method == "GET":
                rows = db.scalars(select(TripRecord).where(TripRecord.trip_id == trip_id, TripRecord.kind.in_(("scenario", "inbox"))).order_by(TripRecord.created_at)).all()
                return jsonify({"records": [{"id": row.id, "type": row.kind, "data": row.payload["data"]} for row in rows], "revision": trip.revision})
            data = body()
            kind, identity = data.get("type"), data.get("id")
            if kind not in ("scenario", "inbox") or not isinstance(identity, str) or not re.fullmatch(r"tool-[a-zA-Z0-9-]{8,80}", identity):
                raise ValueError("Provide a valid tool type and unique tool ID.")
            fingerprint = hashlib.sha256(json.dumps({key: value for key, value in data.items() if key != "expected_revision"}, sort_keys=True).encode()).hexdigest()
            old = db.get(TripRecord, (trip_id, identity))
            if old and old.payload.get("request_hash") == fingerprint:
                return jsonify({"trip": _response_trip(db, trip), "record": {"id": old.id, "type": old.kind, "data": old.payload["data"]}})
            check_revision(trip, data.get("expected_revision"))
            if old and (old.kind != kind or kind == "scenario"):
                raise TripRevisionConflict("This ID already belongs to a saved record.")
            inputs = data.get("data")
            if not isinstance(inputs, dict): raise ValueError("Record data must be an object.")
            count = len(db.scalars(select(TripRecord.id).where(TripRecord.trip_id == trip_id, TripRecord.kind == kind)).all())
            if not old and count >= (3 if kind == "scenario" else 100):
                raise ValueError("Remove an existing record before adding another.")
            value = scenario(_trip_dict(trip), inputs, current_user()["id"]) if kind == "scenario" else booking(inputs)
            if kind == "scenario":
                # Reuse the exact ledger so recorded commitments/payments are not
                # lost or double-counted when projecting an alternative.
                before = summary(db, trip)
                value["baseline_expected_minor"] = before["expected_minor"]
                value["expected_trip_total_minor"] = None
                value["budget_remaining_minor"] = None
                if value["travel_total_minor"] is not None:
                    structured = deepcopy(trip.structured_json or {})
                    categories = [item for item in structured.get("budget_categories", []) if item.get("category") not in ("Flights", "Hotels")]
                    for category, offer_kind in (("Flights", "flights"), ("Hotels", "hotels")):
                        categories.append({"category": category, "amount": major(offer_minor(value["selected"][offer_kind], value["currency"]), value["currency"])})
                    structured["budget_categories"] = categories
                    projection = summary(db, trip, structured=structured)
                    value["warnings"].extend(projection["warnings"])
                    if not projection["warnings"]:
                        value["expected_trip_total_minor"] = projection["expected_minor"]
                        value["budget_remaining_minor"] = projection["spendable_remaining_minor"]
                    value["warnings"].append("Whole-trip estimate carries forward other planned costs and recorded commitments/payments; remaining budget includes your reserve. Unplanned costs are excluded.")
            if kind == "inbox" and not old and value["reference"]:
                rows = db.scalars(select(TripRecord).where(TripRecord.trip_id == trip_id, TripRecord.kind == "inbox")).all()
                if any(row.payload["data"].get("reference", "").casefold() == value["reference"].casefold() and row.payload["data"].get("kind") == value["kind"] for row in rows):
                    raise ValueError("This reference is already in the inbox. Edit the existing entry.")
            if not old:
                old = TripRecord(trip_id=trip_id, id=identity, kind=kind)
                db.add(old)
            old.payload = {"data": value, "request_hash": fingerprint}
            trip.updated_at = utcnow()
            db.flush()
            return jsonify({"trip": _response_trip(db, trip), "record": {"id": identity, "type": kind, "data": value}})

    @bp.delete("/api/trips/<int:trip_id>/travel-tools/<identity>")
    @require_active_user
    def remove(trip_id, identity):
        with session_scope() as db:
            trip = owned(db, trip_id)
            if not trip: return jsonify({"error": "Trip not found."}), 404
            check_revision(trip, body().get("expected_revision"))
            row = db.get(TripRecord, (trip_id, identity))
            if not row or row.kind not in ("inbox", "scenario"): return jsonify({"error": "Record not found."}), 404
            db.delete(row)
            trip.updated_at = utcnow()
            db.flush()
            return jsonify({"trip": _response_trip(db, trip)})
    return bp
