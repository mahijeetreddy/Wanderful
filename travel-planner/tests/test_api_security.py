from unittest.mock import patch

from runtime_store import update_plan_job


TRIP = {
    "origin": "LAX",
    "destination": "SEA",
    "start_date": "2026-08-01",
    "end_date": "2026-08-04",
    "budget": "2000",
    "currency_code": "USD",
    "adults": 1,
    "interests": "food and hiking",
}


def register(client, name: str, email: str):
    return client.post("/api/auth/register", json={"name": name, "email": email, "password": "long-password"})


def test_pending_user_is_blocked_until_admin_approval(client):
    pending = register(client, "Pending User", "pending@example.com")
    assert pending.status_code == 201
    assert pending.get_json()["user"]["status"] == "pending"
    blocked = client.post("/api/plan-jobs", json=TRIP, headers={"Idempotency-Key": "pending-job"})
    assert blocked.status_code == 403

    client.post("/api/auth/logout")
    admin = register(client, "Admin", "admin@example.com")
    assert admin.get_json()["user"]["role"] == "admin"
    pending_users = client.get("/api/admin/users").get_json()["users"]
    user_id = pending_users[0]["id"]
    assert client.post(f"/api/admin/users/{user_id}/approve").status_code == 200

    client.post("/api/auth/logout")
    client.post("/api/auth/login", json={"email": "pending@example.com", "password": "long-password"})
    with patch("web_app.enqueue_plan_job", return_value="test"):
        created = client.post("/api/plan-jobs", json=TRIP, headers={"Idempotency-Key": "approved-job"})
    assert created.status_code == 202


def test_job_ownership_is_enforced(client):
    register(client, "Admin", "admin@example.com")
    with patch("web_app.enqueue_plan_job", return_value="test"):
        created = client.post("/api/plan-jobs", json=TRIP, headers={"Idempotency-Key": "owner-job"})
    job_id = created.get_json()["job_id"]
    client.post("/api/auth/logout")
    register(client, "Other", "other@example.com")
    assert client.get(f"/api/plan-jobs/{job_id}").status_code == 403


def test_api_404_is_json(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.is_json


def test_lock_route_updates_completed_job_and_enforces_ownership(client):
    register(client, "Admin", "admin@example.com")
    with patch("web_app.enqueue_plan_job", return_value="test"):
        created = client.post("/api/plan-jobs", json=TRIP, headers={"Idempotency-Key": "lock-job"})
    job_id = created.get_json()["job_id"]
    update_plan_job(job_id, status="complete", structured_itinerary={"days": [{"day_number": 1}]})

    locked = client.patch(f"/api/plan-jobs/{job_id}/locks", json={"locked_hotel_id": "hotel-1"})
    assert locked.status_code == 200
    assert locked.get_json()["job"]["structured_itinerary"]["locked_hotel_id"] == "hotel-1"

    client.post("/api/auth/logout")
    register(client, "Other", "other@example.com")
    forbidden = client.patch(f"/api/plan-jobs/{job_id}/locks", json={"locked_hotel_id": "hotel-2"})
    assert forbidden.status_code == 403


def test_regenerate_day_route_validates_day_number_and_job_state(client):
    register(client, "Admin", "admin@example.com")
    with patch("web_app.enqueue_plan_job", return_value="test"):
        created = client.post("/api/plan-jobs", json=TRIP, headers={"Idempotency-Key": "regen-job"})
    job_id = created.get_json()["job_id"]

    not_complete = client.post(f"/api/plan-jobs/{job_id}/regenerate-day", json={"day_number": 1})
    assert not_complete.status_code == 409

    update_plan_job(job_id, status="complete", structured_itinerary={"days": [{"day_number": 1}]})

    bad_day_number = client.post(f"/api/plan-jobs/{job_id}/regenerate-day", json={"day_number": "not-a-number"})
    assert bad_day_number.status_code == 400

    unknown_day = client.post(f"/api/plan-jobs/{job_id}/regenerate-day", json={"day_number": 99})
    assert unknown_day.status_code == 404

    with patch("web_app.enqueue_regenerate_day_job", return_value="test"):
        started = client.post(f"/api/plan-jobs/{job_id}/regenerate-day", json={"day_number": 1})
    assert started.status_code == 202

    already_running = client.post(f"/api/plan-jobs/{job_id}/regenerate-day", json={"day_number": 1})
    assert already_running.status_code == 409
