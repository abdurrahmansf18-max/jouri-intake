"""add Shopify order sync fields

Revision ID: 004_shopify_order_sync
Revises: 003_spring_season
Create Date: 2026-06-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "004_shopify_order_sync"
down_revision: Union[str, None] = "003_spring_season"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {column["name"] for column in inspect(op.get_bind()).get_columns("products")}
    if "shopify_last_inventory_sync_at" not in existing:
        op.add_column("products", sa.Column("shopify_last_inventory_sync_at", sa.DateTime(timezone=True), nullable=True))
    if "shopify_last_order_sync_at" not in existing:
        op.add_column("products", sa.Column("shopify_last_order_sync_at", sa.DateTime(timezone=True), nullable=True))
    if "shopify_variants" not in existing:
        op.add_column("products", sa.Column("shopify_variants", sa.JSON(), nullable=True))
    if "shopify_order_history" not in existing:
        op.add_column("products", sa.Column("shopify_order_history", sa.JSON(), nullable=True))


def downgrade() -> None:
    existing = {column["name"] for column in inspect(op.get_bind()).get_columns("products")}
    if "shopify_order_history" in existing:
        op.drop_column("products", "shopify_order_history")
    if "shopify_variants" in existing:
        op.drop_column("products", "shopify_variants")
    if "shopify_last_order_sync_at" in existing:
        op.drop_column("products", "shopify_last_order_sync_at")
    if "shopify_last_inventory_sync_at" in existing:
        op.drop_column("products", "shopify_last_inventory_sync_at")
