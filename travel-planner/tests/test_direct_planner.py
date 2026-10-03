import json
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from direct_planner import PlanningFailure, compact_context, generate_direct_plan
from main import TravelInputs
from tools import _timeout, has_interactive_budget, interactive_provider_budget


def inputs():
    return TravelInputs("LAX", "Rome", "2026-10-01", "2026-10-02", "2000", "history", "EUR", 2)


def draft(dates=("2026-10-01", "2026-10-02")):
    return {"trip_summary": "Rome", "budget_categories": [{"category": "Travel", "amount": 1000}], "logistics": [], "risks": [], "days": [
        {"date": day, "title": day, "activities": [{"time": "10:00", "title": f"Museum {day}", "location": "Rome", "description": "Explore the museum.", "estimated_cost": 20, "indoor": True, "source_url": "https://invented.example"}]} for day in dates
    ]}


def test_direct_plan_owns_metadata_and_rejects_invented_sources():
    with patch("direct_planner._request", return_value=json.dumps(draft())) as request:
        plan, metrics = generate_direct_plan(inputs(), {})
    assert plan.currency_code == "EUR" and plan.adults == 2
    assert [day.day_number for day in plan.days] == [1, 2]
    assert plan.days[0].activities[0].source_url == ""
    assert metrics["llm_calls"] == 1
    assert 0 < request.call_args.args[1] <= 50


def test_repairs_only_missing_day_and_keeps_valid_day():
    repair = draft()
    repair["days"][0]["title"] = "Should not replace retained day"
    with patch("direct_planner._request", side_effect=[json.dumps(draft(("2026-10-01",))), json.dumps(repair)]) as request:
        plan, metrics = generate_direct_plan(inputs(), {})
    assert request.call_count == 2
    assert plan.days[0].title == "2026-10-01"
    assert metrics["repaired_dates"] == ["2026-10-02"]
    assert "Repair only" in request.call_args.args[0]


@pytest.mark.parametrize("response", ["not JSON", json.dumps(draft(()))])
def test_bad_output_does_not_start_another_pipeline(response):
    with patch("direct_planner._request", return_value=response) as request:
        with pytest.raises(PlanningFailure) as error:
            generate_direct_plan(inputs(), {})
    assert request.call_count == 1
    assert error.value.metrics["failure_category"] == "invalid_output"


def test_provider_failure_is_sanitized_and_not_retried():
    with patch("direct_planner._request", side_effect=RuntimeError("secret-api-key")) as request:
        with pytest.raises(PlanningFailure) as error:
            generate_direct_plan(inputs(), {})
    assert "secret" not in str(error.value)
    assert error.value.metrics["llm_calls"] == request.call_count == 1


def test_late_generation_result_is_rejected(monkeypatch):
    monkeypatch.setenv("PLAN_GENERATION_SECONDS", "10")
    with patch("direct_planner._request", return_value=json.dumps(draft())), patch("direct_planner.time.perf_counter", side_effect=[0, 0, 0, 11, 11, 11]):
        with pytest.raises(PlanningFailure) as error:
            generate_direct_plan(inputs(), {})
    assert error.value.metrics["failure_category"] == "timeout"


def test_provider_budget_is_thread_context_local_and_restored():
    assert not has_interactive_budget()
    with interactive_provider_budget(3):
        assert has_interactive_budget()
        assert 0 < _timeout() <= 3
    assert not has_interactive_budget()


def test_context_keeps_valid_json_and_omits_raw_offers():
    context = compact_context({"provider_results": {"flights": "secret raw offer", "local_search": "failed"}, "options": {"flights": [{"id": "f1", "raw": "large"}]}})
    assert json.loads(json.dumps(context))["flights"] == [{"id": "f1", "segments": []}]


def test_gemini_timeout_schema_and_retry_configuration(monkeypatch):
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("LLM_MODEL", "gemini-2.5-flash")
    from direct_planner import _request
    with patch("google.genai.Client") as client:
        client.return_value.__enter__.return_value.models.generate_content.return_value = SimpleNamespace(text="{}")
        assert _request("prompt", 12) == "{}"
    config = client.call_args.kwargs["http_options"]
    assert config.timeout == 12000
    assert config.retry_options.attempts == 1
