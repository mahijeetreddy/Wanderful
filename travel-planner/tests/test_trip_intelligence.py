from copy import deepcopy

import pytest

from trip_intelligence import (
    assess_trip,
    build_budget_guardian,
    build_disruption_scenarios,
    build_live_view,
    build_offline_pack,
    learned_preference_tags,
    normalize_budget_state,
    preview_adjustment,
    update_memory,
)


def _trip():
    return {
        "savedAt": "2026-09-19T10:00:00Z",
        "form": {"budget": "200"},
        "constraints": {"day-1-activity-1": "locked"},
        "structuredItinerary": {
            "days": [
                {
                    "day_number": 1,
                    "date": "2027-05-01",
                    "title": "Arrival",
                    "weather_note": "Heavy rain in the afternoon",
                    "estimated_cost": 400,
                    "activities": [
                        {"time": "10:00", "title": "Reserved tour", "indoor": False, "estimated_cost": 120, "source_url": "https://example.com/tour", "rank_score": 82},
                        {"time": "12:00", "title": "Museum", "indoor": True, "estimated_cost": 30, "source_url": "https://example.com/museum", "rank_score": 75},
                        {"time": "14:00", "title": "Park", "indoor": False, "estimated_cost": 0},
                        {"time": "16:00", "title": "Market", "indoor": False, "estimated_cost": 20},
                        {"time": "18:00", "title": "Dinner", "indoor": True, "estimated_cost": 80},
                        {"time": "20:00", "title": "Show", "indoor": True, "estimated_cost": 90},
                    ],
                }
            ]
        },
    }


def test_assess_trip_explains_risk_and_evidence():
    health = assess_trip(_trip())

    categories = {issue["category"] for issue in health["issues"]}
    assert {"weather", "fatigue", "budget", "trust"}.issubset(categories)
    assert health["score"] < 100
    assert health["evidence"][0]["confidence"] == "high"
    assert health["evidence"][0]["constraint"] == "locked"
    assert health["evidence"][0]["day_number"] == 1
    assert health["evidence"][0]["activity_index"] == 0
    assert health["evidence"][0]["freshness"] == "2026-09-19T10:00:00Z"


def test_assess_trip_rejects_unsafe_source_urls_and_prefers_source_freshness():
    trip = _trip()
    activities = trip["structuredItinerary"]["days"][0]["activities"]
    activities[0]["source_checked_at"] = "2026-09-18T12:00:00Z"
    activities[1]["source_url"] = "javascript:alert(1)"

    evidence = assess_trip(trip)["evidence"]

    assert evidence[0]["freshness"] == "2026-09-18T12:00:00Z"
    assert evidence[1]["source_url"] == ""
    assert evidence[1]["confidence"] == "medium"


def test_running_late_preview_preserves_locked_time():
    preview = preview_adjustment(_trip(), "running_late", 1)
    activities = preview["structuredItinerary"]["days"][0]["activities"]

    assert activities[0]["time"] == "10:00"
    assert activities[1]["time"] == "13:00"
    assert preview["changes"]


def test_tired_preview_keeps_locked_item_and_moves_extras_to_backup():
    preview = preview_adjustment(_trip(), "tired", 1)
    day = preview["structuredItinerary"]["days"][0]

    assert day["activities"][0]["title"] == "Reserved tour"
    assert len(day["activities"]) == 3
    assert "Optional if energy allows" in day["backup_plan"]


def test_preview_does_not_mutate_saved_trip():
    trip = _trip()
    original = deepcopy(trip)

    preview_adjustment(trip, "rain", 1)

    assert trip == original


def test_live_view_selects_next_upcoming_day():
    live = build_live_view(_trip())

    assert live["status"] == "ready"
    assert live["day"]["day_number"] == 1
    assert len(live["events"]) == 4


def test_budget_guardian_tracks_plan_actuals_and_reserve_pressure():
    trip = _trip()
    trip["form"]["currency_code"] = "USD"
    trip["structuredItinerary"]["budget_categories"] = [
        {"category": "Food", "amount": 100},
        {"category": "Activities", "amount": 90},
    ]
    trip["budgetState"] = {
        "reserve_percent": 10,
        "expenses": [{"id": "one", "label": "Dinner", "category": "Food", "amount": 130}],
    }

    guardian = build_budget_guardian(trip)

    assert guardian["committed"] == 190
    assert guardian["actual"] == 130
    assert guardian["reserve"] == 20
    assert guardian["status"] == "watch"
    assert any("Food" in alert for alert in guardian["alerts"])


def test_budget_state_rejects_invalid_expenses_and_bounds_reserve():
    state = normalize_budget_state({
        "reserve_percent": 80,
        "expenses": [{"amount": -5}, {"label": "Train", "amount": 40, "split_count": 0}],
    })

    assert state["reserve_percent"] == 50
    assert len(state["expenses"]) == 1
    assert state["expenses"][0]["split_count"] == 1


def test_offline_pack_is_compact_and_integrity_stamped():
    trip = {**_trip(), "id": "7", "name": "Rainy escape", "destination": "Seattle", "dateRange": "May 1"}

    pack = build_offline_pack(trip)

    assert pack["trip"]["id"] == "7"
    assert pack["days"][0]["title"] == "Arrival"
    assert len(pack["checksum"]) == 16
    assert pack["item_count"] == 7


def test_disruption_autopilot_returns_three_distinct_strategies():
    scenarios = build_disruption_scenarios(_trip(), "tired", 1)

    assert [scenario["strategy"] for scenario in scenarios] == ["protect", "balanced", "rescue"]
    assert len(scenarios[0]["structuredItinerary"]["days"][0]["activities"]) == 4
    assert len(scenarios[2]["structuredItinerary"]["days"][0]["activities"]) == 2


def test_memory_accumulates_taste_signals():
    first = update_memory({}, {"title": "Night market", "sentiment": "loved", "tags": ["food", "local"]})
    second = update_memory(first, {"title": "Food tour", "sentiment": "liked", "tags": ["food"]})

    assert second["signals"]["food"] == {"loved": 1, "liked": 1}
    assert second["recent_feedback"][0]["title"] == "Food tour"


def test_memory_rejects_unknown_sentiment():
    with pytest.raises(ValueError, match="sentiment"):
        update_memory({}, {"title": "Tour", "sentiment": "amazing", "tags": []})


def test_memory_rejects_non_list_tags_and_bounds_tag_length():
    with pytest.raises(ValueError, match="tags"):
        update_memory({}, {"title": "Tour", "sentiment": "loved", "tags": "food"})

    memory = update_memory({}, {"title": "Tour", "sentiment": "loved", "tags": ["x" * 200]})
    assert list(memory["signals"]) == ["x" * 80]


def test_learned_preferences_prioritize_positive_signals():
    memory = {
        "signals": {
            "food": {"loved": 2},
            "nightlife": {"liked": 1, "disliked": 2},
            "hiking": {"loved": 1, "skipped": 1},
        }
    }

    assert learned_preference_tags(memory) == ["food", "hiking"]
