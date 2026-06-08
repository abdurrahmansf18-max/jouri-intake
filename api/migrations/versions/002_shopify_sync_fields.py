"""Add Shopify sync fields

Revision ID: 002
Revises: 001
Create Date: 2026-06-08 00:00:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {column["name"] for column in inspect(op.get_bind()).get_columns("products")}
    if "shopify_product_id" not in existing:
        op.add_column("products", sa.Column("shopify_product_id", sa.String(), nullable=True))
    if "shopify_product_handle" not in existing:
        op.add_column("products", sa.Column("shopify_product_handle", sa.String(), nullable=True))
    if "shopify_synced_at" not in existing:
        op.add_column("products", sa.Column("shopify_synced_at", sa.DateTime(timezone=True), nullable=True))
    if "shopify_last_error" not in existing:
        op.add_column("products", sa.Column("shopify_last_error", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("products", "shopify_last_error")
    op.drop_column("products", "shopify_synced_at")
    op.drop_column("products", "shopify_product_handle")
    op.drop_column("products", "shopify_product_id")
