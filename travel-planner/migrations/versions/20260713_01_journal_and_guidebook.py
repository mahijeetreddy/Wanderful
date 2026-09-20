"""Journal and guidebook tables.

Revision ID: 20260713_01
Revises: 20260628_01
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260713_01"
down_revision = "20260628_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Older development builds called metadata.create_all() against PostgreSQL,
    # so these tables may predate their Alembic revision. Preserve that data and
    # let Alembic assume ownership instead of failing the upgrade.
    existing = set(inspect(op.get_bind()).get_table_names())
    if "journal_entries" not in existing:
        op.create_table(
            "journal_entries",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("saved_trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("body", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_journal_entries_saved_trip_id", "journal_entries", ["saved_trip_id"])
        op.create_index("ix_journal_entries_user_id", "journal_entries", ["user_id"])
        op.create_index("ix_journal_entries_trip", "journal_entries", ["saved_trip_id", "created_at"])
    if "guidebooks" not in existing:
        op.create_table(
            "guidebooks",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("saved_trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("content_json", sa.JSON(), nullable=False),
            sa.Column("error", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("saved_trip_id", name="uq_guidebook_trip"),
        )
        op.create_index("ix_guidebooks_saved_trip_id", "guidebooks", ["saved_trip_id"])
        op.create_index("ix_guidebooks_user_id", "guidebooks", ["user_id"])


def downgrade() -> None:
    op.drop_table("guidebooks")
    op.drop_table("journal_entries")
