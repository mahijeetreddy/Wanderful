from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from database import session_scope
from models import SearchSession, OfferSnapshot
from offers import classify_result, offer_completeness


def new_search(user_id: int, kind: str, context: dict[str, Any]) -> str:
    if kind not in {"flights", "hotels"}:
        raise ValueError("Choose flights or hotels.")
    search_id = uuid.uuid4().hex
    with session_scope() as db:
        db.add(SearchSession(id=search_id, user_id=user_id, kind=kind, context=context, status="queued", result={}))
    return search_id


def save_search_result(search_id: str, result: dict[str, Any], status: str = "success") -> dict[str, Any]:
    with session_scope() as db:
        search = db.get(SearchSession, search_id)
        if not search:
            raise ValueError("Search not found.")
        offers = []
        for item in result.get(search.kind, []):
            snapshot_id = uuid.uuid4().hex
            offer = {**item, "snapshot_id": snapshot_id, "search_id": search_id, "completeness": offer_completeness(search.kind, item)}
            db.add(OfferSnapshot(id=snapshot_id, search_id=search_id, user_id=search.user_id, kind=search.kind, offer=offer))
            offers.append(offer)
        result = {**result, search.kind: offers}
        # Raw provider payloads can contain sensitive URLs/tokens. Return only normalized data.
        result.pop("provider_result", None)
        search.result = result
        search.status = "empty" if status == "success" and not offers else status
        return {**result, "search_id": search_id, "status": search.status}


def record_options(user_id: int, kind: str, context: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    search_id = new_search(user_id, kind, context)
    status = classify_result(str(result["provider_result"]))["status"] if "provider_result" in result else "success"
    return save_search_result(search_id, result, status)


def read_search(search_id: str, user_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        search = db.scalar(select(SearchSession).where(SearchSession.id == search_id, SearchSession.user_id == user_id))
        return {"id": search.id, "kind": search.kind, "status": search.status, "context": search.context, **search.result} if search else None


def read_offer(snapshot_id: str, user_id: int) -> dict[str, Any] | None:
    with session_scope() as db:
        snapshot = db.scalar(select(OfferSnapshot).where(OfferSnapshot.id == snapshot_id, OfferSnapshot.user_id == user_id))
        if not snapshot:
            return None
        offer = dict(snapshot.offer)
        stale_after = offer.get("stale_after")
        try:
            expiry = datetime.fromisoformat(str(stale_after).replace("Z", "+00:00"))
            offer["needs_recheck"] = expiry.tzinfo is None or expiry <= datetime.now(timezone.utc)
        except (ValueError, TypeError):
            offer["needs_recheck"] = True
        return {"kind": snapshot.kind, **offer}


def execute_search(search_id: str) -> None:
    from data_collector import search_flight_options_from_instruction, search_hotel_options_with_budget
    from main import TravelInputs
    with session_scope() as db:
        search = db.get(SearchSession, search_id)
        if not search:
            return
        search.status = "searching"
        context, kind = dict(search.context), search.kind
    try:
        values = {key: context[key] for key in TravelInputs.__dataclass_fields__ if key in context}
        inputs = TravelInputs(**values)
        force_refresh = context.get("force_refresh") is True
        result = search_flight_options_from_instruction(inputs, "manual flight search", force_refresh=force_refresh) if kind == "flights" else search_hotel_options_with_budget(inputs, float(context["nightly_budget"]) if context.get("nightly_budget") else None, force_refresh=force_refresh)
        status = classify_result(str(result.get("provider_result", "{}")))["status"]
        save_search_result(search_id, result, status)
    except Exception:
        save_search_result(search_id, {"message": "Search failed. Please retry."}, "error")
