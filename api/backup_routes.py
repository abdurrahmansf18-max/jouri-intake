from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends

import backup_service
from dependencies import verify_access


router = APIRouter()


@router.get("/api/backups")
def get_backups(_: Annotated[None, Depends(verify_access)]):
    return backup_service.get_backup_overview()


@router.post("/api/backups/run")
def run_backup(
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
):
    return backup_service.start_manual_backup(background_tasks)


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
