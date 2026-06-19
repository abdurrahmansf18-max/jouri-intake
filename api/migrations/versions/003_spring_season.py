"""replace mid season with spring

Revision ID: 003_spring_season
Revises: 081d8d6165f9
Create Date: 2026-06-19
"""
from typing import Sequence, Union
from alembic import op


revision: str = "003_spring_season"
down_revision: Union[str, None] = "081d8d6165f9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_VALUES = (
    "Mid-season",
    "mid-season",
    "Midseason",
    "midseason",
    "Mid-seasonal",
    "midseasonal",
    "Mevsimlik",
    "mevsimlik",
    "Mid sezon",
    "mid sezon",
)


def upgrade() -> None:
    for value in OLD_VALUES:
        op.execute(
            "UPDATE products SET season = 'Spring' WHERE season = " + repr(value)
        )


def downgrade() -> None:
    op.execute("UPDATE products SET season = 'Mid-season' WHERE season = 'Spring'")
