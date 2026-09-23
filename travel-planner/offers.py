"""Provider-neutral offer identity and result classification.

Identities describe the journey/property, never its list position or current price.
Snapshots preserve provider evidence; missing fare/room conditions remain unknown.
"""
from __future__ import annotations

import hashlib
import json
from decimal import Decimal, InvalidOperation
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, TypedDict

ProviderStatus = Literal["success", "empty", "unavailable", "timeout", "error"]


class ProviderResult(TypedDict):
    status: ProviderStatus
    data: dict[str, Any]
    message: str


def classify_result(raw: str) -> ProviderResult:
    try:
        data = json.loads(raw)
    except (ValueError, TypeError):
        data = None
    if isinstance(data, dict):
        if data.get("error"):
            return {"status": "error", "data": {}, "message": "Search provider failed. Retry this search."}
        return {"status": "success", "data": data, "message": ""}
    message = str(raw).lower()
    status: ProviderStatus = "error"
    if "timeout" in message or "timed out" in message:
        status = "timeout"
    elif "unavailable" in message or "set serpapi" in message or "set openweather" in message:
        status = "unavailable"
    elif message.startswith("no "):
        status = "empty"
    return {"status": status, "data": {}, "message": {
        "error": "Search provider failed. Retry this search.",
        "timeout": "This search took too long. Try again.",
        "unavailable": "This search is currently unavailable.",
        "empty": "No matching options were returned.",
    }[status]}


def stable_offer_id(kind: str, identity: Any) -> str:
    encoded = json.dumps(identity, sort_keys=True, separators=(",", ":"), default=str)
    return f"{kind}-" + hashlib.sha256(encoded.encode()).hexdigest()[:24]


def offer_completeness(kind: str, offer: dict[str, Any]) -> dict[str, Any]:
    """Report missing evidence, without inventing room, fare, or tax policies."""
    missing = []
    price = offer.get("total_price" if kind == "flights" else "estimated_total")
    try:
        amount = Decimal(str(price))
        priced = amount.is_finite() and amount >= 0
    except (InvalidOperation, ValueError):
        priced = False
    if not priced or not offer.get("currency"):
        missing.append("price")
    if kind == "flights":
        if not offer.get("has_return_details"):
            missing.append("return_journey")
        if not offer.get("segments") or any(not segment.get("depart_at") or not segment.get("arrive_at") for segment in offer.get("segments", [])):
            missing.append("flight_times")
        if offer.get("baggage") is None:
            missing.append("baggage")
    elif not offer.get("room_type"):
        missing.append("room_type")
    if offer.get("taxes_included") is None:
        missing.append("taxes")
    if offer.get("cancellation_policy") is None:
        missing.append("cancellation_policy")
    return {"status": "partial" if missing else "complete", "missing_fields": missing}


def offer_metadata(kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    retrieved = payload.get("retrieved_at")
    # Old cached data has no reliable age. Never relabel it as newly retrieved.
    stale_after = None
    if retrieved:
        try:
            stamp = datetime.fromisoformat(str(retrieved).replace("Z", "+00:00"))
            if stamp.tzinfo is None:
                raise ValueError("Retrieval timestamp must include a timezone")
            stale_after = (stamp + timedelta(minutes=30 if kind == "flight" else 60)).isoformat()
        except ValueError:
            retrieved = None
    return {
        "provider": "serpapi",
        "retrieved_at": retrieved,
        "stale_after": stale_after,
        "expires_at": None,
        "search_context": payload.get("search_context") or {},
        "freshness": "snapshot" if retrieved else "historical",
        "price_basis": "traveler_total" if kind == "flight" else "estimated_stay_total",
        "taxes_included": None,
        "cancellation_policy": None,
    }
