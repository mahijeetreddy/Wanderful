"""Search/offer routes; adapters keep the legacy planner API compatible."""
import uuid
from flask import Blueprint, jsonify, request
from sqlalchemy import select
from database import session_scope
from models import SavedTrip, TripSelection, OfferSnapshot
from search_service import new_search, read_search, read_offer
from security import current_user, require_active_user


def make_search_blueprint(validate, limiter):
    bp = Blueprint("search", __name__)

    @bp.post("/api/search-sessions")
    @require_active_user
    @limiter.limit("20 per day")
    def create():
        from queue_service import enqueue_search
        body = request.get_json(silent=True) or {}
        inputs = validate(body)
        context = inputs.as_crew_inputs()
        if body.get("nightly_budget"):
            context["nightly_budget"] = max(1, float(body["nightly_budget"]))
        search_id = new_search(current_user()["id"], body.get("kind"), context)
        enqueue_search(search_id)
        return jsonify({"id": search_id, "status": "queued"}), 202

    @bp.get("/api/search-sessions/<search_id>")
    @require_active_user
    def status(search_id):
        search = read_search(search_id, current_user()["id"])
        return (jsonify(search), 200) if search else (jsonify({"error": "Search not found."}), 404)

    @bp.get("/api/offers/<snapshot_id>")
    @require_active_user
    def detail(snapshot_id):
        offer = read_offer(snapshot_id, current_user()["id"])
        return (jsonify({"offer": offer}), 200) if offer else (jsonify({"error": "Offer not found."}), 404)

    @bp.post("/api/offers/<snapshot_id>/recheck")
    @require_active_user
    @limiter.limit("20 per day")
    def recheck(snapshot_id):
        from queue_service import enqueue_search
        user_id = current_user()["id"]
        with session_scope() as db:
            snapshot = db.scalar(select(OfferSnapshot).where(OfferSnapshot.id == snapshot_id, OfferSnapshot.user_id == user_id))
            if not snapshot:
                return jsonify({"error": "Offer not found."}), 404
            original = read_search(snapshot.search_id, user_id)
            kind = snapshot.kind
        search_id = new_search(user_id, kind, {**original["context"], "force_refresh": True})
        enqueue_search(search_id)
        return jsonify({"id": search_id, "status": "queued", "previous_snapshot_id": snapshot_id}), 202

    @bp.get("/api/offers/<snapshot_id>/property-details")
    @require_active_user
    @limiter.limit("40 per hour")
    def hotel_property(snapshot_id):
        from hotel_details import property_details, snapshot_property_rates
        from requests.exceptions import Timeout
        user_id = current_user()["id"]
        offer = read_offer(snapshot_id, user_id)
        if not offer or offer["kind"] != "hotels":
            return jsonify({"error": "Stay not found."}), 404
        original = read_search(offer["search_id"], user_id)
        try:
            details = property_details(offer, original["context"])
            return jsonify(snapshot_property_rates(user_id, offer, original["context"], details))
        except Timeout:
            return jsonify({"status": "timeout", "message": "Property lookup took too long. Please retry."}), 504
        except Exception:
            return jsonify({"status": "error", "message": "Property details are unavailable. Please retry later."}), 502

    @bp.put("/api/trips/<int:trip_id>/selection")
    @require_active_user
    def select_offer(trip_id):
        from runtime_store import _apply_locked_pricing
        body = request.get_json(silent=True) or {}
        user_id = current_user()["id"]
        offer = read_offer(str(body.get("snapshot_id", "")), user_id)
        if not offer:
            return jsonify({"error": "Offer not found."}), 404
        state = body.get("status", "selected")
        if state not in {"selected", "externally_booked"}:
            raise ValueError("Payments must be recorded separately from selections.")
        kind = offer.pop("kind")
        if kind == "flights" and not offer.get("has_return_details"):
            raise ValueError("Choose a complete outbound and return journey first.")
        with session_scope() as db:
            trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id).with_for_update())
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            currency = (trip.form_json or {}).get("currency_code", "USD")
            if offer.get("currency") != currency:
                raise ValueError("Offer currency does not match this trip.")
            snapshot = db.get(OfferSnapshot, body["snapshot_id"])
            original = read_search(snapshot.search_id, user_id)
            context = original["context"] if original else {}
            for key in ("start_date", "end_date", "adults"):
                expected = (trip.form_json or {}).get(key)
                if context.get(key) is not None and expected is not None and str(context[key]) != str(expected):
                    raise ValueError("Offer dates or traveler count do not match this trip. Run a matching search first.")
            selected = db.scalar(select(TripSelection).where(TripSelection.trip_id == trip_id, TripSelection.kind == kind))
            if "expected_snapshot_id" in body and body["expected_snapshot_id"] != (selected.snapshot_id if selected else None):
                return jsonify({"error": "This selection changed elsewhere. Reopen the trip before saving; your draft has not been applied."}), 409
            if not selected:
                selected = TripSelection(id=uuid.uuid4().hex, trip_id=trip_id, kind=kind)
                db.add(selected)
            selected.snapshot_id = body["snapshot_id"]
            selected.status = state
            selected.booking_reference = str(body.get("booking_reference", ""))[:160] if state == "externally_booked" else ""
            options = dict(trip.options_json or {})
            options[kind] = [offer, *[item for item in options.get(kind, []) if item["id"] != offer["id"]]]
            structured = dict(trip.structured_json or {})
            structured["locked_flight_id" if kind == "flights" else "locked_hotel_id"] = offer["id"]
            trip.options_json = options
            trip.structured_json = _apply_locked_pricing(structured, options)
        from auth_store import get_saved_trip
        return jsonify({"trip": get_saved_trip(user_id, trip_id)})

    return bp
