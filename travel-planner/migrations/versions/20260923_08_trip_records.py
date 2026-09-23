"""Individual money/group records and revision history; legacy JSON is retained."""
import sqlalchemy as sa
from alembic import op

revision = "20260923_08"
down_revision = "20260923_07"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "trip_records" not in existing:
        op.create_table("trip_records",
            sa.Column("trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("id", sa.String(100), primary_key=True),
            sa.Column("kind", sa.String(24), nullable=False),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
        op.create_index("ix_trip_records_kind", "trip_records", ["kind"])
    if "trip_history" not in existing:
        op.create_table("trip_history",
            sa.Column("trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), primary_key=True),
            sa.Column("revision", sa.Integer(), primary_key=True),
            sa.Column("payload", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))


def downgrade():
    op.drop_table("trip_history")
    op.drop_table("trip_records")
