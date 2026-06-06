from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import backup_service
from database import get_db
from dependencies import verify_access


router = APIRouter()


@router.get("/api/backups")
def get_backups(_: Annotated[None, Depends(verify_access)]):
    return backup_service.get_backup_overview()


@router.post("/api/backups/run")
def run_backup(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    return backup_service.run_manual_backup(db)


@router.delete("/api/backups/{date}")
def delete_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    return backup_service.delete_local_backup(date)


@router.delete("/api/backups/drive/{date}")
def delete_drive_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    return backup_service.delete_drive_backup(date)
