"""Bounded, process-local cache of public provider responses, never trip/user data.

Redis remains the shared cache. This fallback makes repeated local searches useful
without requiring Redis. Raw retrieval timestamps must remain unchanged.
"""
from collections import OrderedDict
from threading import Lock
from time import monotonic

_lock = Lock()
_entries: OrderedDict[str, tuple[float, str]] = OrderedDict()
MAX_ENTRIES = 128
MAX_RESPONSE_BYTES = 256_000


def get(key: str) -> str | None:
    with _lock:
        entry = _entries.get(key)
        if entry is None:
            return None
        expires, value = entry
        if expires <= monotonic():
            _entries.pop(key, None)
            return None
        _entries.move_to_end(key)
        return value


def put(key: str, value: str, seconds: int) -> None:
    if seconds <= 0 or len(value.encode("utf-8")) > MAX_RESPONSE_BYTES:
        return
    with _lock:
        _entries[key] = (monotonic() + seconds, value)
        _entries.move_to_end(key)
        while len(_entries) > MAX_ENTRIES:
            _entries.popitem(last=False)


def clear() -> None:
    with _lock:
        _entries.clear()
