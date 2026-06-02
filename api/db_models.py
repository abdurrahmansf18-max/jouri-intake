from datetime import datetime, timezone
from sqlalchemy import Column, String, Integer, Text, DateTime, JSON
from database import Base


class Product(Base):
    __tablename__ = "products"

    id = Column(String, primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    folder_name = Column(String, nullable=False)
    folder_path = Column(Text, nullable=False)
    description = Column(Text, nullable=False, default="")
    status = Column(String, nullable=False, default="pending")
    notes = Column(Text, nullable=False, default="")
    stock_quantity = Column(Integer, nullable=False, default=1)
    sold_quantity = Column(Integer, nullable=False, default=0)
    last_sold_at = Column(DateTime(timezone=True), nullable=True)
    title_raw = Column(String, nullable=False, default="")
    category = Column(String, nullable=False, default="")
    product_type = Column(String, nullable=False, default="")
    price_amount = Column(String, nullable=False, default="")
    currency = Column(String, nullable=False, default="")
    color_raw = Column(String, nullable=False, default="")
    color_german = Column(String, nullable=False, default="")
    sizes_raw = Column(String, nullable=False, default="")
    tags = Column(JSON, nullable=False, default=list)
    images = Column(JSON, nullable=False, default=list)
    sale_history = Column(JSON, nullable=False, default=list)
    size_stocks = Column(JSON, nullable=True, default=None)
    sold_sizes = Column(JSON, nullable=True, default=None)


class ActivityLog(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    created_at = Column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
    )
    action = Column(String, nullable=False)
    product_id = Column(String, nullable=True)
    product_title = Column(String, nullable=True)
    details = Column(JSON, nullable=True)
