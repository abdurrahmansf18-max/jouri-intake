"""add fabric_type column

Revision ID: 007
Revises: 006
Create Date: 2026-09-25 19:22:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = '007'
down_revision: Union[str, None] = '006_product_barcodes'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('products', sa.Column('fabric_type', sa.String(), server_default='', nullable=False))


def downgrade() -> None:
    op.drop_column('products', 'fabric_type')
