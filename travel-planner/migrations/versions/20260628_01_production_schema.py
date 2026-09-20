"""Production MVP schema.

Revision ID: 20260628_01
Revises:
"""
import sqlalchemy as sa
from alembic import op


revision = "20260628_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("approved_by", sa.Integer(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_status", "users", ["status"])

    op.create_table(
        "saved_trips",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("destination", sa.String(length=200), nullable=False),
        sa.Column("date_range", sa.String(length=100), nullable=False),
        sa.Column("form_json", sa.JSON(), nullable=False),
        sa.Column("itinerary", sa.Text(), nullable=False),
        sa.Column("options_json", sa.JSON(), nullable=False),
        sa.Column("structured_json", sa.JSON(), nullable=False),
        sa.Column("result_tab", sa.String(length=30), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_saved_trips_user_id", "saved_trips", ["user_id"])

    op.create_table(
        "user_preferences",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("budget_style", sa.String(length=80), nullable=False),
        sa.Column("travel_style", sa.String(length=120), nullable=False),
        sa.Column("likes_json", sa.JSON(), nullable=False),
        sa.Column("dislikes_json", sa.JSON(), nullable=False),
        sa.Column("home_airport", sa.String(length=16), nullable=False),
        sa.Column("preferred_currency", sa.String(length=3), nullable=False),
        sa.Column("date_of_birth", sa.String(length=10), nullable=False),
        sa.Column("age", sa.Integer(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    op.create_table(
        "plan_jobs",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column("progress", sa.String(length=300), nullable=False),
        sa.Column("form_json", sa.JSON(), nullable=False),
        sa.Column("options_json", sa.JSON(), nullable=False),
        sa.Column("structured_json", sa.JSON(), nullable=False),
        sa.Column("metrics_json", sa.JSON(), nullable=False),
        sa.Column("itinerary", sa.Text(), nullable=False),
        sa.Column("error", sa.Text(), nullable=False),
        sa.Column("retry_count", sa.Integer(), nullable=False),
        sa.Column("token_usage", sa.Integer(), nullable=False),
        sa.Column("cancel_requested", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_plan_job_user_idempotency"),
    )
    op.create_index("ix_plan_jobs_user_id", "plan_jobs", ["user_id"])
    op.create_index("ix_plan_jobs_status", "plan_jobs", ["status"])
    op.create_index("ix_plan_jobs_expires_at", "plan_jobs", ["expires_at"])
    op.create_index("ix_plan_jobs_user_status", "plan_jobs", ["user_id", "status"])

    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_tokens_token_hash", "password_reset_tokens", ["token_hash"], unique=True)

    op.create_table(
        "evaluation_results",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("plan_job_id", sa.String(length=64), sa.ForeignKey("plan_jobs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("scenario_id", sa.String(length=120), nullable=False),
        sa.Column("scores_json", sa.JSON(), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_evaluation_results_plan_job_id", "evaluation_results", ["plan_job_id"])
    op.create_index("ix_evaluation_results_scenario_id", "evaluation_results", ["scenario_id"])


def downgrade() -> None:
    op.drop_table("evaluation_results")
    op.drop_table("password_reset_tokens")
    op.drop_table("plan_jobs")
    op.drop_table("user_preferences")
    op.drop_table("saved_trips")
    op.drop_table("users")
