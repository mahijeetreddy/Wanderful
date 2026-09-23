"""Deterministic, evidence-bounded selection impacts. No provider or LLM requests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from math import radians, sin, cos, asin, sqrt
import re

from money import offer_minor
from trip_intelligence import activity_key


def airport_time(value, zone):
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if zone:
            target = ZoneInfo(zone)
            if parsed.tzinfo:
                return parsed.astimezone(target)
            candidate = parsed.replace(tzinfo=target)
            # Missing and repeated DST wall-clock times need user/provider clarification.
            if candidate.utcoffset() != parsed.replace(tzinfo=target, fold=1).utcoffset():
                return None
            if candidate.astimezone(timezone.utc).astimezone(target).replace(tzinfo=None) != parsed:
                return None
            return candidate
        return parsed if parsed.tzinfo else None
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return None


def valid_point(value):
    return isinstance(value, dict) and all(isinstance(value.get(key), (int, float)) and not isinstance(value.get(key), bool) and abs(value[key]) <= limit for key, limit in (("lat", 90), ("lng", 180)))


def proximity(offer, structured):
    point = offer.get("coordinates")
    if not valid_point(point):
        return None
    distances = []
    for day in structured.get("days", []):
        for activity in day.get("activities", []):
            other = activity.get("coordinates")
            if not valid_point(other) or not activity.get("source_url"):
                continue
            lat1, lat2 = radians(point["lat"]), radians(other["lat"])
            distance = sin((lat2-lat1)/2)**2 + cos(lat1)*cos(lat2)*sin(radians(other["lng"]-point["lng"])/2)**2
            distances.append(6371 * 2 * asin(sqrt(min(1, distance))))
    return {"mean_km": round(sum(distances)/len(distances), 2), "places": len(distances), "basis": "Straight-line estimate, not walking or transit time"} if distances else None


def impact(trip, offer, kind, assumptions=None):
    assumptions = assumptions or {}
    buffers = {"arrival_buffer_minutes": assumptions.get("arrival_buffer_minutes", 120), "departure_buffer_minutes": assumptions.get("departure_buffer_minutes", 180)}
    if any(type(value) is not int or not 0 <= value <= 720 for value in buffers.values()):
        raise ValueError("Transfer/check-in buffers must be whole minutes between 0 and 720.")
    zone = assumptions.get("destination_timezone") or trip.get("form", {}).get("destination_timezone") or ""
    if zone:
        try:
            ZoneInfo(zone)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("Use a valid IANA destination time zone, such as Europe/Lisbon.")
    structured = deepcopy(trip.get("structuredItinerary") or {})
    currency = trip.get("form", {}).get("currency_code", "USD")
    lock = "locked_flight_id" if kind == "flights" else "locked_hotel_id"
    previous = next((item for item in trip.get("options", {}).get(kind, []) if item.get("id") == structured.get(lock)), None)
    old_price, new_price = offer_minor(previous, currency), offer_minor(offer, currency)
    issues, windows = [], {}
    warnings = []
    if kind == "flights":
        for day in structured.get("days", []):
            for activity in day.get("activities", []):
                activity.pop("schedule_conflict", None)
        segments, count = offer.get("segments") or [], offer.get("outbound_segment_count")
        if not offer.get("has_return_details") or type(count) is not int or not 0 < count < len(segments):
            warnings.append("Complete outbound/return boundaries are unavailable; timing impact cannot be verified.")
        else:
            arrival = segments[count-1]
            departure = segments[count]
            start = airport_time(arrival.get("arrive_at"), arrival.get("arrival_timezone") or zone)
            end = airport_time(departure.get("depart_at"), departure.get("departure_timezone") or zone)
            if start and end:
                # Arithmetic in UTC handles DST transitions before returning to local time.
                start = (start.astimezone(timezone.utc) + timedelta(minutes=buffers["arrival_buffer_minutes"])).astimezone(start.tzinfo)
                end = (end.astimezone(timezone.utc) - timedelta(minutes=buffers["departure_buffer_minutes"])).astimezone(end.tzinfo)
                windows = {"available_from": start.isoformat(), "available_until": end.isoformat()}
                for day in structured.get("days", []):
                    for index, activity in enumerate(day.get("activities", [])):
                        match = re.fullmatch(r"(\d{1,2}):(\d{2})(?:\s*-.*)?", str(activity.get("time", "")))
                        if not match:
                            warnings.append(f"Timing not verified for {activity.get('title', 'an activity')}.")
                            continue
                        local = airport_time(f"{day.get('date')}T{int(match[1]):02}:{match[2]}", zone)
                        if not local:
                            warnings.append("An activity time zone is unknown or ambiguous; timing impact is incomplete.")
                            continue
                        if local < start or local > end:
                            key = activity_key(day.get("day_number", 1), index, activity)
                            locked = (trip.get("constraints") or {}).get(key, (trip.get("constraints") or {}).get(activity_key(day.get("day_number", 1), index))) == "locked"
                            issues.append({"activity_key": key, "title": activity.get("title"), "date": day.get("date"), "locked": locked, "reason": "Outside available arrival/departure window"})
                            activity["schedule_conflict"] = "Replan: outside selected flight window"
            else:
                warnings.append("Airport time zones are missing or ambiguous. Supply the destination time zone to check activity windows.")
    structured[lock] = offer["id"]
    return {"currency": currency, "old_price_minor": old_price, "new_price_minor": new_price,
        "price_delta_minor": new_price-old_price if old_price is not None and new_price is not None else None,
        "assumptions": {**buffers, "destination_timezone": zone, "label": "Transfer/check-in buffers are planning assumptions"},
        "activity_windows": windows, "affected_activities": issues, "can_apply": not any(item["locked"] for item in issues),
        "warnings": list(dict.fromkeys(warnings)) + (["Selected price is unknown; budget impact is incomplete."] if new_price is None else []),
        "proximity": proximity(offer, structured) if kind == "hotels" else None, "structured": structured}
