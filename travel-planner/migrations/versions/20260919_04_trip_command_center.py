"""Budget guardian and disruption history.

Revision ID: 20260919_04
Revises: 20260919_03
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260919_04"
down_revision = "20260919_03"
branch_labels = None
depends_on = None


def _columns(table: str) -> set[str]:
    return {column["name"] for column in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    columns = _columns("saved_trips")
    if "budget_state_json" not in columns:
        op.add_column("saved_trips", sa.Column("budget_state_json", sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
    if "disruption_history_json" not in columns:
        op.add_column("saved_trips", sa.Column("disruption_history_json", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))


def downgrade() -> None:
    op.drop_column("saved_trips", "disruption_history_json")
    op.drop_column("saved_trips", "budget_state_json")
