from dataclasses import replace

import pytest

from config import get_settings, validate_production_settings


def test_development_settings_do_not_require_production_services():
    settings = replace(get_settings(), environment="development", redis_url="")

    validate_production_settings(settings)


def test_production_settings_fail_fast_when_insecure():
    settings = replace(
        get_settings(),
        environment="production",
        database_url="sqlite:///wanderful.db",
        migration_database_url="sqlite:///wanderful.db",
        redis_url="",
        auth_secret_key="dev-only-change-me",
        admin_emails=(),
        secure_cookies=False,
        csrf_enforced=False,
    )

    with pytest.raises(RuntimeError) as raised:
        validate_production_settings(settings)

    message = str(raised.value)
    assert "DATABASE_URL" in message
    assert "REDIS_URL" in message
    assert "AUTH_SECRET_KEY" in message
    assert "ADMIN_EMAILS" in message
    assert "SECURE_COOKIES" in message
    assert "CSRF_ENFORCED" in message


def test_secure_production_settings_are_accepted():
    settings = replace(
        get_settings(),
        environment="production",
        database_url="postgresql+psycopg://runtime.example/wanderful",
        migration_database_url="postgresql+psycopg://direct.example/wanderful",
        redis_url="rediss://cache.example/0",
        auth_secret_key="a" * 48,
        admin_emails=("admin@example.com",),
        secure_cookies=True,
        csrf_enforced=True,
    )

    validate_production_settings(settings)
