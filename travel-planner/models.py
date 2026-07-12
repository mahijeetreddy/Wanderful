from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    role: Mapped[str] = mapped_column(String(20), default="user")
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class SavedTrip(Base):
    __tablename__ = "saved_trips"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    destination: Mapped[str] = mapped_column(String(200))
    date_range: Mapped[str] = mapped_column(String(100))
    form_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    itinerary: Mapped[str] = mapped_column(Text)
    options_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    structured_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    result_tab: Mapped[str] = mapped_column(String(30), default="itinerary")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    user: Mapped[User] = relationship()


class UserPreference(Base):
    __tablename__ = "user_preferences"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    budget_style: Mapped[str] = mapped_column(String(80), default="")
    travel_style: Mapped[str] = mapped_column(String(120), default="")
    likes_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    dislikes_json: Mapped[list[str]] = mapped_column(JSON, default=list)
    home_airport: Mapped[str] = mapped_column(String(16), default="")
    preferred_currency: Mapped[str] = mapped_column(String(3), default="USD")
    date_of_birth: Mapped[str] = mapped_column(String(10), default="")
    age: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PlanJob(Base):
    __tablename__ = "plan_jobs"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_plan_job_user_idempotency"),
        Index("ix_plan_jobs_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    idempotency_key: Mapped[str] = mapped_column(String(128))
    status: Mapped[str] = mapped_column(String(30), default="queued", index=True)
    progress: Mapped[str] = mapped_column(String(300), default="Queued.")
    form_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    options_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    structured_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    metrics_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    itinerary: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str] = mapped_column(Text, default="")
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    token_usage: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class EvaluationResult(Base):
    __tablename__ = "evaluation_results"

    id: Mapped[int] = mapped_column(primary_key=True)
    plan_job_id: Mapped[str | None] = mapped_column(ForeignKey("plan_jobs.id", ondelete="SET NULL"), index=True)
    scenario_id: Mapped[str] = mapped_column(String(120), index=True)
    scores_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    passed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
