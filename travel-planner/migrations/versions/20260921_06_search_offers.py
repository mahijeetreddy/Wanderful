"""Account-owned searches, immutable offers, and selected trip offers."""
import sqlalchemy as sa
from alembic import op

revision = "20260921_06"
down_revision = "20260920_05"
branch_labels = None
depends_on = None


def upgrade():
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "search_sessions" not in existing:
        op.create_table("search_sessions",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("context", sa.JSON(), nullable=False),
            sa.Column("status", sa.String(20), nullable=False),
            sa.Column("result", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
        op.create_index("ix_search_sessions_user_id", "search_sessions", ["user_id"])
    if "offer_snapshots" not in existing:
        op.create_table("offer_snapshots",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("search_id", sa.String(64), sa.ForeignKey("search_sessions.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("offer", sa.JSON(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False))
        op.create_index("ix_offer_snapshots_search_id", "offer_snapshots", ["search_id"])
        op.create_index("ix_offer_snapshots_user_id", "offer_snapshots", ["user_id"])
    if "trip_selections" not in existing:
        op.create_table("trip_selections",
            sa.Column("id", sa.String(64), primary_key=True),
            sa.Column("trip_id", sa.Integer(), sa.ForeignKey("saved_trips.id", ondelete="CASCADE"), nullable=False),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("snapshot_id", sa.String(64), sa.ForeignKey("offer_snapshots.id"), nullable=False),
            sa.Column("status", sa.String(24), nullable=False),
            sa.Column("booking_reference", sa.String(160), nullable=False),
            sa.UniqueConstraint("trip_id", "kind", name="uq_trip_selection_kind"))
        op.create_index("ix_trip_selections_trip_id", "trip_selections", ["trip_id"])


def downgrade():
    for table in ("trip_selections", "offer_snapshots", "search_sessions"):
        op.drop_table(table)
