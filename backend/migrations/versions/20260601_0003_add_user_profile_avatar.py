"""add user profile avatar fields

Revision ID: 20260601_0003
Revises: 20260430_0002
Create Date: 2026-06-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260601_0003"
down_revision: Union[str, None] = "20260430_0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("avatar_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("avatar_data_url", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "avatar_data_url")
    op.drop_column("users", "avatar_id")
