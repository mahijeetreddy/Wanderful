"""Add optimistic concurrency versioning without rewriting saved trip payloads."""
import sqlalchemy as sa
from alembic import op

revision = "20260923_07"
down_revision = "20260921_06"
branch_labels = None
depends_on = None


def upgrade():
    columns = {column["name"] for column in sa.inspect(op.get_bind()).get_columns("saved_trips")}
    if "revision" not in columns:
        op.add_column("saved_trips", sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))


def downgrade():
    with op.batch_alter_table("saved_trips") as batch:
        batch.drop_column("revision")
