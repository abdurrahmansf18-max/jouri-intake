"""add discount campaign fields

Revision ID: 005_discount_campaign_fields
Revises: 004_shopify_order_sync
Create Date: 2026-07-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "005_discount_campaign_fields"
down_revision: Union[str, None] = "004_shopify_order_sync"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {column["name"] for column in inspect(op.get_bind()).get_columns("products")}
    if "is_discounted" not in existing:
        op.add_column("products", sa.Column("is_discounted", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "compare_at_price_amount" not in existing:
        op.add_column("products", sa.Column("compare_at_price_amount", sa.String(), nullable=False, server_default=""))
    if "discount_note" not in existing:
        op.add_column("products", sa.Column("discount_note", sa.Text(), nullable=False, server_default=""))
    if "is_final_sale" not in existing:
        op.add_column("products", sa.Column("is_final_sale", sa.Boolean(), nullable=False, server_default=sa.false()))
    if "is_limited_time_deal" not in existing:
        op.add_column("products", sa.Column("is_limited_time_deal", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    existing = {column["name"] for column in inspect(op.get_bind()).get_columns("products")}
    for column in [
        "is_limited_time_deal",
        "is_final_sale",
        "discount_note",
        "compare_at_price_amount",
        "is_discounted",
    ]:
        if column in existing:
            op.drop_column("products", column)
