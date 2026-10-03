import json
from unittest.mock import patch

import pytest
from places import lookup_place, PlaceLookupError


def resolve(items, stop=None, destination="Lisbon, Portugal"):
    with patch.dict("os.environ", {"SERPAPI_API_KEY": "fixture"}), patch("places._cached_provider_call", return_value=json.dumps({"local_results": items})):
        return lookup_place(stop or {"title": "Visit the Jeronimos Monastery", "location": "Jeronimos Monastery, Belem"}, destination)


def place(**updates):
    return {"title": "Jerónimos Monastery", "data_id": "0xabc:0x123", "address": "Praça do Império, Lisboa, Portugal", "gps_coordinates": {"latitude": 38.697, "longitude": -9.206}, **updates}


def test_verified_name_variations_and_local_city_name():
    result = resolve([place()])
    assert result["source_id"] == "0xabc:0x123"
    assert result["coordinates"] == {"lat": 38.697, "lng": -9.206}
    assert "query_place_id" not in result["source_url"]


def test_wrong_city_ambiguous_and_invalid_points_stay_unresolved():
    assert resolve([place(address="Paris, France")]) is None
    assert resolve([place(), place(data_id="other")]) is None
    assert resolve([place(gps_coordinates={"latitude": 100, "longitude": 5})]) is None
    assert resolve([place(title="Monastery Restaurant")]) is None


def test_duplicates_are_not_ambiguous_and_place_id_has_precise_link():
    result = resolve([place(place_id="verified"), place(place_id="verified")])
    assert "query_place_id=verified" in result["source_url"]


def test_provider_failure_not_silently_reported_as_no_match():
    with patch.dict("os.environ", {"SERPAPI_API_KEY": "fixture"}), patch("places._cached_provider_call", side_effect=RuntimeError("secret-url")):
        with pytest.raises(PlaceLookupError, match="temporarily unavailable") as error:
            lookup_place({"title": "Museum", "location": "Museum"}, "Rome")
        assert "secret" not in str(error.value)


def test_airport_destination_alias_and_word_boundaries():
    stop = {"title": "Visit Golden Gate Bridge", "location": "Golden Gate Bridge, San Francisco"}
    assert resolve([place(title="Golden Gate Bridge", address="San Francisco, CA")], stop, "SFO")
    assert not resolve([place(title="Golden Gate Bridge", address="San Franciscoland")], stop, "SFO")
