from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

import log_service
from database import get_db
from dependencies import verify_access


router = APIRouter()


@router.get("/api/logs")
def get_logs(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=200),
):
    return log_service.list_logs(db, limit)


@router.delete("/api/logs/{log_id}")
def delete_log(
    log_id: int,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    return log_service.delete_log(db, log_id)
