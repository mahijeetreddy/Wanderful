"""Connected decisions and individual ledger mutations, always scoped to the owner."""
import hashlib
import json
import re
from copy import deepcopy
from flask import Blueprint, current_app, jsonify, request
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from sqlalchemy import select
from auth_store import get_saved_trip, _trip_dict, _selection_dicts
from security import current_user, require_active_user
from database import session_scope
from models import SavedTrip, TripRecord, TripHistory, TripShare, utcnow
from trip_mutations import check_revision, update_workspace, TripRevisionConflict
from search_service import read_offer
from decisions import impact
from runtime_store import _apply_locked_pricing
from ledger import summary, ensure_imported, validate_record, current_records


def serializer():
    return URLSafeTimedSerializer(current_app.secret_key, salt="wanderful-decision-v1")


def _body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict):
        raise ValueError("Request body must be a JSON object.")
    return value


def _trip(db, identity, owner):
    return db.scalar(select(SavedTrip).where(SavedTrip.id == identity, SavedTrip.user_id == owner))


def _response_trip(db, trip):
    share = db.scalar(select(TripShare).where(TripShare.saved_trip_id == trip.id))
    return {**_trip_dict(trip, share_token=share.token if share else None), "selections": _selection_dicts(db, trip.id)}


def calculate(owner, trip_id, body):
    trip = get_saved_trip(owner, trip_id)
    offer = read_offer(str(body.get("snapshot_id", "")), owner)
    if not trip or not offer:
        return None
    kind = offer.pop("kind")
    if kind not in {"flights", "hotels"}:
        raise ValueError("Unsupported offer.")
    result = impact(trip, offer, kind, body.get("assumptions"))
    options = deepcopy(trip["options"])
    options[kind] = [offer, *[item for item in options.get(kind, []) if item.get("id") != offer["id"]]]
    structured = _apply_locked_pricing(result.pop("structured"), options)
    with session_scope() as db:
        row = _trip(db, trip_id, owner)
        check_revision(row, body.get("expected_revision"))
        if row.revision != trip["revision"]:
            raise TripRevisionConflict("Trip changed during preview. Refresh before previewing again.")
        result["budget_before"] = summary(db, row)
        result["budget_after"] = summary(db, row, structured=structured)
    result.update(expected_revision=trip["revision"], snapshot_id=body["snapshot_id"], kind=kind)
    digest = hashlib.sha256(json.dumps(result, sort_keys=True, default=str).encode()).hexdigest()
    return result, {**trip, "options": options, "structuredItinerary": structured, "expected_revision": trip["revision"]}, digest


def make_workspace_blueprint():
    bp = Blueprint("workspace_mutations", __name__)

    def workspace_preview(owner, trip_id, body):
        trip = get_saved_trip(owner, trip_id)
        if not trip:
            return None
        if type(body.get("expected_revision")) is not int or body["expected_revision"] != trip["revision"]:
            raise TripRevisionConflict("Trip changed elsewhere. Your draft is retained; reconcile before previewing.")
        draft = deepcopy(body)
        structured = draft.get("structuredItinerary")
        options = draft.get("options")
        if not isinstance(structured, dict) or not isinstance(options, dict):
            raise ValueError("Workspace itinerary and options are required.")
        impacts = []
        for kind, lock in (("flights", "locked_flight_id"), ("hotels", "locked_hotel_id")):
            identity = structured.get(lock)
            old_id = trip["structuredItinerary"].get(lock)
            chosen = next((item for item in options.get(kind, []) if item.get("id") == identity), None) if identity else None
            old = next((item for item in trip["options"].get(kind, []) if item.get("id") == old_id), None) if old_id else None
            if identity == old_id and (chosen or {}).get("snapshot_id") == (old or {}).get("snapshot_id"):
                continue
            if identity:
                offer = read_offer(str((chosen or {}).get("snapshot_id", "")), owner)
                if not offer or offer.pop("kind") != kind or offer.get("id") != identity:
                    raise ValueError("Refresh this historical choice before changing its selection.")
                options[kind] = [offer, *[item for item in options.get(kind, []) if item.get("id") != identity]]
            else:
                offer = {"id": "", "currency": trip["form"].get("currency_code", "USD"), "total_price": 0}
            base = {**trip, "structuredItinerary": {**structured, lock: old_id}}
            item = impact(base, offer, kind, body.get("assumptions"))
            structured = item.pop("structured")
            if not identity:
                item["warnings"].append("Clearing a selection restores its planned estimate; it does not cancel a booking.")
            impacts.append(item)
        structured = _apply_locked_pricing(structured, options)
        with session_scope() as db:
            row = _trip(db, trip_id, owner)
            check_revision(row, body["expected_revision"])
            remaining = summary(db, row, structured=structured)
        baseline = impacts[0] if impacts else {"assumptions": {"arrival_buffer_minutes": 120, "departure_buffer_minutes": 180, "destination_timezone": "", "label": "Planning assumptions"}, "activity_windows": {}}
        result = {"currency": remaining["currency"], "expected_revision": trip["revision"], "budget_after": remaining,
            "price_delta_minor": sum(item["price_delta_minor"] for item in impacts) if impacts and all(item["price_delta_minor"] is not None for item in impacts) else None,
            "can_apply": all(item["can_apply"] for item in impacts), "affected_activities": [issue for item in impacts for issue in item["affected_activities"]],
            "warnings": [warning for item in impacts for warning in item["warnings"]], "assumptions": baseline["assumptions"], "activity_windows": baseline["activity_windows"]}
        draft.update(structuredItinerary=structured, options=options)
        digest = hashlib.sha256(json.dumps(result, sort_keys=True, default=str).encode()).hexdigest()
        return result, draft, digest

    @bp.post("/api/trips/<int:trip_id>/decisions/workspace-preview")
    @require_active_user
    def preview_workspace(trip_id):
        owner = current_user()["id"]
        body = _body()
        calculated = workspace_preview(owner, trip_id, body)
        if not calculated:
            return jsonify({"error": "Trip not found."}), 404
        result, _, digest = calculated
        return jsonify({"impact": result, "preview_token": serializer().dumps({"owner": owner, "trip": trip_id, "input": body, "digest": digest, "workspace": True})})

    @bp.post("/api/trips/<int:trip_id>/decisions/preview")
    @require_active_user
    def preview(trip_id):
        owner = current_user()["id"]
        body = _body()
        calculated = calculate(owner, trip_id, body)
        if not calculated:
            return jsonify({"error": "Trip or offer not found."}), 404
        result, _, digest = calculated
        token = serializer().dumps({"owner": owner, "trip": trip_id, "input": body, "digest": digest})
        return jsonify({"impact": result, "preview_token": token})

    @bp.post("/api/trips/<int:trip_id>/decisions/apply")
    @require_active_user
    def apply(trip_id):
        owner = current_user()["id"]
        token = _body().get("preview_token")
        if not isinstance(token, str):
            raise ValueError("Preview token is required.")
        try:
            ticket = serializer().loads(token, max_age=900)
        except (BadSignature, SignatureExpired):
            raise ValueError("Preview expired or invalid. Preview the change again.")
        if ticket.get("owner") != owner or ticket.get("trip") != trip_id:
            return jsonify({"error": "Preview not found."}), 404
        calculated = workspace_preview(owner, trip_id, ticket["input"]) if ticket.get("workspace") else calculate(owner, trip_id, ticket["input"])
        if not calculated:
            return jsonify({"error": "Trip or offer not found."}), 404
        result, body, digest = calculated
        if digest != ticket["digest"]:
            raise TripRevisionConflict("The impact changed. Preview again before applying.")
        if not result["can_apply"]:
            raise TripRevisionConflict("Locked activities conflict with this choice. Resolve them explicitly before applying.")
        updated = update_workspace(owner, trip_id, body)
        return jsonify({"trip": updated, "impact": result})

    @bp.get("/api/trips/<int:trip_id>/ledger")
    @require_active_user
    def get_ledger(trip_id):
        with session_scope() as db:
            trip = _trip(db, trip_id, current_user()["id"])
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            return jsonify({"ledger": summary(db, trip)})

    @bp.post("/api/trips/<int:trip_id>/records")
    @require_active_user
    def add_record(trip_id):
        body = _body()
        identity = body.get("id", "")
        if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9-]{8,100}", identity) or identity.startswith(("legacy-", "member-", "booking-")):
            raise ValueError("Provide a unique client-generated record ID.")
        with session_scope() as db:
            trip = _trip(db, trip_id, current_user()["id"])
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            existing = db.get(TripRecord, (trip_id, identity))
            # Return an identical retry before checking a revision consumed by its first request.
            fingerprint = hashlib.sha256(json.dumps({key: value for key, value in body.items() if key != "expected_revision"}, sort_keys=True).encode()).hexdigest()
            if existing:
                if existing.payload.get("request_hash") != fingerprint:
                    raise TripRevisionConflict("This record ID was already used for different data.")
                return jsonify({"trip": _response_trip(db, trip), "ledger": summary(db, trip)})
            check_revision(trip, body.get("expected_revision"))
            ensure_imported(db, trip)
            value = validate_record(db, trip, body.get("kind"), body)
            value["request_hash"] = fingerprint
            db.add(TripRecord(trip_id=trip.id, id=identity, kind=body["kind"], payload=value))
            trip.updated_at = utcnow()
            db.flush()
            result = {"trip": _response_trip(db, trip), "ledger": summary(db, trip)}
        return jsonify(result), 201

    @bp.delete("/api/trips/<int:trip_id>/records/<record_id>")
    @require_active_user
    def remove_record(trip_id, record_id):
        with session_scope() as db:
            trip = _trip(db, trip_id, current_user()["id"])
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            check_revision(trip, _body().get("expected_revision"))
            ensure_imported(db, trip)
            row = db.get(TripRecord, (trip_id, record_id))
            if not row or row.kind == "migration":
                return jsonify({"error": "Record not found."}), 404
            for item in current_records(db, trip):
                if item.get("commitment_id") == record_id or record_id in [item.get("paid_by_id"), item.get("from_id"), item.get("to_id"), *item.get("split_ids", [])]:
                    raise ValueError("This record is referenced by payments or settlements. Review those records first.")
            db.delete(row)
            trip.updated_at = utcnow()
            db.flush()
            result = {"trip": _response_trip(db, trip), "ledger": summary(db, trip)}
        return jsonify(result)

    @bp.get("/api/trips/<int:trip_id>/history")
    @require_active_user
    def history(trip_id):
        with session_scope() as db:
            trip = _trip(db, trip_id, current_user()["id"])
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            entries = db.scalars(select(TripHistory).where(TripHistory.trip_id == trip_id).order_by(TripHistory.revision.desc()).limit(30)).all()
            return jsonify({"revision": trip.revision, "history": [{"revision": row.revision, "created_at": row.created_at.isoformat(), "days": len((row.payload.get("structuredItinerary") or {}).get("days", []))} for row in entries]})

    @bp.post("/api/trips/<int:trip_id>/undo")
    @require_active_user
    def undo(trip_id):
        owner = current_user()["id"]
        body = _body()
        if type(body.get("target_revision")) is not int or body["target_revision"] < 1:
            raise ValueError("Choose a valid itinerary revision.")
        with session_scope() as db:
            trip = _trip(db, trip_id, owner)
            if not trip:
                return jsonify({"error": "Trip not found."}), 404
            check_revision(trip, body.get("expected_revision"))
            history = db.get(TripHistory, (trip_id, body.get("target_revision")))
            if not history:
                raise ValueError("That itinerary revision is not available.")
            # Never undo recorded money or booking status, only itinerary/selected snapshots.
            restore = {**_trip_dict(trip), **{key: deepcopy(history.payload[key]) for key in ("itinerary", "structuredItinerary", "options")}, "expected_revision": trip.revision}
        return jsonify({"trip": update_workspace(owner, trip_id, restore)})

    return bp
