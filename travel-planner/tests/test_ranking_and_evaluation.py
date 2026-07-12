from evaluation import evaluate_itinerary
from evaluations.scenarios import evaluation_scenarios
from ranking import rank_flights, rank_hotels


def test_evaluation_corpus_has_fifty_cases():
    assert len(evaluation_scenarios()) == 50


def test_rankings_prefer_budget_and_complete_options():
    hotels = rank_hotels(
        [
            {"id": "good", "rating": 4.8, "extracted_nightly_rate": 180, "amenities": ["hiking"]},
            {"id": "bad", "rating": 3.0, "extracted_nightly_rate": 600, "amenities": []},
        ],
        200,
        "hiking",
        None,
    )
    flights = rank_flights(
        [
            {"id": "good", "total_price": 300, "total_duration_minutes": 120, "layovers": [], "has_return_details": True},
            {"id": "bad", "total_price": 800, "total_duration_minutes": 400, "layovers": [{}], "has_return_details": False},
        ],
        500,
    )
    assert hotels[0]["id"] == "good"
    assert flights[0]["id"] == "good"


def test_evaluator_detects_missing_days_and_conflicts():
    result = evaluate_itinerary(
        {
            "estimated_total": 1200,
            "days": [
                {
                    "day_number": 1,
                    "date": "2026-08-01",
                    "activities": [{"time": "10:00"}, {"time": "10:00"}],
                }
            ],
        },
        "2026-08-01",
        "2026-08-03",
        1000,
    )
    assert result["missing_days"] == 2
    assert result["schedule_conflicts"] == 1
    assert result["budget_overrun"] == 200
