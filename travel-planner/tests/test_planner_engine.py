from unittest.mock import patch

import pytest

from guidebook_schema import GuidebookContent
from itinerary_schema import ActivityBlock, StructuredDay, StructuredItinerary
from main import TravelInputs
from planner_engine import _expand_day, generate_guidebook_content, generate_structured_plan, regenerate_single_day


def _travel_inputs() -> TravelInputs:
    return TravelInputs(
        origin="LAX",
        destination="Rome",
        start_date="2026-09-01",
        end_date="2026-09-02",
        budget="2000",
        interests="food and history",
        currency_code="USD",
        adults=1,
    )


def _plan() -> StructuredItinerary:
    return StructuredItinerary(
        origin="LAX",
        destination="Rome",
        start_date="2026-09-01",
        end_date="2026-09-02",
        days=[
            StructuredDay(
                day_number=1,
                date="2026-09-01",
                title="Original day one",
                activities=[ActivityBlock(title="Original activity", estimated_cost=10)],
            ),
            StructuredDay(
                day_number=2,
                date="2026-09-02",
                title="Original day two",
                activities=[ActivityBlock(title="Untouched activity", estimated_cost=20)],
            ),
        ],
    )


def test_regenerate_single_day_only_replaces_target_day():
    travel_inputs = _travel_inputs()
    plan = _plan()
    regenerated_day = StructuredDay(
        day_number=1,
        date="2026-09-01",
        title="Regenerated day one",
        activities=[ActivityBlock(title="New activity", estimated_cost=15)],
    )

    with patch("planner_engine._expand_day", return_value=regenerated_day) as expand_day:
        updated = regenerate_single_day(travel_inputs, {"options": {}}, plan, 1)

    expand_day.assert_called_once()
    assert updated.days[0].title == "Regenerated day one"
    assert updated.days[0].activities[0].title == "New activity"
    assert updated.days[1].title == "Original day two"
    assert updated.days[1].activities[0].title == "Untouched activity"


def test_generate_structured_plan_uses_single_pass_fast_path(monkeypatch):
    monkeypatch.setenv("FAST_PLAN_MODE", "true")
    with patch("planner_engine._generate_complete_plan", return_value=_plan()) as generate:
        plan, metrics = generate_structured_plan(_travel_inputs(), {"options": {}})

    generate.assert_called_once()
    assert len(plan.days) == 2
    assert metrics["planning_mode"] == "single_pass"
    assert metrics["llm_calls"] == 1


def test_regenerate_single_day_raises_for_unknown_day_number():
    travel_inputs = _travel_inputs()
    plan = _plan()

    with patch("planner_engine._expand_day") as expand_day:
        with pytest.raises(ValueError):
            regenerate_single_day(travel_inputs, {"options": {}}, plan, 99)

    expand_day.assert_not_called()


def test_regenerate_single_day_resolves_locked_options_by_id():
    travel_inputs = _travel_inputs()
    plan = _plan()
    plan.locked_hotel_id = "hotel-1"
    plan.locked_flight_id = "flight-1"
    trip_data = {
        "options": {
            "hotels": [{"id": "hotel-1", "name": "Grand Hotel"}, {"id": "hotel-2", "name": "Other Hotel"}],
            "flights": [{"id": "flight-1", "total_price": 400}],
        }
    }
    regenerated_day = StructuredDay(day_number=1, date="2026-09-01", title="Regenerated")

    with patch("planner_engine._expand_day", return_value=regenerated_day) as expand_day:
        regenerate_single_day(travel_inputs, trip_data, plan, 1)

    _, kwargs = expand_day.call_args
    assert kwargs["locked_hotel"] == {"id": "hotel-1", "name": "Grand Hotel"}
    assert kwargs["locked_flight"] == {"id": "flight-1", "total_price": 400}


def test_expand_day_prompt_mentions_locked_hotel():
    travel_inputs = _travel_inputs()
    day = StructuredDay(day_number=1, date="2026-09-01", title="Day one")
    locked_hotel = {"id": "hotel-1", "name": "Grand Hotel", "description": "Central boutique stay"}
    captured_prompt = {}

    def fake_run_json_task(role, prompt):
        captured_prompt["value"] = prompt
        return day.model_dump_json()

    with patch("planner_engine._run_json_task", side_effect=fake_run_json_task):
        _expand_day(travel_inputs, {"options": {}}, day, locked_hotel=locked_hotel, locked_flight=None)

    assert "Grand Hotel" in captured_prompt["value"]
    assert "home base" in captured_prompt["value"]


def test_generate_guidebook_content_parses_llm_json():
    fake_response = (
        '{"overview": "Rome blends ancient ruins with modern life.", '
        '"currency_code": "EUR", "currency_notes": "Cards widely accepted.", '
        '"language_basics": ["Ciao", "Grazie"], "local_customs": ["Dress modestly for churches."], '
        '"safety_tips": ["Watch for pickpockets near stations."], '
        '"packing_notes": ["Comfortable walking shoes."], "transport_tips": ["Validate bus tickets before boarding."]}'
    )
    with patch("planner_engine._run_json_task", return_value=fake_response):
        content = generate_guidebook_content("Rome", "2026-09-01", "2026-09-05", "food and history")

    assert isinstance(content, GuidebookContent)
    assert content.currency_code == "EUR"
    assert "Ciao" in content.language_basics
    assert "Validate bus tickets before boarding." in content.transport_tips


def test_generate_guidebook_content_falls_back_on_llm_failure():
    with patch("planner_engine._run_json_task", side_effect=RuntimeError("provider unavailable")):
        content = generate_guidebook_content("Rome", "2026-09-01", "2026-09-05", "food and history")

    assert isinstance(content, GuidebookContent)
    assert "Rome" in content.overview
