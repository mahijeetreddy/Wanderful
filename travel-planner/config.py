from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    environment: str
    database_url: str
    migration_database_url: str
    redis_url: str
    auth_secret_key: str
    admin_emails: tuple[str, ...]
    frontend_origin: str
    secure_cookies: bool
    csrf_enforced: bool
    planning_enabled: bool
    plans_per_day: int
    concurrent_plans_per_user: int
    max_trip_days: int
    max_activity_replacements_per_day: int
    max_provider_retries_per_day: int
    job_timeout_seconds: int
    job_retention_hours: int
    sentry_dsn: str
    smtp_host: str
    smtp_port: int
    smtp_username: str
    smtp_password: str
    smtp_from_email: str
    admin_notification_email: str

    @property
    def production(self) -> bool:
        return self.environment == "production"


def get_settings() -> Settings:
    runtime_db = Path(".crewai_runtime") / "wanderful.db"
    default_database_url = f"sqlite:///{runtime_db.as_posix()}"

    def normalize_database_url(value: str) -> str:
        if value.startswith("postgres://"):
            return value.replace("postgres://", "postgresql+psycopg://", 1)
        if value.startswith("postgresql://") and "+psycopg" not in value:
            return value.replace("postgresql://", "postgresql+psycopg://", 1)
        return value

    database_url = normalize_database_url(os.getenv("DATABASE_URL", default_database_url))
    migration_database_url = normalize_database_url(
        os.getenv("MIGRATION_DATABASE_URL", database_url)
    )
    admin_emails = tuple(
        email.strip().lower()
        for email in os.getenv("ADMIN_EMAILS", "").split(",")
        if email.strip()
    )
    environment = os.getenv("APP_ENV", "development").strip().lower()
    return Settings(
        environment=environment,
        database_url=database_url,
        migration_database_url=migration_database_url,
        redis_url=os.getenv("REDIS_URL", "").strip(),
        auth_secret_key=os.getenv("AUTH_SECRET_KEY", "dev-only-change-me"),
        admin_emails=admin_emails,
        frontend_origin=os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:5173").rstrip("/"),
        secure_cookies=_bool("SECURE_COOKIES", environment == "production"),
        csrf_enforced=_bool("CSRF_ENFORCED", environment == "production"),
        planning_enabled=_bool("PLANNING_ENABLED", True),
        plans_per_day=max(1, _int("PLANS_PER_DAY", 3)),
        concurrent_plans_per_user=max(1, _int("CONCURRENT_PLANS_PER_USER", 1)),
        max_trip_days=max(2, _int("MAX_TRIP_DAYS", 14)),
        max_activity_replacements_per_day=max(1, _int("MAX_ACTIVITY_REPLACEMENTS_PER_DAY", 10)),
        max_provider_retries_per_day=max(1, _int("MAX_PROVIDER_RETRIES_PER_DAY", 20)),
        job_timeout_seconds=max(60, _int("JOB_TIMEOUT_SECONDS", 600)),
        job_retention_hours=max(1, _int("JOB_RETENTION_HOURS", 72)),
        sentry_dsn=os.getenv("SENTRY_DSN", "").strip(),
        smtp_host=os.getenv("SMTP_HOST", "").strip(),
        smtp_port=_int("SMTP_PORT", 587),
        smtp_username=os.getenv("SMTP_USERNAME", "").strip(),
        smtp_password=os.getenv("SMTP_PASSWORD", "").strip(),
        smtp_from_email=os.getenv("SMTP_FROM_EMAIL", "").strip(),
        admin_notification_email=os.getenv("ADMIN_NOTIFICATION_EMAIL", "").strip(),
    )


settings = get_settings()
