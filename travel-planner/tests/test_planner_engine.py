from unittest.mock import patch

import pytest

from itinerary_schema import ActivityBlock, StructuredDay, StructuredItinerary
from main import TravelInputs
from planner_engine import regenerate_single_day


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


def test_regenerate_single_day_raises_for_unknown_day_number():
    travel_inputs = _travel_inputs()
    plan = _plan()

    with patch("planner_engine._expand_day") as expand_day:
        with pytest.raises(ValueError):
            regenerate_single_day(travel_inputs, {"options": {}}, plan, 99)

    expand_day.assert_not_called()
