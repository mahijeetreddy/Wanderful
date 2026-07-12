from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from redis import Redis
from sqlalchemy import delete, select

from config import settings
from database import Base, engine, ensure_local_column, session_scope
from models import PlanJob


_redis: Redis | None = None
_rq_redis: Redis | None = None


def init_runtime_store() -> None:
    if not settings.production:
        Base.metadata.create_all(engine)
        ensure_local_column("plan_jobs", "user_id", "integer not null default 0")
        ensure_local_column("plan_jobs", "idempotency_key", "varchar(128) not null default ''")
        ensure_local_column("plan_jobs", "retry_count", "integer not null default 0")
        ensure_local_column("plan_jobs", "token_usage", "integer not null default 0")
        ensure_local_column("plan_jobs", "cancel_requested", "boolean not null default 0")
        ensure_local_column("plan_jobs", "expires_at", "datetime")


def redis_client() -> Redis | None:
    global _redis
    if not settings.redis_url:
        return None
    if _redis is None:
        _redis = Redis.from_url(settings.redis_url, decode_responses=True, socket_timeout=5)
    return _redis


def rq_redis_client() -> Redis | None:
    """RQ pickles job payloads into Redis hashes; it needs raw bytes back; decode_responses=True
    (used by redis_client() for our own JSON string cache) breaks RQ's own hgetall reads."""
    global _rq_redis
    if not settings.redis_url:
        return None
    if _rq_redis is None:
        _rq_redis = Redis.from_url(settings.redis_url, decode_responses=False, socket_timeout=5)
    return _rq_redis


def redis_ready() -> bool:
    client = redis_client()
    if not client:
        return False
    try:
        return bool(client.ping())
    except Exception:
        return False


def metrics_snapshot() -> dict[str, int]:
    client = redis_client()
    if not client:
        return {}
    result: dict[str, int] = {}
    try:
        for raw_key in client.scan_iter("wanderful:metrics:*", count=100):
            key = str(raw_key).split(":")[-1]
            result[key] = int(client.get(raw_key) or 0)
    except Exception:
        return {}
    return result


def get_cached_response(cache_key: str) -> Any | None:
    client = redis_client()
    if not client:
        return None
    try:
        value = client.get(f"wanderful:cache:{cache_key}")
        return json.loads(value) if value else None
    except (json.JSONDecodeError, Exception):
        return None


def set_cached_response(cache_key: str, provider: str, response: Any, ttl_seconds: int) -> None:
    client = redis_client()
    if not client:
        return
    payload = json.dumps({"provider": provider, "value": response})
    # Store the raw value separately for backwards-compatible reads.
    client.setex(f"wanderful:cache:{cache_key}", max(1, ttl_seconds), json.dumps(response))
    client.setex(f"wanderful:cachemeta:{cache_key}", max(1, ttl_seconds), payload)


def create_plan_job(
    job_id: str,
    user_id: int,
    idempotency_key: str,
    form: dict[str, Any],
) -> dict[str, Any]:
    existing = find_idempotent_job(user_id, idempotency_key)
    if existing:
        return existing
    now = datetime.now(timezone.utc)
    job = PlanJob(
        id=job_id,
        user_id=user_id,
        idempotency_key=idempotency_key,
        status="queued",
        progress="Queued trip planning job.",
        form_json=form,
        expires_at=now + timedelta(hours=settings.job_retention_hours),
    )
    with session_scope() as db:
        db.add(job)
        db.flush()
    return get_plan_job(job_id, user_id) or {}


def find_idempotent_job(user_id: int, idempotency_key: str) -> dict[str, Any] | None:
    with session_scope() as db:
        job = db.scalar(
            select(PlanJob).where(
                PlanJob.user_id == user_id,
                PlanJob.idempotency_key == idempotency_key,
            )
        )
        return _job_dict(job) if job else None


def update_plan_job(
    job_id: str,
    *,
    status: str | None = None,
    progress: str | None = None,
    options: dict[str, Any] | None = None,
    structured_itinerary: dict[str, Any] | None = None,
    metrics: dict[str, Any] | None = None,
    itinerary: str | None = None,
    error: str | None = None,
    retry_count: int | None = None,
    token_usage: int | None = None,
) -> None:
    with session_scope() as db:
        job = db.get(PlanJob, job_id)
        if not job:
            return
        if status is not None:
            job.status = status
        if progress is not None:
            job.progress = progress[:300]
        if options is not None:
            job.options_json = options
        if structured_itinerary is not None:
            job.structured_json = structured_itinerary
        if metrics is not None:
            job.metrics_json = metrics
        if itinerary is not None:
            job.itinerary = itinerary
        if error is not None:
            job.error = error
        if retry_count is not None:
            job.retry_count = retry_count
        if token_usage is not None:
            job.token_usage = token_usage


def update_plan_job_locks(
    job_id: str,
    user_id: int,
    *,
    locked_hotel_id: str | None = None,
    locked_flight_id: str | None = None,
) -> dict[str, Any] | None:
    with session_scope() as db:
        job = db.scalar(
            select(PlanJob).where(PlanJob.id == job_id, PlanJob.user_id == user_id)
        )
        if not job or job.status != "complete" or not job.structured_json:
            return None
        structured = dict(job.structured_json)
        if locked_hotel_id is not None:
            structured["locked_hotel_id"] = locked_hotel_id
        if locked_flight_id is not None:
            structured["locked_flight_id"] = locked_flight_id
        job.structured_json = structured
        db.flush()
        return _job_dict(job)


def get_plan_job(job_id: str, user_id: int | None = None) -> dict[str, Any] | None:
    with session_scope() as db:
        query = select(PlanJob).where(PlanJob.id == job_id)
        if user_id is not None:
            query = query.where(PlanJob.user_id == user_id)
        job = db.scalar(query)
        return _job_dict(job) if job else None


def list_plan_jobs(user_id: int, limit: int = 20) -> list[dict[str, Any]]:
    with session_scope() as db:
        jobs = db.scalars(
            select(PlanJob)
            .where(PlanJob.user_id == user_id)
            .order_by(PlanJob.created_at.desc())
            .limit(max(1, min(limit, 100)))
        ).all()
        return [_job_dict(job) for job in jobs]


def request_job_cancellation(job_id: str, user_id: int) -> bool:
    with session_scope() as db:
        job = db.scalar(
            select(PlanJob).where(PlanJob.id == job_id, PlanJob.user_id == user_id)
        )
        if not job or job.status in {"complete", "failed", "cancelled"}:
            return False
        job.cancel_requested = True
        if job.status == "queued":
            job.status = "cancelled"
            job.progress = "Cancelled before execution."
        return True


def begin_day_regeneration(job_id: str, user_id: int) -> bool:
    with session_scope() as db:
        job = db.scalar(
            select(PlanJob).where(PlanJob.id == job_id, PlanJob.user_id == user_id)
        )
        if not job or job.status != "complete":
            return False
        job.status = "regenerating"
        job.progress = "Regenerating this day."
        return True


def cancellation_requested(job_id: str) -> bool:
    with session_scope() as db:
        job = db.get(PlanJob, job_id)
        return bool(job and job.cancel_requested)


def active_job_count(user_id: int) -> int:
    with session_scope() as db:
        jobs = db.scalars(
            select(PlanJob).where(
                PlanJob.user_id == user_id,
                PlanJob.status.in_(("queued", "collecting", "planning")),
            )
        ).all()
        return len(jobs)


def completed_jobs_since(user_id: int, since: datetime) -> int:
    with session_scope() as db:
        jobs = db.scalars(
            select(PlanJob).where(
                PlanJob.user_id == user_id,
                PlanJob.status == "complete",
                PlanJob.created_at >= since,
            )
        ).all()
        return len(jobs)


def cleanup_expired_jobs() -> int:
    with session_scope() as db:
        result = db.execute(
            delete(PlanJob).where(
                PlanJob.expires_at.is_not(None),
                PlanJob.expires_at < datetime.now(timezone.utc),
            )
        )
        return int(result.rowcount or 0)


def _job_dict(job: PlanJob) -> dict[str, Any]:
    return {
        "id": job.id,
        "user_id": job.user_id,
        "status": job.status,
        "progress": job.progress,
        "form": job.form_json or {},
        "options": job.options_json or {},
        "structured_itinerary": job.structured_json or {},
        "metrics": job.metrics_json or {},
        "itinerary": job.itinerary,
        "error": job.error,
        "retry_count": job.retry_count,
        "token_usage": job.token_usage,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at.isoformat(),
        "updated_at": job.updated_at.isoformat(),
        "expires_at": job.expires_at.isoformat() if job.expires_at else None,
    }
