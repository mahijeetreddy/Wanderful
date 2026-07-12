from __future__ import annotations

import json
import os
from collections import Counter, defaultdict
from datetime import date, datetime
from pathlib import Path
from typing import Any, Type

import requests

os.environ.setdefault(
    "CREWAI_STORAGE_DIR",
    str(Path.cwd() / ".crewai_runtime"),
)
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))

from crewai.tools import BaseTool
from dotenv import load_dotenv
from pydantic import BaseModel, Field
from requests import Response
from requests.exceptions import RequestException, Timeout


load_dotenv()


DEFAULT_TIMEOUT_SECONDS = 20
SERPAPI_SEARCH_URL = "https://serpapi.com/search"
OPENWEATHER_GEO_URL = "https://api.openweathermap.org/geo/1.0/direct"
OPENWEATHER_FORECAST_URL = "https://api.openweathermap.org/data/2.5/forecast"

AIRPORT_ALIASES: dict[str, str] = {
    "los angeles": "LAX",
    "los angeles ca": "LAX",
    "la": "LAX",
    "lax": "LAX",
    "burbank": "BUR",
    "orange county": "SNA",
    "san jose": "SJC",
    "san jose ca": "SJC",
    "sjc": "SJC",
    "san francisco": "SFO",
    "san francisco ca": "SFO",
    "sfo": "SFO",
    "oakland": "OAK",
    "new york": "NYC",
    "new york city": "NYC",
    "nyc": "NYC",
    "jfk": "JFK",
    "newark": "EWR",
    "chicago": "ORD",
    "chicago il": "ORD",
    "miami": "MIA",
    "seattle": "SEA",
    "denver": "DEN",
    "dallas": "DFW",
    "houston": "IAH",
    "atlanta": "ATL",
    "boston": "BOS",
    "washington dc": "DCA",
    "las vegas": "LAS",
    "honolulu": "HNL",
    "hawaii": "HNL",
    "maui": "OGG",
    "tokyo": "TYO",
    "kyoto": "KIX",
    "osaka": "KIX",
    "paris": "PAR",
    "london": "LON",
    "rome": "ROM",
    "barcelona": "BCN",
    "amsterdam": "AMS",
    "dubai": "DXB",
    "singapore": "SIN",
}


def _timeout() -> int:
    raw_value = os.getenv("REQUEST_TIMEOUT_SECONDS", str(DEFAULT_TIMEOUT_SECONDS))
    try:
        return max(1, int(raw_value))
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def _safe_json(response: Response) -> dict[str, Any]:
    try:
        payload = response.json()
    except ValueError as exc:
        raise ValueError("API returned a non-JSON response.") from exc
    if not isinstance(payload, dict):
        raise ValueError("API returned an unexpected JSON shape.")
    return payload


def _format_api_error(prefix: str, exc: Exception) -> str:
    if isinstance(exc, Timeout):
        return f"{prefix}: request timed out. Try again later or raise REQUEST_TIMEOUT_SECONDS."
    if isinstance(exc, requests.HTTPError) and exc.response is not None:
        status = exc.response.status_code
        body = exc.response.text[:500]
        return f"{prefix}: HTTP {status}. Provider response: {body}"
    if isinstance(exc, RequestException):
        return f"{prefix}: network error calling provider. Details: {exc}"
    return f"{prefix}: {exc}"


def _parse_iso_date(value: str, field_name: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ValueError(f"{field_name} must use YYYY-MM-DD format.") from exc


def _compact_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)


def normalize_airport_id(value: str) -> str:
    """Convert common city/place inputs into SerpAPI-compatible airport IDs."""
    raw = str(value or "").strip()
    upper = raw.upper()
    if len(upper) == 3 and upper.isalpha():
        return upper

    normalized = _normalize_place_key(raw)
    if normalized in AIRPORT_ALIASES:
        return AIRPORT_ALIASES[normalized]

    first_part = raw.split(",")[0].strip()
    first_part_key = _normalize_place_key(first_part)
    if first_part_key in AIRPORT_ALIASES:
        return AIRPORT_ALIASES[first_part_key]

    return upper


def _normalize_place_key(value: str) -> str:
    import re

    cleaned = value.lower().replace("&", " and ")
    cleaned = re.sub(r"[^a-z0-9\s]", " ", cleaned)
    tokens = [
        token
        for token in cleaned.split()
        if token not in {"airport", "international", "intl", "city", "usa", "us", "united", "states"}
    ]
    if len(tokens) > 1 and tokens[-1] in {
        "ca",
        "ny",
        "il",
        "fl",
        "wa",
        "tx",
        "ga",
        "ma",
        "nv",
        "co",
    }:
        without_state = " ".join(tokens[:-1])
        with_state = " ".join(tokens)
        return with_state if with_state in AIRPORT_ALIASES else without_state
    return " ".join(tokens)


def _serpapi_get(params: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("SERPAPI_API_KEY")
    if not api_key:
        raise RuntimeError("Missing SERPAPI_API_KEY in environment or .env file.")

    response = requests.get(
        SERPAPI_SEARCH_URL,
        params={**params, "api_key": api_key},
        timeout=_timeout(),
    )
    response.raise_for_status()
    payload = _safe_json(response)
    if "error" in payload:
        raise ValueError(f"SerpAPI returned an error: {payload['error']}")
    return payload


class FlightSearchInput(BaseModel):
    origin: str = Field(..., description="Origin airport/city, preferably IATA code.")
    destination: str = Field(..., description="Destination airport/city, preferably IATA code.")
    departure_date: str = Field(..., description="Departure date in YYYY-MM-DD format.")
    return_date: str | None = Field(None, description="Return date in YYYY-MM-DD format.")
    adults: int = Field(1, ge=1, le=9, description="Number of adult travelers.")
    max_price: float | None = Field(None, ge=0, description="Maximum total flight price.")
    currency_code: str = Field("USD", min_length=3, max_length=3)


class FlightSearchTool(BaseTool):
    name: str = "Live Flight Search"
    description: str = (
        "Finds live Google Flights results with prices, airlines, routes, and "
        "booking tokens using SerpAPI."
    )
    args_schema: Type[BaseModel] = FlightSearchInput

    def _run(
        self,
        origin: str,
        destination: str,
        departure_date: str,
        return_date: str | None = None,
        adults: int = 1,
        max_price: float | None = None,
        currency_code: str = "USD",
    ) -> str:
        if not os.getenv("SERPAPI_API_KEY"):
            return "Flight search unavailable: set SERPAPI_API_KEY in your environment or .env file."

        try:
            _parse_iso_date(departure_date, "departure_date")
            if return_date:
                _parse_iso_date(return_date, "return_date")

            resolved_origin = normalize_airport_id(origin)
            resolved_destination = normalize_airport_id(destination)
            params: dict[str, Any] = {
                "engine": "google_flights",
                "departure_id": resolved_origin,
                "arrival_id": resolved_destination,
                "outbound_date": departure_date,
                "currency": currency_code.upper(),
                "adults": adults,
                "hl": "en",
                "gl": "us",
            }
            if return_date:
                params["return_date"] = return_date

            payload = _serpapi_get(params)
            offers = payload.get("best_flights") or payload.get("other_flights") or []
            if not offers:
                return "No flight offers found for the requested route and constraints."

            summaries: list[dict[str, Any]] = []
            for offer in offers[:5]:
                price = offer.get("price")
                if max_price is not None and isinstance(price, (int, float)) and price > max_price:
                    continue
                flights = []
                for flight in offer.get("flights", []):
                    flights.append(
                        {
                            "airline": flight.get("airline"),
                            "flight_number": flight.get("flight_number"),
                            "from": flight.get("departure_airport", {}).get("id"),
                            "to": flight.get("arrival_airport", {}).get("id"),
                            "depart_at": flight.get("departure_airport", {}).get("time"),
                            "arrive_at": flight.get("arrival_airport", {}).get("time"),
                            "airplane": flight.get("airplane"),
                            "travel_class": flight.get("travel_class"),
                            "duration_minutes": flight.get("duration"),
                        }
                    )
                summaries.append(
                    {
                        "total_price": price,
                        "currency": currency_code.upper(),
                        "total_duration_minutes": offer.get("total_duration"),
                        "layovers": offer.get("layovers", []),
                        "carbon_emissions": offer.get("carbon_emissions"),
                        "departure_token": offer.get("departure_token"),
                        "booking_token": offer.get("booking_token"),
                        "flights": flights,
                        "reference": "Use the SerpAPI booking_token for booking options. Some Google Flights round-trip results require a departure_token step before return details are complete.",
                    }
                )
                if len(summaries) == 5:
                    break

            return _compact_json(
                {
                    "route": f"{resolved_origin} to {resolved_destination}",
                    "input_route": f"{origin.strip()} to {destination.strip()}",
                    "airport_resolution": {
                        "origin": {"input": origin, "resolved": resolved_origin},
                        "destination": {"input": destination, "resolved": resolved_destination},
                    },
                    "source": "SerpAPI Google Flights",
                    "search_metadata": payload.get("search_metadata", {}),
                    "price_insights": payload.get("price_insights", {}),
                    "offers": summaries,
                }
            )
        except Exception as exc:
            return _format_api_error("Flight search failed", exc)


def fetch_flight_booking_options(booking_token: str, currency_code: str = "USD") -> dict[str, Any]:
    """Fetch SerpAPI Google Flights booking options for a selected flight token."""
    cleaned_token = str(booking_token or "").strip()
    if not cleaned_token:
        raise ValueError("Missing booking_token.")
    payload = _serpapi_get(
        {
            "engine": "google_flights",
            "booking_token": cleaned_token,
            "currency": currency_code.upper(),
            "hl": "en",
            "gl": "us",
        }
    )
    return {
        "source": "SerpAPI Google Flights booking options",
        "booking_options": _normalize_booking_options(payload),
        "raw_keys": sorted(payload.keys()),
    }


def fetch_return_flight_options(departure_token: str, currency_code: str = "USD") -> dict[str, Any]:
    """Fetch return-flight choices for a selected outbound SerpAPI result."""
    cleaned_token = str(departure_token or "").strip()
    if not cleaned_token:
        raise ValueError("Missing departure_token.")
    payload = _serpapi_get(
        {
            "engine": "google_flights",
            "departure_token": cleaned_token,
            "currency": currency_code.upper(),
            "hl": "en",
            "gl": "us",
        }
    )
    return {
        "source": "SerpAPI Google Flights return options",
        "return_options": _normalize_return_flight_options(payload, currency_code),
        "raw_keys": sorted(payload.keys()),
    }


def _normalize_return_flight_options(payload: dict[str, Any], currency_code: str) -> list[dict[str, Any]]:
    offers = payload.get("best_flights")
    if not isinstance(offers, list) or not offers:
        offers = payload.get("other_flights")
    if not isinstance(offers, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, offer in enumerate(offers[:8]):
        if not isinstance(offer, dict):
            continue
        segments = []
        for flight in offer.get("flights", []):
            if not isinstance(flight, dict):
                continue
            segments.append(
                {
                    "airline": flight.get("airline"),
                    "flight_number": flight.get("flight_number"),
                    "from": flight.get("departure_airport", {}).get("id"),
                    "to": flight.get("arrival_airport", {}).get("id"),
                    "depart_at": flight.get("departure_airport", {}).get("time"),
                    "arrive_at": flight.get("arrival_airport", {}).get("time"),
                    "airplane": flight.get("airplane"),
                    "travel_class": flight.get("travel_class"),
                    "duration_minutes": flight.get("duration"),
                }
            )
        normalized.append(
            {
                "id": f"return-{index + 1}",
                "total_price": offer.get("price"),
                "currency": currency_code.upper(),
                "total_duration_minutes": offer.get("total_duration"),
                "layovers": offer.get("layovers") if isinstance(offer.get("layovers"), list) else [],
                "departure_token": offer.get("departure_token"),
                "booking_token": offer.get("booking_token"),
                "segments": segments,
                "has_return_details": True,
                "reference": "Return option retrieved with SerpAPI departure_token. Use booking_token for booking options when available.",
            }
        )
    return normalized


def _normalize_booking_options(payload: dict[str, Any]) -> list[dict[str, Any]]:
    raw_options = payload.get("booking_options")
    if not isinstance(raw_options, list):
        raw_options = payload.get("booking_options_results")
    if not isinstance(raw_options, list):
        raw_options = payload.get("tickets")
    if not isinstance(raw_options, list):
        return []

    normalized: list[dict[str, Any]] = []
    for index, option in enumerate(raw_options[:8]):
        if not isinstance(option, dict):
            continue
        normalized.append(
            {
                "id": f"booking-{index + 1}",
                "title": option.get("title") or option.get("name") or option.get("booking_site") or "Booking option",
                "price": option.get("price") or option.get("total_price"),
                "currency": option.get("currency"),
                "link": option.get("link") or option.get("url") or option.get("booking_link"),
                "description": option.get("description") or option.get("details"),
                "extensions": option.get("extensions") if isinstance(option.get("extensions"), list) else [],
            }
        )
    return normalized


class HotelSearchInput(BaseModel):
    destination: str = Field(..., description="Destination city or IATA city code.")
    check_in_date: str = Field(..., description="Check-in date in YYYY-MM-DD format.")
    check_out_date: str = Field(..., description="Check-out date in YYYY-MM-DD format.")
    adults: int = Field(1, ge=1, le=9)
    nightly_budget: float | None = Field(None, ge=0)
    currency_code: str = Field("USD", min_length=3, max_length=3)


MAX_HOTEL_RESULTS = 6


class HotelSearchTool(BaseTool):
    name: str = "Live Hotel Search"
    description: str = (
        "Finds hotel options and prices using SerpAPI Google Hotels. Returns up to "
        f"{MAX_HOTEL_RESULTS} accommodation options when provider inventory is available."
    )
    args_schema: Type[BaseModel] = HotelSearchInput

    def _run(
        self,
        destination: str,
        check_in_date: str,
        check_out_date: str,
        adults: int = 1,
        nightly_budget: float | None = None,
        currency_code: str = "USD",
    ) -> str:
        if not os.getenv("SERPAPI_API_KEY"):
            return "Hotel search unavailable: set SERPAPI_API_KEY in your environment or .env file."

        try:
            _parse_iso_date(check_in_date, "check_in_date")
            _parse_iso_date(check_out_date, "check_out_date")
            params: dict[str, Any] = {
                "engine": "google_hotels",
                "q": destination,
                "check_in_date": check_in_date,
                "check_out_date": check_out_date,
                "adults": adults,
                "currency": currency_code.upper(),
                "hl": "en",
                "gl": "us",
            }

            payload = _serpapi_get(params)
            hotel_offers = payload.get("properties", [])
            if not hotel_offers:
                return f"No Google Hotels inventory found for {destination}."

            nights = max(
                1,
                (_parse_iso_date(check_out_date, "check_out_date") - _parse_iso_date(check_in_date, "check_in_date")).days,
            )
            summaries: list[dict[str, Any]] = []
            for hotel_offer in hotel_offers:
                rate = hotel_offer.get("rate_per_night", {})
                extracted_rate = rate.get("extracted_lowest") or hotel_offer.get("extracted_price")
                if nightly_budget is not None and isinstance(extracted_rate, (int, float)):
                    if extracted_rate > nightly_budget:
                        continue
                images = hotel_offer.get("images") or []
                first_image = images[0] if isinstance(images, list) and images else {}
                summaries.append(
                    {
                        "property_token": hotel_offer.get("property_token"),
                        "name": hotel_offer.get("name"),
                        "description": hotel_offer.get("description"),
                        "hotel_class": hotel_offer.get("hotel_class"),
                        "rating": hotel_offer.get("overall_rating"),
                        "reviews": hotel_offer.get("reviews"),
                        "nightly_rate": rate.get("lowest"),
                        "extracted_nightly_rate": extracted_rate,
                        "estimated_total": (
                            round(extracted_rate * nights, 2)
                            if isinstance(extracted_rate, (int, float))
                            else None
                        ),
                        "currency": currency_code.upper(),
                        "amenities": hotel_offer.get("amenities", [])[:8],
                        "link": hotel_offer.get("link"),
                        "gps_coordinates": hotel_offer.get("gps_coordinates"),
                        "image_thumbnail": first_image.get("thumbnail"),
                        "image_url": first_image.get("original_image"),
                        "reference": "Use property_token for deeper Google Hotels details through SerpAPI.",
                    }
                )

            if not summaries:
                return (
                    "No priced hotel offers matched the requested dates and nightly budget. "
                    "Try a higher budget, different dates, or a broader destination query."
                )
            def _sort_key(item: dict[str, Any]) -> tuple[float, float]:
                rating = item.get("rating")
                reviews = item.get("reviews")
                return (
                    -rating if isinstance(rating, (int, float)) else 0.0,
                    -reviews if isinstance(reviews, (int, float)) else 0.0,
                )

            summaries.sort(key=_sort_key)
            summaries = summaries[:MAX_HOTEL_RESULTS]
            return _compact_json(
                {
                    "destination": destination,
                    "source": "SerpAPI Google Hotels",
                    "search_metadata": payload.get("search_metadata", {}),
                    "hotels": summaries,
                }
            )
        except Exception as exc:
            return _format_api_error("Hotel search failed", exc)


class WeatherForecastInput(BaseModel):
    destination: str = Field(..., description="Destination city name.")
    start_date: str = Field(..., description="Travel start date in YYYY-MM-DD format.")
    end_date: str = Field(..., description="Travel end date in YYYY-MM-DD format.")
    units: str = Field("imperial", description="standard, metric, or imperial.")


class WeatherForecastTool(BaseTool):
    name: str = "Live Weather Forecast"
    description: str = (
        "Fetches destination coordinates and a 5-day / 3-hour OpenWeather forecast, "
        "then summarizes conditions overlapping the trip dates."
    )
    args_schema: Type[BaseModel] = WeatherForecastInput

    def _run(
        self,
        destination: str,
        start_date: str,
        end_date: str,
        units: str = "imperial",
    ) -> str:
        api_key = os.getenv("OPENWEATHER_API_KEY")
        if not api_key:
            return "Weather forecast unavailable: set OPENWEATHER_API_KEY in your environment or .env file."

        try:
            trip_start = _parse_iso_date(start_date, "start_date")
            trip_end = _parse_iso_date(end_date, "end_date")

            geo_response = requests.get(
                OPENWEATHER_GEO_URL,
                params={"q": destination, "limit": 1, "appid": api_key},
                timeout=_timeout(),
            )
            geo_response.raise_for_status()
            geo_payload = geo_response.json()
            if not isinstance(geo_payload, list) or not geo_payload:
                return f"No OpenWeather geocoding result found for '{destination}'."
            location = geo_payload[0]
            lat = location.get("lat")
            lon = location.get("lon")
            if lat is None or lon is None:
                return f"OpenWeather geocoding result for '{destination}' did not include coordinates."

            forecast_response = requests.get(
                OPENWEATHER_FORECAST_URL,
                params={"lat": lat, "lon": lon, "appid": api_key, "units": units},
                timeout=_timeout(),
            )
            forecast_response.raise_for_status()
            forecast_payload = _safe_json(forecast_response)
            entries = forecast_payload.get("list", [])
            daily: dict[str, list[dict[str, Any]]] = defaultdict(list)
            available_dates: set[date] = set()
            for entry in entries:
                dt_txt = entry.get("dt_txt")
                if not isinstance(dt_txt, str):
                    continue
                entry_date = datetime.strptime(dt_txt, "%Y-%m-%d %H:%M:%S").date()
                available_dates.add(entry_date)
                if trip_start <= entry_date <= trip_end:
                    daily[entry_date.isoformat()].append(entry)

            summaries = []
            for day, day_entries in sorted(daily.items()):
                temps = [
                    entry.get("main", {}).get("temp")
                    for entry in day_entries
                    if entry.get("main", {}).get("temp") is not None
                ]
                pops = [entry.get("pop", 0) for entry in day_entries]
                descriptions = [
                    entry.get("weather", [{}])[0].get("description")
                    for entry in day_entries
                    if entry.get("weather")
                ]
                condition_groups = [
                    entry.get("weather", [{}])[0].get("main")
                    for entry in day_entries
                    if entry.get("weather")
                ]
                dominant_group = Counter(filter(None, condition_groups)).most_common(1)
                summaries.append(
                    {
                        "date": day,
                        "temperature_range": f"{min(temps):.0f} to {max(temps):.0f}" if temps else "unknown",
                        "temp_high": round(max(temps), 1) if temps else None,
                        "temp_low": round(min(temps), 1) if temps else None,
                        "max_precip_probability": f"{max(pops) * 100:.0f}%" if pops else "unknown",
                        "precip_probability": round(max(pops) * 100) if pops else None,
                        "common_conditions": sorted(set(filter(None, descriptions)))[:4],
                        "condition_group": dominant_group[0][0] if dominant_group else None,
                    }
                )

            notice = None
            if available_dates:
                min_date = min(available_dates)
                max_date = max(available_dates)
                if trip_start < min_date or trip_end > max_date:
                    notice = (
                        "OpenWeather 5-day forecast only covers "
                        f"{min_date.isoformat()} through {max_date.isoformat()}; "
                        "use seasonal norms or a paid longer-range weather API for uncovered dates."
                    )

            if not summaries:
                return _compact_json(
                    {
                        "destination": destination,
                        "notice": notice
                        or "No forecast entries overlap the requested travel dates.",
                    }
                )

            return _compact_json(
                {
                    "destination": f"{location.get('name', destination)}, {location.get('country', '')}",
                    "source": "OpenWeather 5-day / 3-hour forecast",
                    "units": units,
                    "notice": notice,
                    "daily_forecast": summaries,
                }
            )
        except Exception as exc:
            return _format_api_error("Weather forecast failed", exc)


class LocalSearchInput(BaseModel):
    destination: str = Field(..., description="Destination city or region.")
    interests: str = Field(..., description="Traveler interests, comma separated or prose.")
    query_type: str = Field(
        "attractions and restaurants",
        description="The local search focus, e.g. museums, restaurants, hiking.",
    )
    max_results: int = Field(8, ge=1, le=10)


class LocalSearchTool(BaseTool):
    name: str = "Local Attractions Search"
    description: str = (
        "Searches the web for local attractions, restaurants, neighborhoods, and "
        "activity ideas using SerpAPI Google Search."
    )
    args_schema: Type[BaseModel] = LocalSearchInput

    def _run(
        self,
        destination: str,
        interests: str,
        query_type: str = "attractions and restaurants",
        max_results: int = 8,
    ) -> str:
        if not os.getenv("SERPAPI_API_KEY"):
            return "Local search unavailable: set SERPAPI_API_KEY in your environment or .env file."

        query = f"best {query_type} in {destination} for travelers interested in {interests}"
        try:
            payload = _serpapi_get(
                {
                    "engine": "google",
                    "q": query,
                    "num": max_results,
                    "hl": "en",
                    "gl": "us",
                }
            )
            organic_results = payload.get("organic_results") or payload.get("organic", [])
            results = []
            for item in organic_results[:max_results]:
                results.append(
                    {
                        "title": item.get("title"),
                        "link": item.get("link"),
                        "snippet": item.get("snippet"),
                    }
                )
            if not results:
                return f"No local search results found for query: {query}"
            return _compact_json({"query": query, "source": "SerpAPI Google Search", "results": results})
        except Exception as exc:
            return _format_api_error("Local search failed", exc)
