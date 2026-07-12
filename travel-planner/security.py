from __future__ import annotations

import secrets
from functools import wraps
from typing import Any, Callable, TypeVar

from flask import jsonify, request, session

from auth_store import get_user
from config import settings


F = TypeVar("F", bound=Callable[..., Any])
CSRF_EXEMPT_PATHS = {
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/password/request-reset",
    "/api/auth/password/reset",
}


def csrf_token() -> str:
    token = session.get("csrf_token")
    if not token:
        token = secrets.token_urlsafe(32)
        session["csrf_token"] = token
    return str(token)


def validate_csrf() -> tuple[Any, int] | None:
    if not settings.csrf_enforced or request.method in {"GET", "HEAD", "OPTIONS"}:
        return None
    if request.path in CSRF_EXEMPT_PATHS:
        return None
    supplied = request.headers.get("X-CSRF-Token", "")
    expected = session.get("csrf_token", "")
    if not supplied or not expected or not secrets.compare_digest(supplied, str(expected)):
        return jsonify({"error": "Invalid CSRF token."}), 403
    return None


def current_user(require_active: bool = False) -> dict[str, Any]:
    user_id = session.get("user_id")
    if not user_id:
        raise PermissionError("Sign in to use this feature.")
    user = get_user(int(user_id))
    if not user:
        session.clear()
        raise PermissionError("Your session is no longer valid.")
    if require_active and user["status"] != "active":
        raise PermissionError("Your account is awaiting administrator approval.")
    return user


def require_active_user(function: F) -> F:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any):
        try:
            current_user(require_active=True)
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 403
        return function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]


def require_admin(function: F) -> F:
    @wraps(function)
    def wrapped(*args: Any, **kwargs: Any):
        try:
            user = current_user(require_active=True)
        except PermissionError as exc:
            return jsonify({"error": str(exc)}), 403
        if user["role"] != "admin":
            return jsonify({"error": "Admin access required."}), 403
        return function(*args, **kwargs)

    return wrapped  # type: ignore[return-value]
