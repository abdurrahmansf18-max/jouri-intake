from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from db_models import ActivityLog


def list_logs(db: Session, limit: int) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    db.query(ActivityLog).filter(ActivityLog.created_at < cutoff).delete()
    db.commit()

    logs = (
        db.query(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "created_at": log.created_at.isoformat(),
            "action": log.action,
            "product_id": log.product_id,
            "product_title": log.product_title,
            "details": log.details,
        }
        for log in logs
    ]


def delete_log(db: Session, log_id: int) -> dict:
    log = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    db.delete(log)
    db.commit()
    return {"ok": True}
