"""Trip constraints, live state, and preference memory.

Revision ID: 20260919_03
Revises: 20260713_02
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260919_03"
down_revision = "20260713_02"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    saved_trip_columns = _columns("saved_trips")
    if "constraints_json" not in saved_trip_columns:
        op.add_column("saved_trips", sa.Column("constraints_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "live_state_json" not in saved_trip_columns:
        op.add_column("saved_trips", sa.Column("live_state_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "memory_json" not in _columns("user_preferences"):
        op.add_column("user_preferences", sa.Column("memory_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))


def downgrade() -> None:
    op.drop_column("user_preferences", "memory_json")
    op.drop_column("saved_trips", "live_state_json")
    op.drop_column("saved_trips", "constraints_json")
