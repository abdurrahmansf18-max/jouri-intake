"""Initial schema — products and activity_logs tables

Revision ID: 001
Revises:
Create Date: 2025-01-01 00:00:00.000000
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "products",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("folder_name", sa.String(), nullable=False),
        sa.Column("folder_path", sa.Text(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(), nullable=False, server_default="pending"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("stock_quantity", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("sold_quantity", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_sold_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("title_raw", sa.String(), nullable=False, server_default=""),
        sa.Column("german_title", sa.String(), nullable=False, server_default=""),
        sa.Column("category", sa.String(), nullable=False, server_default=""),
        sa.Column("product_type", sa.String(), nullable=False, server_default=""),
        sa.Column("price_amount", sa.String(), nullable=False, server_default=""),
        sa.Column("currency", sa.String(), nullable=False, server_default=""),
        sa.Column("color_raw", sa.String(), nullable=False, server_default=""),
        sa.Column("color_german", sa.String(), nullable=False, server_default=""),
        sa.Column("sizes_raw", sa.String(), nullable=False, server_default=""),
        sa.Column("tags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("images", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("sale_history", sa.JSON(), nullable=False, server_default="[]"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("product_id", sa.String(), nullable=True),
        sa.Column("product_title", sa.String(), nullable=True),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_activity_logs_created_at", "activity_logs", ["created_at"])
    op.create_index("ix_products_status", "products", ["status"])
    op.create_index("ix_products_created_at", "products", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_products_created_at", "products")
    op.drop_index("ix_products_status", "products")
    op.drop_index("ix_activity_logs_created_at", "activity_logs")
    op.drop_table("activity_logs")
    op.drop_table("products")
