from datetime import datetime, timezone
from sqlalchemy.orm import Session
from db_models import ActivityLog


def log(
    db: Session,
    action: str,
    product_id: str | None = None,
    product_title: str | None = None,
    details: dict | None = None,
) -> None:
    entry = ActivityLog(
        created_at=datetime.now(timezone.utc),
        action=action,
        product_id=product_id,
        product_title=product_title,
        details=details,
    )
    db.add(entry)
    db.flush()
