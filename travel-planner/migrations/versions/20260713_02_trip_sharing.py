"""Public trip sharing table.

Revision ID: 20260713_02
Revises: 20260713_01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260713_02"
down_revision = "20260713_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    existing = set(inspect(op.get_bind()).get_table_names())
    if "trip_shares" not in existing:
        op.create_table(
            "trip_shares",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("saved_trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("saved_trip_id", name="uq_trip_share_trip"),
        )
        op.create_index("ix_trip_shares_saved_trip_id", "trip_shares", ["saved_trip_id"])
        op.create_index("ix_trip_shares_user_id", "trip_shares", ["user_id"])
        op.create_index("ix_trip_shares_token", "trip_shares", ["token"], unique=True)


def downgrade() -> None:
    op.drop_table("trip_shares")
