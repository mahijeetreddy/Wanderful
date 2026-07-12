from __future__ import annotations

import uuid
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from rq import Queue, Retry

from config import settings
from job_tasks import execute_plan_job, regenerate_plan_job_day
from runtime_store import rq_redis_client


_local_executor = ThreadPoolExecutor(max_workers=max(1, int(__import__("os").getenv("PLAN_WORKERS", "2"))))


def enqueue_plan_job(job_id: str, travel_input_values: dict[str, Any]) -> str:
    client = rq_redis_client()
    if client:
        queue = Queue("planning", connection=client, default_timeout=settings.job_timeout_seconds)
        queue.enqueue(
            execute_plan_job,
            job_id,
            travel_input_values,
            job_id=job_id,
            retry=Retry(max=2, interval=[10, 30]),
            result_ttl=settings.job_retention_hours * 3600,
            failure_ttl=settings.job_retention_hours * 3600,
        )
        return "rq"
    if settings.production:
        raise RuntimeError("REDIS_URL is required in production.")
    _local_executor.submit(execute_plan_job, job_id, travel_input_values)
    return "local"


def enqueue_regenerate_day_job(job_id: str, day_number: int, travel_input_values: dict[str, Any]) -> str:
    client = rq_redis_client()
    rq_job_id = f"{job_id}-day{day_number}-{uuid.uuid4().hex[:8]}"
    if client:
        queue = Queue("planning", connection=client, default_timeout=settings.job_timeout_seconds)
        queue.enqueue(
            regenerate_plan_job_day,
            job_id,
            day_number,
            travel_input_values,
            job_id=rq_job_id,
            retry=Retry(max=1, interval=[10]),
            result_ttl=settings.job_retention_hours * 3600,
            failure_ttl=settings.job_retention_hours * 3600,
        )
        return "rq"
    if settings.production:
        raise RuntimeError("REDIS_URL is required in production.")
    _local_executor.submit(regenerate_plan_job_day, job_id, day_number, travel_input_values)
    return "local"
