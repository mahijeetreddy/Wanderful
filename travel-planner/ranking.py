from __future__ import annotations

import math
import re
from typing import Any


def rank_hotels(
    hotels: list[dict[str, Any]],
    nightly_budget: float,
    interests: str,
    map_center: dict[str, float] | None,
) -> list[dict[str, Any]]:
    interest_terms = _terms(interests)
    ranked: list[dict[str, Any]] = []
    for hotel in hotels:
        rating = _number(hotel.get("rating"))
        reviews = _number(hotel.get("reviews"))
        review_confidence = min(1.0, reviews / 50) if reviews else 0.3
        rating_score = (
            (min(1.0, rating / 5.0) * review_confidence) + (0.45 * (1 - review_confidence))
            if rating
            else 0.45
        )
        hotel_class = _number(hotel.get("hotel_class"))
        class_score = min(1.0, hotel_class / 5.0) if hotel_class else 0.5
        nightly = _number(hotel.get("extracted_nightly_rate"))
        if not nightly:
            nightly = _number_from_text(hotel.get("nightly_rate"))
        price_score = _budget_fit(nightly, nightly_budget)
        text = " ".join(
            [
                str(hotel.get("name") or ""),
                str(hotel.get("description") or ""),
                " ".join(hotel.get("amenities") or []),
            ]
        ).lower()
        matched_terms = sorted(term for term in interest_terms if term in text)
        interest_score = min(1.0, len(matched_terms) / max(1, min(3, len(interest_terms)))) if interest_terms else 0.5
        distance_km = _distance_to_center(hotel.get("coordinates"), map_center)
        distance_score = 0.6 if distance_km is None else max(0.0, 1.0 - distance_km / 20.0)
        score = round(
            100
            * (
                0.35 * rating_score
                + 0.1 * class_score
                + 0.3 * price_score
                + 0.15 * interest_score
                + 0.1 * distance_score
            ),
            1,
        )
        reasons = []
        if rating:
            reasons.append(f"{rating:.1f}/5 guest rating")
        if hotel_class:
            reasons.append(f"{hotel_class:.0f}-star property")
        if nightly and nightly_budget:
            reasons.append("within nightly target" if nightly <= nightly_budget else "above nightly target")
        if matched_terms:
            reasons.append(f"matches {', '.join(matched_terms[:3])}")
        if distance_km is not None:
            reasons.append(f"{distance_km:.1f} km from result center")
        ranked.append({**hotel, "rank_score": score, "rank_reasons": reasons, "distance_km": distance_km})
    return _assign_ranks(ranked)


def rank_flights(
    flights: list[dict[str, Any]],
    flight_budget: float,
) -> list[dict[str, Any]]:
    durations = [_number(flight.get("total_duration_minutes")) for flight in flights]
    max_duration = max([value for value in durations if value] or [1])
    ranked: list[dict[str, Any]] = []
    for flight in flights:
        price = _number(flight.get("total_price"))
        duration = _number(flight.get("total_duration_minutes"))
        stops = len(flight.get("layovers") or [])
        price_score = _budget_fit(price, flight_budget)
        duration_score = max(0.0, 1.0 - duration / (max_duration * 1.25)) if duration else 0.4
        stops_score = 1.0 if stops == 0 else max(0.0, 0.75 - 0.25 * stops)
        completeness = 1.0 if flight.get("has_return_details") else 0.45
        carbon = flight.get("carbon_emissions") if isinstance(flight.get("carbon_emissions"), dict) else None
        difference_percent = _number(carbon.get("difference_percent")) if carbon and carbon.get("difference_percent") is not None else None
        emissions_score = max(0.0, min(1.0, 0.5 - difference_percent / 200)) if difference_percent is not None else 0.55
        score = round(
            100
            * (
                0.35 * price_score
                + 0.2 * duration_score
                + 0.2 * stops_score
                + 0.15 * completeness
                + 0.1 * emissions_score
            ),
            1,
        )
        reasons = [
            "nonstop" if stops == 0 else f"{stops} stop{'s' if stops != 1 else ''}",
            "complete round trip" if flight.get("has_return_details") else "return selection required",
        ]
        if price and flight_budget:
            reasons.append("within flight target" if price <= flight_budget else "above flight target")
        if duration:
            reasons.append(f"{int(duration // 60)}h {int(duration % 60)}m total")
        if difference_percent is not None and abs(difference_percent) >= 10:
            reasons.append(
                f"{abs(difference_percent):.0f}% {'below' if difference_percent < 0 else 'above'} typical emissions"
            )
        ranked.append({**flight, "rank_score": score, "rank_reasons": reasons})
    return _assign_ranks(ranked)


def score_activity(
    activity: dict[str, Any],
    interests: str,
    weather_note: str,
    daily_budget: float,
) -> tuple[float, list[str]]:
    text = " ".join(
        [
            str(activity.get("title") or ""),
            str(activity.get("description") or ""),
            str(activity.get("location") or ""),
        ]
    ).lower()
    interest_terms = _terms(interests)
    matches = sorted(term for term in interest_terms if term in text)
    interest_score = min(1.0, len(matches) / max(1, min(3, len(interest_terms)))) if interest_terms else 0.5
    cost = _number(activity.get("estimated_cost"))
    price_score = _budget_fit(cost, daily_budget) if cost else 0.85
    weather_risk = bool(re.search(r"rain|storm|snow|extreme heat", weather_note, re.IGNORECASE))
    weather_score = 1.0 if not weather_risk or activity.get("indoor") else 0.35
    completeness = 1.0 if activity.get("title") and activity.get("description") else 0.5
    score = round(100 * (0.45 * interest_score + 0.25 * price_score + 0.2 * weather_score + 0.1 * completeness), 1)
    reasons = []
    if matches:
        reasons.append(f"matches {', '.join(matches[:3])}")
    if cost <= daily_budget:
        reasons.append("fits daily activity budget")
    if weather_risk:
        reasons.append("weather-safe" if activity.get("indoor") else "weather-sensitive")
    return score, reasons


def _assign_ranks(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ordered = sorted(items, key=lambda item: float(item.get("rank_score") or 0), reverse=True)
    return [{**item, "rank": index} for index, item in enumerate(ordered, start=1)]


def _terms(value: str) -> set[str]:
    ignored = {"and", "the", "with", "local", "travel", "trip", "food"}
    return {
        term
        for term in re.findall(r"[a-z0-9]+", value.lower())
        if len(term) >= 4 and term not in ignored
    }


def _budget_fit(value: float, target: float) -> float:
    if not value or not target:
        return 0.5
    ratio = value / target
    if ratio <= 1:
        return max(0.65, 1.0 - abs(0.82 - ratio) * 0.35)
    return max(0.0, 1.0 - (ratio - 1.0) * 1.5)


def _distance_to_center(
    coordinates: dict[str, float] | None,
    center: dict[str, float] | None,
) -> float | None:
    if not coordinates or not center:
        return None
    lat1, lon1 = math.radians(coordinates["lat"]), math.radians(coordinates["lng"])
    lat2, lon2 = math.radians(center["lat"]), math.radians(center["lng"])
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return round(6371 * 2 * math.atan2(math.sqrt(value), math.sqrt(1 - value)), 2)


def _number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _number_from_text(value: Any) -> float:
    match = re.search(r"(\d+(?:\.\d+)?)", str(value or "").replace(",", ""))
    return float(match.group(1)) if match else 0.0
