"""add user password hash

Revision ID: 20260430_0002
Revises: 20260429_0001
Create Date: 2026-04-30 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "20260430_0002"
down_revision: Union[str, None] = "20260429_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "password_hash",
            sa.String(length=255),
            server_default="not_set",
            nullable=False,
        ),
    )
    op.alter_column("users", "password_hash", server_default=None)


def downgrade() -> None:
    op.drop_column("users", "password_hash")
