from datetime import date, timedelta

from auth_store import create_user, set_user_status


def _register(client):
    return client.post(
        "/api/auth/register",
        json={"name": "Admin", "email": "admin@example.com", "password": "long-password"},
    )


def _create_trip(client) -> int:
    start = date.today() + timedelta(days=20)
    payload = {
        "name": "Seattle",
        "destination": "Seattle",
        "dateRange": "Upcoming",
        "form": {"budget": "1000", "start_date": start.isoformat(), "end_date": start.isoformat()},
        "itinerary": "Day 1",
        "structuredItinerary": {
            "days": [
                {
                    "day_number": 1,
                    "date": start.isoformat(),
                    "title": "Explore",
                    "activities": [
                        {"time": "10:00", "title": "Market", "estimated_cost": 25, "indoor": False}
                    ],
                }
            ]
        },
    }
    response = client.post("/api/trips", json=payload)
    assert response.status_code == 201
    return int(response.get_json()["trip"]["id"])


def test_trip_intelligence_constraint_preview_apply_and_memory(client):
    _register(client)
    trip_id = _create_trip(client)

    intelligence = client.get(f"/api/trips/{trip_id}/intelligence")
    assert intelligence.status_code == 200
    assert "health" in intelligence.get_json()
    assert "live" in intelligence.get_json()

    constrained = client.put(
        f"/api/trips/{trip_id}/constraints",
        json={"constraints": {"day-1-activity-1": "locked", "bad": "unsupported"}},
    )
    assert constrained.status_code == 200
    assert constrained.get_json()["trip"]["constraints"] == {"day-1-activity-1": "locked"}

    preview = client.post(
        f"/api/trips/{trip_id}/live-adjust",
        json={"event": "running_late", "day_number": 1, "apply": False},
    )
    assert preview.status_code == 200
    assert preview.get_json()["preview"]["structuredItinerary"]["days"][0]["activities"][0]["time"] == "10:00"

    applied = client.post(
        f"/api/trips/{trip_id}/live-adjust",
        json={"event": "rain", "day_number": 1, "apply": True},
    )
    assert applied.status_code == 200
    assert applied.get_json()["trip"]["liveState"]["last_event"] == "rain"

    feedback = client.post(
        f"/api/trips/{trip_id}/feedback",
        json={"title": "Market", "sentiment": "loved", "tags": ["food", "local"]},
    )
    assert feedback.status_code == 201
    assert feedback.get_json()["preferences"]["memory"]["signals"]["food"]["loved"] == 1


def test_trip_intelligence_enforces_ownership(client):
    _register(client)
    trip_id = _create_trip(client)
    other = create_user("Other", "other-intel@example.com", "long-password")
    set_user_status(1, other["id"], "active")
    client.post("/api/auth/logout")
    client.post(
        "/api/auth/login",
        json={"email": "other-intel@example.com", "password": "long-password"},
    )

    assert client.get(f"/api/trips/{trip_id}/intelligence").status_code == 404


def test_trip_intelligence_bounds_constraint_payload(client):
    _register(client)
    trip_id = _create_trip(client)

    response = client.put(
        f"/api/trips/{trip_id}/constraints",
        json={"constraints": {f"activity-{index}": "optional" for index in range(501)}},
    )

    assert response.status_code == 400
    assert "500 activity constraints" in response.get_json()["error"]


def test_budget_offline_pack_and_disruption_workflow(client):
    _register(client)
    trip_id = _create_trip(client)

    budget = client.put(
        f"/api/trips/{trip_id}/budget",
        json={"reserve_percent": 15, "expenses": [{"id": "meal", "label": "Lunch", "category": "Food", "amount": 32}]},
    )
    assert budget.status_code == 200
    assert budget.get_json()["budget"]["actual"] == 32
    assert budget.get_json()["trip"]["budgetState"]["reserve_percent"] == 15

    offline = client.get(f"/api/trips/{trip_id}/offline-pack")
    assert offline.status_code == 200
    assert offline.get_json()["pack"]["trip"]["destination"] == "Seattle"

    preview = client.post(
        f"/api/trips/{trip_id}/disruptions",
        json={"event": "running_late", "day_number": 1, "apply": False},
    )
    assert preview.status_code == 200
    assert len(preview.get_json()["scenarios"]) == 3
    assert "structuredItinerary" not in preview.get_json()["scenarios"][0]

    applied = client.post(
        f"/api/trips/{trip_id}/disruptions",
        json={"event": "running_late", "strategy": "balanced", "day_number": 1, "apply": True},
    )
    assert applied.status_code == 200
    assert applied.get_json()["trip"]["disruptionHistory"][0]["strategy"] == "balanced"
