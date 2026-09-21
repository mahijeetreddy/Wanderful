"""Private travel document vault.

Revision ID: 20260920_05
Revises: 20260919_04
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect


revision = "20260920_05"
down_revision = "20260919_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "travel_documents" in set(inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "travel_documents",
        sa.Column("id", sa.String(length=64), nullable=False),
        sa.Column("saved_trip_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=240), nullable=False),
        sa.Column("category", sa.String(length=40), nullable=False, server_default="Other"),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_name", sa.String(length=160), nullable=False),
        sa.Column("expires_on", sa.String(length=10), nullable=False, server_default=""),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["saved_trip_id"], ["saved_trips.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_name"),
    )
    op.create_index("ix_travel_documents_trip", "travel_documents", ["saved_trip_id", "created_at"])
    op.create_index("ix_travel_documents_saved_trip_id", "travel_documents", ["saved_trip_id"])
    op.create_index("ix_travel_documents_user_id", "travel_documents", ["user_id"])


def downgrade() -> None:
    if "travel_documents" not in set(inspect(op.get_bind()).get_table_names()):
        return
    op.drop_index("ix_travel_documents_user_id", table_name="travel_documents")
    op.drop_index("ix_travel_documents_saved_trip_id", table_name="travel_documents")
    op.drop_index("ix_travel_documents_trip", table_name="travel_documents")
    op.drop_table("travel_documents")
