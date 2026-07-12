"""Production MVP schema.

Revision ID: 20260628_01
Revises:
"""
from alembic import op

from database import Base
import models  # noqa: F401


revision = "20260628_01"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
