import json
from unittest.mock import Mock, patch

import pytest
import requests

from direct_planner import complete_stream_days, generate_direct_plan, PlanningFailure, request_object, DraftDay
from evaluation import evaluate_itinerary
from main import TravelInputs
from tools import flight_airport_ids, _format_api_error, _serpapi_get


@pytest.mark.parametrize("value,expected", [("Rome", "FCO,CIA"), ("ROM", "FCO,CIA"), ("FCO", "FCO"), ("London", "LHR,LGW,LCY,STN,LTN,SEN"), ("Tokyo", "HND,NRT")])
def test_airport_groups_preserve_specific_airports(value, expected):
    assert flight_airport_ids(value) == expected


def test_network_errors_never_include_request_credentials():
    assert "SECRET" not in _format_api_error("Flight search failed", requests.ConnectionError("https://example.test?api_key=SECRET"))
    response = requests.Response()
    response.status_code = 400
    response._content = b"SECRET"
    assert "SECRET" not in _format_api_error("Flight search failed", requests.HTTPError(response=response))


def test_explicit_no_inventory_response_is_not_provider_failure(monkeypatch):
    monkeypatch.setenv("SERPAPI_API_KEY", "fixture")
    response = Mock()
    response.json.return_value = {"error": "Google Flights hasn't returned any results for this query."}
    with patch("tools.requests.get", return_value=response):
        assert _serpapi_get({"engine": "google_flights"}) == {"best_flights": [], "other_flights": []}


def test_stream_parser_ignores_embedded_days_string_and_incomplete_days():
    day = {"date": "2026-10-01", "title": "Museum"}
    text = '{"trip_summary": "escaped \\"days\\": []", "days": ['
    # Build the escaped string with the JSON encoder, including nested braces.
    text = '{"trip_summary": ' + json.dumps('a "days": [{fake}] string') + ', "days": ['
    assert complete_stream_days(text + json.dumps(day) + ', {"date":') == [day]
    assert complete_stream_days(text + '{"date":') == []


def test_quality_does_not_accept_wrong_dates_or_claim_grounding():
    result = evaluate_itinerary({"days": [{"day_number": 1, "date": "2026-10-02", "activities": [{"time": "10:00", "source_url": "https://unsupported.test"}]}]}, "2026-10-01", "2026-10-01", 100)
    assert result["missing_days"] == result["unexpected_days"] == result["unsupported_links"] == 1
    assert result["provider_grounding_rate"] == 0
    assert result["opening_hours_verified"] is None
    assert not result["passed"]


def test_bounded_object_failure_is_sanitized():
    with patch("direct_planner._request", side_effect=RuntimeError("SECRET")) as call:
        with pytest.raises(PlanningFailure) as exc:
            request_object("draft day", DraftDay, 10)
    assert "SECRET" not in str(exc.value)
    assert call.call_count == 1


def test_draft_days_publish_before_full_response_and_strip_sources():
    day = {"date": "2026-10-01", "title": "Museum", "activities": [{"time": "10:00", "title": "Explore", "location": "Rome", "description": "Visit", "estimated_cost": 10, "indoor": True, "source_url": "https://invented.test"}]}
    events = []
    def request(prompt, timeout, on_text):
        on_text('{"days": [' + json.dumps(day) + ',')
        assert len(events) == 1  # callback happened before request completion
        return json.dumps({"days": [day], "trip_summary": "Rome", "budget_categories": [], "logistics": [], "risks": []})
    with patch("direct_planner._request", side_effect=request):
        plan, metrics = generate_direct_plan(TravelInputs("LAX", "Rome", "2026-10-01", "2026-10-01", "100", "history"), {}, on_days=events.append)
    assert events[0][0]["activities"][0]["source_url"] == ""
    assert metrics["first_draft_day_ms"] >= 0
