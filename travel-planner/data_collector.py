from __future__ import annotations

import json
import hashlib
from dataclasses import asdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from typing import Any

from main import TravelInputs
from runtime_store import get_cached_response, set_cached_response
from tools import FlightSearchTool, HotelSearchTool, LocalSearchTool, WeatherForecastTool, normalize_airport_id

NearbyAirports = dict[str, list[dict[str, str]]]

NEARBY_AIRPORTS: NearbyAirports = {
    "LAX": [{"code": "BUR", "label": "Burbank"}, {"code": "SNA", "label": "Orange County"}, {"code": "ONT", "label": "Ontario"}],
    "SFO": [{"code": "OAK", "label": "Oakland"}, {"code": "SJC", "label": "San Jose"}],
    "NYC": [{"code": "JFK", "label": "New York JFK"}, {"code": "LGA", "label": "LaGuardia"}, {"code": "EWR", "label": "Newark"}],
    "JFK": [{"code": "LGA", "label": "LaGuardia"}, {"code": "EWR", "label": "Newark"}],
    "MIA": [{"code": "FLL", "label": "Fort Lauderdale"}],
    "ORD": [{"code": "MDW", "label": "Chicago Midway"}],
    "HNL": [{"code": "OGG", "label": "Maui Kahului"}, {"code": "KOA", "label": "Kona"}, {"code": "LIH", "label": "Lihue"}],
    "LON": [{"code": "LGW", "label": "London Gatwick"}, {"code": "LCY", "label": "London City"}, {"code": "STN", "label": "London Stansted"}],
    "PAR": [{"code": "ORY", "label": "Paris Orly"}],
}


def collect_trip_data(travel_inputs: TravelInputs) -> dict[str, Any]:
    """Collect live provider data deterministically before CrewAI writes the plan."""
    flight_budget = _budget_slice(travel_inputs.budget, 0.35)
    nightly_hotel_budget = _nightly_budget(travel_inputs.budget, 0.38, travel_inputs.start_date, travel_inputs.end_date)
    provider_tasks = {
        "flights": lambda: _cached_provider_call(
            provider="flights",
            ttl_seconds=1800,
            payload={
                "origin": travel_inputs.origin,
                "destination": travel_inputs.destination,
                "departure_date": travel_inputs.start_date,
                "return_date": travel_inputs.end_date,
                "adults": travel_inputs.adults,
                "max_price": flight_budget,
                "currency_code": travel_inputs.currency_code,
            },
            call=lambda: FlightSearchTool()._run(
                origin=travel_inputs.origin,
                destination=travel_inputs.destination,
                departure_date=travel_inputs.start_date,
                return_date=travel_inputs.end_date,
                adults=travel_inputs.adults,
                max_price=flight_budget,
                currency_code=travel_inputs.currency_code,
            ),
        ),
        "hotels": lambda: _cached_provider_call(
            provider="hotels",
            ttl_seconds=3600,
            payload={
                "destination": travel_inputs.destination,
                "check_in_date": travel_inputs.start_date,
                "check_out_date": travel_inputs.end_date,
                "adults": travel_inputs.adults,
                "nightly_budget": nightly_hotel_budget,
                "currency_code": travel_inputs.currency_code,
            },
            call=lambda: HotelSearchTool()._run(
                destination=travel_inputs.destination,
                check_in_date=travel_inputs.start_date,
                check_out_date=travel_inputs.end_date,
                adults=travel_inputs.adults,
                nightly_budget=nightly_hotel_budget,
                currency_code=travel_inputs.currency_code,
            ),
        ),
        "weather": lambda: _cached_provider_call(
            provider="weather",
            ttl_seconds=7200,
            payload={
                "destination": travel_inputs.destination,
                "start_date": travel_inputs.start_date,
                "end_date": travel_inputs.end_date,
            },
            call=lambda: WeatherForecastTool()._run(
                destination=travel_inputs.destination,
                start_date=travel_inputs.start_date,
                end_date=travel_inputs.end_date,
            ),
        ),
        "local_search": lambda: _cached_provider_call(
            provider="local_search",
            ttl_seconds=86400,
            payload={
                "destination": travel_inputs.destination,
                "interests": travel_inputs.interests,
                "query_type": "attractions restaurants neighborhoods and day trips",
                "max_results": 8,
            },
            call=lambda: LocalSearchTool()._run(
                destination=travel_inputs.destination,
                interests=travel_inputs.interests,
                query_type="attractions restaurants neighborhoods and day trips",
                max_results=8,
            ),
        ),
    }
    provider_results = _run_provider_tasks(provider_tasks)
    flight_result = str(provider_results["flights"])
    hotel_result = str(provider_results["hotels"])
    flight_options = normalize_flight_options(flight_result)
    hotel_options = normalize_hotel_options(hotel_result)

    return {
        "inputs": asdict(travel_inputs),
        "provider_results": {
            "flights": flight_result,
            "hotels": hotel_result,
            "weather": provider_results["weather"],
            "local_search": provider_results["local_search"],
        },
        "budget_guidance": {
            "estimated_flight_budget": flight_budget,
            "estimated_nightly_hotel_budget": nightly_hotel_budget,
            "currency_code": travel_inputs.currency_code,
        },
        "options": build_options_payload(
            travel_inputs=travel_inputs,
            hotels=hotel_options,
            flights=flight_options,
            flight_provider_result=flight_result,
        ),
    }


def search_hotel_options_with_budget(travel_inputs: TravelInputs, nightly_budget: float) -> dict[str, Any]:
    provider_result = _cached_provider_call(
        provider="hotels",
        ttl_seconds=3600,
        payload={
            "destination": travel_inputs.destination,
            "check_in_date": travel_inputs.start_date,
            "check_out_date": travel_inputs.end_date,
            "adults": travel_inputs.adults,
            "nightly_budget": nightly_budget,
            "currency_code": travel_inputs.currency_code,
        },
        call=lambda: HotelSearchTool()._run(
            destination=travel_inputs.destination,
            check_in_date=travel_inputs.start_date,
            check_out_date=travel_inputs.end_date,
            adults=travel_inputs.adults,
            nightly_budget=nightly_budget,
            currency_code=travel_inputs.currency_code,
        ),
    )
    hotels = normalize_hotel_options(str(provider_result))
    return {
        "hotels": hotels,
        "map_center": calculate_map_center(hotels),
        "message": f"Updated hotel options with a nightly budget near {travel_inputs.currency_code} {nightly_budget:.0f}.",
        "provider_result": provider_result,
    }


def build_options_payload(
    travel_inputs: TravelInputs,
    hotels: list[dict[str, Any]],
    flights: list[dict[str, Any]],
    flight_provider_result: str,
) -> dict[str, Any]:
    return {
        "hotels": hotels,
        "flights": flights,
        "flight_recovery": build_flight_recovery(travel_inputs, flights, flight_provider_result),
        "map_center": calculate_map_center(hotels),
    }


def _run_provider_tasks(tasks: dict[str, Any]) -> dict[str, str]:
    results: dict[str, str] = {}
    max_workers = max(1, min(len(tasks), 4))
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(task): name for name, task in tasks.items()}
        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = str(future.result())
            except Exception as exc:
                results[name] = f"{name.replace('_', ' ').title()} failed: {exc}"
    return results


def _cached_provider_call(provider: str, ttl_seconds: int, payload: dict[str, Any], call: Any) -> str:
    cache_key = _cache_key(provider, payload)
    cached = get_cached_response(cache_key)
    if isinstance(cached, str):
        return cached
    result = str(call())
    set_cached_response(cache_key, provider, result, ttl_seconds)
    return result


def _cache_key(provider: str, payload: dict[str, Any]) -> str:
    encoded = json.dumps(payload, sort_keys=True, default=str)
    digest = hashlib.sha256(encoded.encode("utf-8")).hexdigest()
    return f"{provider}:{digest}"


def normalize_hotel_options(provider_result: str) -> list[dict[str, Any]]:
    payload = _maybe_json_object(provider_result)
    hotels = payload.get("hotels", []) if payload else []
    if not isinstance(hotels, list):
        return []
    normalized: list[dict[str, Any]] = []
    for index, hotel in enumerate(hotels):
        if not isinstance(hotel, dict):
            continue
        coordinates = _normalize_coordinates(hotel.get("gps_coordinates"))
        normalized.append(
            {
                "id": str(hotel.get("property_token") or f"hotel-{index + 1}"),
                "name": hotel.get("name") or "Unnamed hotel",
                "description": hotel.get("description"),
                "hotel_class": hotel.get("hotel_class"),
                "rating": hotel.get("rating"),
                "reviews": hotel.get("reviews"),
                "nightly_rate": hotel.get("nightly_rate"),
                "extracted_nightly_rate": hotel.get("extracted_nightly_rate"),
                "estimated_total": hotel.get("estimated_total"),
                "currency": hotel.get("currency"),
                "amenities": hotel.get("amenities") if isinstance(hotel.get("amenities"), list) else [],
                "link": hotel.get("link"),
                "coordinates": coordinates,
            }
        )
    return normalized


def normalize_flight_options(provider_result: str) -> list[dict[str, Any]]:
    payload = _maybe_json_object(provider_result)
    offers = payload.get("offers", []) if payload else []
    if not isinstance(offers, list):
        return []
    normalized: list[dict[str, Any]] = []
    for index, offer in enumerate(offers):
        if not isinstance(offer, dict):
            continue
        flights = offer.get("flights") if isinstance(offer.get("flights"), list) else []
        normalized.append(
            {
                "id": f"flight-{index + 1}",
                "total_price": offer.get("total_price"),
                "currency": offer.get("currency"),
                "total_duration_minutes": offer.get("total_duration_minutes"),
                "layovers": offer.get("layovers") if isinstance(offer.get("layovers"), list) else [],
                "departure_token": offer.get("departure_token"),
                "booking_token": offer.get("booking_token"),
                "reference": offer.get("reference"),
                "segments": flights,
                "has_return_details": _has_return_details(flights),
            }
        )
    return normalized


def build_flight_recovery(
    travel_inputs: TravelInputs,
    flights: list[dict[str, Any]],
    provider_result: str,
) -> list[dict[str, str]]:
    lowered = provider_result.lower()
    weak_result = (
        not flights
        or "no flight offers found" in lowered
        or "flight search failed" in lowered
        or any(not flight.get("has_return_details") for flight in flights)
    )
    if not weak_result:
        return []

    suggestions: list[dict[str, str]] = []
    for field, label in (("start_date", "departure"), ("end_date", "return")):
        base_value = getattr(travel_inputs, field)
        for offset in (-2, -1, 1, 2):
            shifted = _shift_date(base_value, offset)
            if shifted:
                suggestions.append(
                    {
                        "type": "date",
                        "label": f"Try {label} {abs(offset)} day{'s' if abs(offset) != 1 else ''} {'earlier' if offset < 0 else 'later'}",
                        "instruction": f"try {label} date {shifted}",
                    }
                )

    for code, label, direction in _nearby_airport_suggestions(travel_inputs):
        suggestions.append(
            {
                "type": "airport",
                "label": f"Try {label} ({code}) as the {direction} airport",
                "instruction": f"try {direction} airport {code}",
            }
        )

    suggestions.append(
        {
            "type": "flexibility",
            "label": "Broaden the flight search",
            "instruction": "try nearby airports and flexible dates",
        }
    )
    return suggestions[:10]


def calculate_map_center(hotels: list[dict[str, Any]]) -> dict[str, float] | None:
    coordinates = [hotel.get("coordinates") for hotel in hotels if hotel.get("coordinates")]
    if not coordinates:
        return None
    return {
        "lat": round(sum(point["lat"] for point in coordinates) / len(coordinates), 6),
        "lng": round(sum(point["lng"] for point in coordinates) / len(coordinates), 6),
    }


def search_flight_options_from_instruction(travel_inputs: TravelInputs, instruction: str) -> dict[str, Any]:
    adjusted = apply_flight_instruction(travel_inputs, instruction)
    flight_budget = _budget_slice(adjusted.budget, 0.35)
    provider_result = FlightSearchTool()._run(
        origin=adjusted.origin,
        destination=adjusted.destination,
        departure_date=adjusted.start_date,
        return_date=adjusted.end_date,
        adults=adjusted.adults,
        max_price=flight_budget,
        currency_code=adjusted.currency_code,
    )
    flights = normalize_flight_options(provider_result)
    return {
        "flights": flights,
        "recovery_suggestions": build_flight_recovery(adjusted, flights, provider_result),
        "message": "Updated flight options based on your request.",
        "applied_inputs": asdict(adjusted),
        "provider_result": provider_result,
    }


def apply_flight_instruction(travel_inputs: TravelInputs, instruction: str) -> TravelInputs:
    lowered = instruction.lower()
    values = asdict(travel_inputs)
    airport = _extract_airport_code(instruction)
    if airport:
        if "destination" in lowered or "arrival" in lowered or "to " in lowered:
            values["destination"] = airport
        else:
            values["origin"] = airport

    explicit_date = _extract_iso_date(instruction)
    if explicit_date:
        target = "end_date" if any(marker in lowered for marker in ("return", "coming back", "back")) else "start_date"
        values[target] = explicit_date

    offset = _extract_day_offset(lowered)
    if offset:
        target = "end_date" if any(marker in lowered for marker in ("return", "coming back", "back")) else "start_date"
        shifted = _shift_date(values[target], offset)
        if shifted:
            values[target] = shifted

    if "nearby" in lowered:
        origin_options = NEARBY_AIRPORTS.get(normalize_airport_id(travel_inputs.origin), [])
        destination_options = NEARBY_AIRPORTS.get(normalize_airport_id(travel_inputs.destination), [])
        if "destination" in lowered or "arrival" in lowered:
            if destination_options:
                values["destination"] = destination_options[0]["code"]
        elif origin_options:
            values["origin"] = origin_options[0]["code"]
        elif destination_options:
            values["destination"] = destination_options[0]["code"]

    return TravelInputs(**values)


def _budget_slice(budget: str, ratio: float) -> float:
    try:
        return round(float(budget) * ratio, 2)
    except ValueError:
        return 0.0


def _nightly_budget(budget: str, ratio: float, start_date: str, end_date: str) -> float:
    from datetime import datetime

    try:
        start = datetime.strptime(start_date, "%Y-%m-%d").date()
        end = datetime.strptime(end_date, "%Y-%m-%d").date()
        nights = max(1, (end - start).days)
    except ValueError:
        nights = 1
    return round(_budget_slice(budget, ratio) / nights, 2)


def _maybe_json_object(value: str) -> dict[str, Any]:
    try:
        payload = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return {}
    return payload if isinstance(payload, dict) else {}


def _normalize_coordinates(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    lat = raw.get("latitude") or raw.get("lat")
    lng = raw.get("longitude") or raw.get("lng") or raw.get("lon")
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        return None
    return {"lat": float(lat), "lng": float(lng)}


def _has_return_details(segments: list[Any]) -> bool:
    if len(segments) < 2:
        return False
    seen_reverse = False
    first_from = None
    first_to = None
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        if first_from is None:
            first_from = segment.get("from")
            first_to = segment.get("to")
            continue
        if segment.get("from") == first_to or segment.get("to") == first_from:
            seen_reverse = True
    return seen_reverse


def _shift_date(value: str, offset_days: int) -> str | None:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        return None
    return (parsed + timedelta(days=offset_days)).isoformat()


def _nearby_airport_suggestions(travel_inputs: TravelInputs) -> list[tuple[str, str, str]]:
    suggestions: list[tuple[str, str, str]] = []
    for direction, raw_code in (("origin", travel_inputs.origin), ("destination", travel_inputs.destination)):
        for airport in NEARBY_AIRPORTS.get(normalize_airport_id(raw_code), []):
            suggestions.append((airport["code"], airport["label"], direction))
    return suggestions


def _extract_airport_code(instruction: str) -> str | None:
    import re

    matches = re.findall(r"\b[A-Z]{3}\b", instruction.upper())
    return matches[-1] if matches else None


def _extract_iso_date(instruction: str) -> str | None:
    import re

    match = re.search(r"\b20\d{2}-\d{2}-\d{2}\b", instruction)
    if not match:
        return None
    try:
        datetime.strptime(match.group(0), "%Y-%m-%d")
    except ValueError:
        return None
    return match.group(0)


def _extract_day_offset(lowered_instruction: str) -> int | None:
    word_numbers = {
        "one": 1,
        "two": 2,
        "three": 3,
        "four": 4,
        "five": 5,
    }
    amount = None
    import re

    digit_match = re.search(r"\b(\d+)\s+day", lowered_instruction)
    if digit_match:
        amount = int(digit_match.group(1))
    else:
        for word, value in word_numbers.items():
            if f"{word} day" in lowered_instruction or f"{word} more day" in lowered_instruction:
                amount = value
                break
    if amount is None:
        if "earlier" in lowered_instruction:
            amount = 1
        elif "later" in lowered_instruction:
            amount = 1
        else:
            return None
    return -amount if "earlier" in lowered_instruction or "before" in lowered_instruction else amount
