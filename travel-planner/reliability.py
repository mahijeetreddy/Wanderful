from __future__ import annotations

import random
import time
from typing import Any, Callable

from runtime_store import redis_client


FAILURE_MARKERS = (
    "search failed",
    "network error",
    "request timed out",
    "http 429",
    "http 500",
    "http 502",
    "http 503",
    "http 504",
)


def provider_call(
    provider: str,
    call: Callable[[], Any],
    *,
    retries: int = 2,
    failure_threshold: int = 4,
    open_seconds: int = 60,
) -> Any:
    client = redis_client()
    open_key = f"wanderful:circuit:{provider}:open"
    failure_key = f"wanderful:circuit:{provider}:failures"
    if client and client.get(open_key):
        raise RuntimeError(f"{provider} circuit is temporarily open.")

    last_result: Any = None
    for attempt in range(retries + 1):
        try:
            result = call()
            last_result = result
            if _failed_result(result):
                raise RuntimeError(str(result))
            if client:
                client.delete(failure_key)
            return result
        except Exception:
            if attempt < retries:
                time.sleep((2**attempt) + random.uniform(0.05, 0.35))
                continue
            if client:
                failures = int(client.incr(failure_key))
                client.expire(failure_key, open_seconds * 2)
                if failures >= failure_threshold:
                    client.setex(open_key, open_seconds, "1")
            raise
    return last_result


def increment_metric(name: str, amount: int = 1) -> None:
    client = redis_client()
    if not client:
        return
    key = f"wanderful:metrics:{name}"
    client.incrby(key, amount)
    client.expire(key, 7 * 24 * 3600)


def _failed_result(value: Any) -> bool:
    lowered = str(value).lower()
    return any(marker in lowered for marker in FAILURE_MARKERS)
