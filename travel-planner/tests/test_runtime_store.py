from unittest.mock import Mock, patch
import pytest
from auth_store import create_user


@pytest.fixture(autouse=True)
def planning_owner(reset_database):
    owner = create_user("Planner", "admin@example.com", "test-password")
    assert owner["id"] == 1

from runtime_store import (
    begin_day_regeneration,
    create_plan_job,
    redis_ready,
    update_plan_job,
    update_plan_job_locks,
)


def test_redis_ready_returns_ping_result():
    client = Mock()
    client.ping.return_value = True

    with patch("runtime_store.redis_client", return_value=client):
        assert redis_ready() is True


def test_update_plan_job_locks_merges_without_clobbering_other_keys():
    job = create_plan_job("lock-job", 1, "lock-key", {"destination": "Rome"})
    update_plan_job(
        job["id"],
        status="complete",
        structured_itinerary={"destination": "Rome", "days": [{"day_number": 1}]},
    )

    updated = update_plan_job_locks(job["id"], 1, locked_hotel_id="hotel-1")

    assert updated is not None
    assert updated["structured_itinerary"]["locked_hotel_id"] == "hotel-1"
    assert updated["structured_itinerary"]["destination"] == "Rome"
    assert updated["structured_itinerary"]["days"] == [{"day_number": 1}]


def test_update_plan_job_locks_rejects_wrong_owner():
    job = create_plan_job("lock-job-2", 1, "lock-key-2", {})
    update_plan_job(job["id"], status="complete", structured_itinerary={"days": []})

    assert update_plan_job_locks(job["id"], 2, locked_hotel_id="hotel-1") is None


def test_update_plan_job_locks_requires_complete_status():
    job = create_plan_job("lock-job-3", 1, "lock-key-3", {})

    assert update_plan_job_locks(job["id"], 1, locked_hotel_id="hotel-1") is None


def test_begin_day_regeneration_flips_status_once():
    job = create_plan_job("regen-job", 1, "regen-key", {})
    update_plan_job(job["id"], status="complete", structured_itinerary={"days": []})

    assert begin_day_regeneration(job["id"], 1) is True
    assert begin_day_regeneration(job["id"], 1) is False


def test_update_plan_job_locks_applies_real_price_to_budget():
    job = create_plan_job("lock-price-job", 1, "lock-price-key", {})
    update_plan_job(
        job["id"],
        status="complete",
        options={"hotels": [{"id": "hotel-1", "name": "Grand Hotel", "estimated_total": 500}], "flights": []},
        structured_itinerary={
            "days": [],
            "budget_categories": [{"category": "Hotels", "amount": 300, "note": "Planning allocation"}],
            "estimated_total": 300,
        },
    )

    locked = update_plan_job_locks(job["id"], 1, locked_hotel_id="hotel-1")
    hotels_category = next(c for c in locked["structured_itinerary"]["budget_categories"] if c["category"] == "Hotels")

    assert hotels_category["amount"] == 500
    assert hotels_category["base_amount"] == 300
    assert hotels_category["note"] == "Locked: Grand Hotel"
    assert locked["structured_itinerary"]["estimated_total"] == 500

    unlocked = update_plan_job_locks(job["id"], 1, locked_hotel_id="")
    hotels_category = next(c for c in unlocked["structured_itinerary"]["budget_categories"] if c["category"] == "Hotels")

    assert hotels_category["amount"] == 300
    assert unlocked["structured_itinerary"]["estimated_total"] == 300


def test_update_plan_job_locks_with_unknown_option_id_is_noop():
    job = create_plan_job("lock-unknown-job", 1, "lock-unknown-key", {})
    update_plan_job(
        job["id"],
        status="complete",
        options={"hotels": [], "flights": []},
        structured_itinerary={
            "days": [],
            "budget_categories": [{"category": "Hotels", "amount": 300, "note": "Planning allocation"}],
            "estimated_total": 300,
        },
    )

    locked = update_plan_job_locks(job["id"], 1, locked_hotel_id="missing-hotel")
    hotels_category = next(c for c in locked["structured_itinerary"]["budget_categories"] if c["category"] == "Hotels")

    assert hotels_category["amount"] == 300
    assert hotels_category["note"] == "Planning allocation"
