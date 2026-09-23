"""Conservative attraction lookup through the existing SerpAPI provider.

Contract: https://serpapi.com/maps-local-results
Weather geocoding is deliberately not used for attraction identities.
"""
import json
import os
import re
from urllib.parse import urlencode
from data_collector import _cached_provider_call
from decisions import valid_point
from tools import _serpapi_get


def _normalized(value):
    return re.sub(r"\W+", " ", str(value).casefold()).strip()


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
            identity = item.get("place_id")
            if not identity or not valid_point(point):
                continue
            if _normalized(item.get("title")) not in {_normalized(stop["title"]), _normalized(stop["location"])}:
                continue
            if _normalized(destination) not in _normalized(item.get("address", "")):
                continue
            matches.append({"coordinates": point, "source_id": identity, "source_url": "https://www.google.com/maps/search/?" + urlencode({"api": 1, "query": item["title"], "query_place_id": identity}), "coordinate_source": "serpapi_google_maps"})
        return matches[0] if len(matches) == 1 else None
    except Exception:
        return None
