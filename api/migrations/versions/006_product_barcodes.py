"""Add product barcode metadata.

Revision ID: 006_product_barcodes
Revises: 005_discount_campaign_fields
Create Date: 2026-08-10
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006_product_barcodes"
down_revision: Union[str, None] = "005_discount_campaign_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("products", sa.Column("barcodes", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "barcodes")
