from dataclasses import replace
from unittest.mock import Mock, call, patch

import pytest

import job_tasks
import queue_service
import worker
from config import settings


TRAVEL_INPUTS = {
    "origin": "LAX",
    "destination": "SEA",
    "start_date": "2027-05-01",
    "end_date": "2027-05-04",
    "budget": "2000.00",
    "interests": "food and hiking",
    "currency_code": "USD",
    "adults": 1,
}


def test_local_queue_submits_plan_job_when_redis_is_absent():
    with patch("queue_service.rq_redis_client", return_value=None), patch.object(queue_service._local_executor, "submit") as submit:
        backend = queue_service.enqueue_plan_job("job-1", TRAVEL_INPUTS)

    assert backend == "local"
    submit.assert_called_once_with(queue_service.execute_plan_job, "job-1", TRAVEL_INPUTS)


def test_production_queue_refuses_silent_local_fallback():
    production = replace(settings, environment="production")
    with patch("queue_service.settings", production), patch("queue_service.rq_redis_client", return_value=None):
        with pytest.raises(RuntimeError, match="REDIS_URL"):
            queue_service.enqueue_plan_job("job-1", TRAVEL_INPUTS)


def test_redis_queue_uses_bounded_retry_and_retention():
    redis = Mock()
    queue = Mock()
    with patch("queue_service.rq_redis_client", return_value=redis), patch("queue_service.Queue", return_value=queue):
        backend = queue_service.enqueue_plan_job("job-1", TRAVEL_INPUTS)

    assert backend == "rq"
    kwargs = queue.enqueue.call_args.kwargs
    assert kwargs["job_id"] == "job-1"
    assert kwargs["retry"].max == 2
    assert kwargs["result_ttl"] == settings.job_retention_hours * 3600
    assert kwargs["failure_ttl"] == settings.job_retention_hours * 3600


def test_execute_plan_job_completes_and_sends_notification():
    structured = Mock()
    structured.model_dump.return_value = {"days": [{"day_number": 1}]}
    updates = Mock()
    with (
        patch("job_tasks.cancellation_requested", return_value=False),
        patch("job_tasks.collect_trip_data", return_value={"options": {"hotels": []}}),
        patch("job_tasks.generate_structured_plan", return_value=(structured, {"tokens": 12})),
        patch("job_tasks.render_itinerary_markdown", return_value="# Trip"),
        patch("job_tasks.update_plan_job", updates),
        patch("job_tasks.get_plan_job", return_value={"user_id": 7}),
        patch("job_tasks.get_user", return_value={"email": "traveler@example.com"}),
        patch("job_tasks.send_plan_ready") as send_email,
    ):
        job_tasks.execute_plan_job("job-1", TRAVEL_INPUTS)

    assert [item.kwargs["status"] for item in updates.call_args_list] == ["collecting", "planning", "complete"]
    send_email.assert_called_once_with("traveler@example.com", "job-1", "SEA")


def test_execute_plan_job_preserves_safe_provider_error():
    updates = Mock()
    with (
        patch("job_tasks.cancellation_requested", return_value=False),
        patch("job_tasks.collect_trip_data", side_effect=TimeoutError("provider timeout")),
        patch("job_tasks.update_plan_job", updates),
    ):
        job_tasks.execute_plan_job("job-1", TRAVEL_INPUTS)

    assert updates.call_args_list[-1] == call(
        "job-1",
        status="failed",
        progress="Planner failed.",
        error="Planning timed out while waiting for an external provider.",
    )


def test_execute_plan_job_honors_early_cancellation():
    with patch("job_tasks.cancellation_requested", return_value=True), patch("job_tasks.update_plan_job") as update, patch("job_tasks.collect_trip_data") as collect:
        job_tasks.execute_plan_job("job-1", TRAVEL_INPUTS)

    update.assert_called_once_with("job-1", status="cancelled", progress="Planning cancelled.")
    collect.assert_not_called()


def test_worker_requires_redis_connection():
    with patch("worker.validate_production_settings"), patch("worker.rq_redis_client", return_value=None):
        with pytest.raises(RuntimeError, match="REDIS_URL"):
            worker.main()
