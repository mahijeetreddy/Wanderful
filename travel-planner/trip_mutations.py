"""Revision-checked workspace edits; independent trip tools are never overwritten."""
from copy import deepcopy
from datetime import datetime, timezone
import uuid

from sqlalchemy import select
from database import session_scope
from models import SavedTrip, TripSelection, OfferSnapshot, SearchSession, TripShare, TripHistory, TripRecord


class TripRevisionConflict(Exception):
    pass


def check_revision(trip, expected):
    if type(expected) is not int or expected < 1:
        raise ValueError("A positive expected_revision is required. Reopen the saved trip first.")
    if expected != trip.revision:
        raise TripRevisionConflict("This trip changed elsewhere. Your draft is retained; reopen the saved version to reconcile before saving.")


def update_workspace(user_id, trip_id, body):
    from runtime_store import _apply_locked_pricing
    from auth_store import _trip_dict, _selection_dicts
    with session_scope() as db:
        trip = db.scalar(select(SavedTrip).where(SavedTrip.id == trip_id, SavedTrip.user_id == user_id))
        if not trip:
            return None
        check_revision(trip, body.get("expected_revision"))
        previous = {**_trip_dict(trip), "selections": _selection_dicts(db, trip.id)}
        imported = db.get(TripRecord, (trip.id, "legacy-import"))
        if imported and imported.payload.get("currency") != (body.get("form") or {}).get("currency_code", "USD"):
            raise ValueError("A trip with ledger records cannot change currency; no conversion is performed.")
        for key in ("name", "destination", "dateRange", "itinerary"):
            if not isinstance(body.get(key), str):
                raise ValueError(f"{key} must be text.")
        for key in ("form", "options", "structuredItinerary"):
            if not isinstance(body.get(key), dict):
                raise ValueError(f"{key} must be an object.")
        options = deepcopy(body["options"])
        structured = deepcopy(body["structuredItinerary"])
        form = body["form"]
        for kind, lock in (("flights", "locked_flight_id"), ("hotels", "locked_hotel_id")):
            candidates = options.get(kind, [])
            if not isinstance(candidates, list) or any(not isinstance(item, dict) for item in candidates):
                raise ValueError("Offer options must be a list of objects.")
            chosen_id = structured.get(lock)
            chosen = next((item for item in candidates if item.get("id") == chosen_id), None) if chosen_id else None
            selection = db.scalar(select(TripSelection).where(TripSelection.trip_id == trip_id, TripSelection.kind == kind))
            snapshot_id = chosen.get("snapshot_id") if chosen else None
            linked_payments = db.scalars(select(TripRecord).where(TripRecord.trip_id == trip.id, TripRecord.kind == "expense")).all()
            if selection and snapshot_id != selection.snapshot_id and any(row.payload.get("commitment_id") == "booking-" + kind for row in linked_payments):
                raise TripRevisionConflict("This booking has linked payments. Review those payments explicitly before changing the booking.")
            if selection and selection.status == "externally_booked" and snapshot_id != selection.snapshot_id:
                raise TripRevisionConflict("Change the externally booked selection explicitly in booking status before replacing it. Your draft is retained.")
            if chosen_id and not chosen:
                raise ValueError("Selected offer is missing from the workspace.")
            if not chosen:
                if selection:
                    db.delete(selection)
                continue
            if not snapshot_id:
                old = next((item for item in (trip.options_json or {}).get(kind, []) if item.get("id") == chosen_id), None)
                if chosen != old:
                    raise ValueError("Historical offers cannot be changed or replaced by positional IDs. Refresh the search.")
                continue
            snapshot = db.scalar(select(OfferSnapshot).where(OfferSnapshot.id == snapshot_id, OfferSnapshot.user_id == user_id, OfferSnapshot.kind == kind))
            if not snapshot:
                raise ValueError("Selected offer is not available to this account.")
            offer = deepcopy(snapshot.offer)
            if offer.get("id") != chosen_id:
                raise ValueError("Selected offer identity does not match its snapshot.")
            search = db.get(SearchSession, snapshot.search_id)
            for key in ("origin", "destination", "start_date", "end_date", "adults", "currency_code"):
                value = (search.context or {}).get(key)
                if value is not None and str(value) != str(form.get(key)):
                    raise ValueError("Offer search context does not match this trip. Run a matching search first.")
            if offer.get("currency") != form.get("currency_code", "USD"):
                raise ValueError("Offer currency does not match this trip.")
            if kind == "flights" and not offer.get("has_return_details"):
                raise ValueError("Choose a complete outbound and return journey first.")
            offer.update(snapshot_id=snapshot.id, search_id=snapshot.search_id)
            options[kind] = [offer, *[item for item in candidates if item.get("id") != chosen_id]]
            if not selection:
                selection = TripSelection(id=uuid.uuid4().hex, trip_id=trip_id, kind=kind, status="selected", booking_reference="")
                db.add(selection)
            selection.snapshot_id = snapshot.id
        trip.name = body["name"][:200]
        trip.destination = body["destination"][:200]
        trip.date_range = body["dateRange"][:100]
        trip.form_json = form
        trip.itinerary = body["itinerary"]
        trip.options_json = options
        trip.structured_json = _apply_locked_pricing(structured, options)
        trip.result_tab = str(body.get("resultTab") or "overview")[:30]
        trip.updated_at = datetime.now(timezone.utc)
        db.add(TripHistory(trip_id=trip.id, revision=trip.revision, payload=previous))
        db.flush()  # Versioned UPDATE rejects races on both SQLite and PostgreSQL.
        share = db.scalar(select(TripShare).where(TripShare.saved_trip_id == trip_id))
        result = {**_trip_dict(trip, share_token=share.token if share else None), "selections": _selection_dicts(db, trip.id)}
    return result
