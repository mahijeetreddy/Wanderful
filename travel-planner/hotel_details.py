"""Existing SerpAPI property lookup; no guessed room or cancellation policies.

Provider contract: https://serpapi.com/google-hotels-property-details
"""
import json
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from urllib.parse import urlparse
from data_collector import _cached_provider_call
from tools import _serpapi_get
from offers import offer_metadata, stable_offer_id


def safe_url(value):
    return value if isinstance(value, str) and urlparse(value).scheme == "https" and urlparse(value).netloc else None


def property_details(offer, context):
    token = offer.get("provider_reference")
    if not token:
        return {"status": "unavailable", "message": "Refresh this historical stay to load property details."}
    params = {"engine": "google_hotels", "property_token": token, "q": context.get("destination"),
              "check_in_date": context.get("start_date"), "check_out_date": context.get("end_date"),
              "adults": context.get("adults", 1), "currency": context.get("currency_code", "USD")}
    def fetch():
        return json.dumps({**_serpapi_get(params), "retrieved_at": datetime.now(timezone.utc).isoformat()})
    raw = json.loads(_cached_provider_call("hotels", 3600, params, fetch))
    if not raw.get("name"):
        return {"status": "empty", "message": "No property details were returned."}
    photos = [safe_url(item.get("original_image") or item.get("thumbnail")) for item in raw.get("images", []) if isinstance(item, dict)]
    rates = []
    for source in [*(raw.get("featured_prices") or []), *(raw.get("prices") or [])]:
        if not isinstance(source, dict):
            continue
        for room in (source.get("rooms") or [{}]):
            if not isinstance(room, dict):
                continue
            for rate in (room.get("rates") or [room if room else source]):
                if not isinstance(rate, dict):
                    continue
                # A provider's per-night price is not silently promoted to a full-stay total.
                total = rate.get("total_rate") or {}
                nightly = rate.get("rate_per_night") or {}
                rates.append({"source": source.get("source"), "room_type": room.get("name"),
                    "amount": decimal_amount(total.get("extracted_lowest")),
                    "full_stay_price": total.get("lowest"), "nightly_price": nightly.get("lowest"),
                    "before_taxes_fees": total.get("before_taxes_fees"),
                    "inclusions": [str(value) for value in rate.get("inclusions", [])][:10],
                    "link": safe_url(rate.get("link") or room.get("link") or source.get("link"))})
    unique_rates = list({json.dumps(rate, sort_keys=True): rate for rate in rates}.values())[:20]
    return {"status": "success", "name": raw["name"], "description": raw.get("description"), "address": raw.get("address"),
            "check_in_time": raw.get("check_in_time"), "check_out_time": raw.get("check_out_time"),
            "amenities": [str(item) for item in raw.get("amenities", [])][:30], "images": [photo for photo in photos if photo][:8],
            "rates": unique_rates, "retrieved_at": raw.get("retrieved_at"), "link": safe_url(raw.get("link"))}


def decimal_amount(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        amount = Decimal(str(value))
        return str(amount) if amount.is_finite() and 0 <= amount <= Decimal("1000000000") else None
    except (InvalidOperation, ValueError):
        return None


def snapshot_property_rates(user_id, property_offer, context, details):
    """Materialize provider quotes, never accepting client-supplied prices/policies."""
    from search_service import record_options
    snapshots = []
    selectable = []
    for rate in details.get("rates", []):
        if rate.get("amount") is None or not context.get("currency_code"):
            continue
        # Identity is based on provider evidence, not a list position or price.
        travel_context = {key: context.get(key) for key in ("destination", "start_date", "end_date", "adults", "currency_code")}
        identity = [property_offer.get("provider_reference"), rate.get("source"), rate.get("room_type"), rate.get("inclusions"), rate.get("link"), travel_context]
        hotel = {**property_offer, **offer_metadata("hotel", {"retrieved_at": details.get("retrieved_at"), "search_context": context}),
                 "id": stable_offer_id("hotel-rate", identity), "property_id": property_offer.get("property_id") or property_offer["id"],
                 "room_type": rate.get("room_type"), "rate_source": rate.get("source"), "rate_inclusions": rate.get("inclusions") or [],
                 "price_amount": rate["amount"], "estimated_total": float(rate["amount"]), "currency": context["currency_code"],
                 "price_basis": "provider_stay_total", "nightly_rate": rate.get("nightly_price"), "extracted_nightly_rate": None,
                 "link": rate.get("link"), "rank": None, "rank_score": None, "rank_reasons": []}
        for key in ("snapshot_id", "search_id", "needs_recheck", "kind", "completeness"):
            hotel.pop(key, None)
        snapshots.append(hotel)
        selectable.append(rate)
    if snapshots:
        result = record_options(user_id, "hotels", context, {"hotels": snapshots})
        for rate, snapshot in zip(selectable, result["hotels"]):
            rate["offer"] = snapshot
    return details
