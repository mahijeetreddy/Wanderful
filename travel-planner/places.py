"""Conservative attraction lookup through the existing SerpAPI provider.

Contract: https://serpapi.com/maps-local-results
Weather geocoding is deliberately not used for attraction identities.
"""
import json
import os
import re
import unicodedata
from urllib.parse import urlencode
from data_collector import _cached_provider_call
from decisions import valid_point
from tools import AIRPORT_ALIASES, _serpapi_get


def _normalized(value):
    value = unicodedata.normalize("NFKD", str(value).casefold())
    return re.sub(r"\W+", " ", "".join(char for char in value if not unicodedata.combining(char))).strip()


class PlaceLookupError(RuntimeError):
    """Provider unavailable, distinct from an unverified place match."""


def _destination_names(destination):
    raw = _normalized(destination.split(",")[0])
    names = {raw}
    if len(raw) == 3:
        names.update(name for name, code in AIRPORT_ALIASES.items() if code.lower() == raw and len(name) > 3)
    aliases = {"lisbon": "lisboa", "rome": "roma", "florence": "firenze", "munich": "munchen", "vienna": "wien"}
    names.update(aliases[name] for name in list(names) if name in aliases)
    return names


def _name_matches(item, stop):
    name = _normalized(item.get("title"))
    if len(name) < 4 or name in {"restaurant", "hotel", "museum", "park", "cafe", "airport"}:
        return False
    # Ignore activity verbs / appended street or city descriptions, not place identity.
    return any(f" {name} " in f" {_normalized(stop.get(key, ''))} " for key in ("title", "location"))


def lookup_place(stop, destination):
    if not os.getenv("SERPAPI_API_KEY"):
        return None
    query = f"{stop['location']}, {destination}"
    params = {"engine": "google_maps", "type": "search", "q": query}
    try:
        raw = json.loads(_cached_provider_call("places", 86400, params, lambda: json.dumps(_serpapi_get(params))))
        candidates = raw.get("local_results") or ([raw["place_results"]] if raw.get("place_results") else [])
        matches = []
        for item in candidates:
            gps = item.get("gps_coordinates") or {}
            point = {"lat": gps.get("latitude"), "lng": gps.get("longitude")}
            identity = item.get("place_id") or item.get("data_id")
            if not identity or not valid_point(point):
                continue
            if not _name_matches(item, stop):
                continue
            address = f" {_normalized(item.get('address', ''))} "
            if not any(f" {name} " in address for name in _destination_names(destination)):
                continue
            query = {"api": 1, "query": f"{item['title']}, {item.get('address', destination)}"}
            if item.get("place_id"):
                query["query_place_id"] = item["place_id"]
            matches.append({"coordinates": point, "source_id": identity, "source_url": "https://www.google.com/maps/search/?" + urlencode(query), "coordinate_source": "serpapi_google_maps"})
        unique = {item["source_id"]: item for item in matches}
        return next(iter(unique.values())) if len(unique) == 1 else None
    except Exception as exc:
        # Never include provider exception text: it may contain credential-bearing URLs.
        raise PlaceLookupError("Place search is temporarily unavailable.") from exc
