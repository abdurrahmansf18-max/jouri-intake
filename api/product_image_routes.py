from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import activity_logger
import auth_service
import file_manager
import image_ai_service
import product_service
from database import get_db
from dependencies import verify_access
from models import AiImageGenerateRequest, ProductRecord
from realtime import ws_manager


router = APIRouter()

_IMAGE_LOCKED_STATUSES = {"ai_enhanced", "published", "sold_archive"}


@router.post("/api/products/{product_id}/images", response_model=ProductRecord)
async def add_product_images(
    product_id: str,
    _: Annotated[None, Depends(verify_access)],
    jouri_edit_unlock: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
    images: Annotated[list[UploadFile], File()] = [],
):
    if not images:
        raise HTTPException(status_code=422, detail={"code": "ERR_IMAGE_REQUIRED"})

    p = product_service.get_or_404(db, product_id)
    if p.status in _IMAGE_LOCKED_STATUSES and not auth_service.is_valid_edit_unlock(jouri_edit_unlock):
        raise HTTPException(status_code=403, detail={"code": "ERR_EDIT_LOCK_REQUIRED"})

    existing = list(p.images or [])
    next_idx = file_manager.get_next_image_index(existing)

    image_data = [
        (img.filename or "image.jpg", await img.read(), img.content_type or "image/jpeg")
        for img in images
    ]
    new_images = file_manager.save_images(Path(p.folder_path), image_data, start_index=next_idx)
    p.images = existing + [img.model_dump() for img in new_images]

    activity_logger.log(
        db, "add_images",
        product_id=p.id,
        product_title=p.title_raw,
        details={"count": len(new_images)},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@router.post("/api/products/{product_id}/images/ai-generate", response_model=ProductRecord)
async def generate_ai_product_images(
    product_id: str,
    body: AiImageGenerateRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    jouri_edit_unlock: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    if p.status in _IMAGE_LOCKED_STATUSES and not auth_service.is_valid_edit_unlock(jouri_edit_unlock):
        raise HTTPException(status_code=403, detail={"code": "ERR_EDIT_LOCK_REQUIRED"})

    source_folder = body.sourceFolder if body.sourceFolder in {"originals", "enhanced"} else "originals"
    try:
        source_path = file_manager.resolve_image_path(p.folder_path, source_folder, body.sourceFileName)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})

    generated = await image_ai_service.generate_product_images(source_path, p, body)
    existing = list(p.images or [])
    next_idx = file_manager.get_next_enhanced_image_index(existing)
    image_data = [(item.file_name, item.content, item.mime_type) for item in generated]
    new_images = file_manager.save_enhanced_images(Path(p.folder_path), image_data, start_index=next_idx)
    p.images = existing + [img.model_dump() for img in new_images]

    activity_logger.log(
        db, "ai_generate_images",
        product_id=p.id,
        product_title=p.title_raw,
        details={"source": body.sourceFileName, "count": len(new_images)},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@router.post("/api/products/{product_id}/ai-prompts")
def preview_ai_prompts(
    product_id: str,
    body: AiImageGenerateRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    prompts = image_ai_service.get_prompt_previews(p, body)
    return prompts



@router.get("/api/products/{product_id}/images/{kind}/{file_name}")
def product_image(
    product_id: str,
    kind: str,
    file_name: str,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    try:
        path = file_manager.resolve_image_path(p.folder_path, kind, file_name)
        return FileResponse(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})


@router.delete("/api/products/{product_id}/images/{kind}/{file_name}", response_model=ProductRecord)
def delete_product_image(
    product_id: str,
    kind: str,
    file_name: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    jouri_edit_unlock: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    if p.status in _IMAGE_LOCKED_STATUSES and not auth_service.is_valid_edit_unlock(jouri_edit_unlock):
        raise HTTPException(status_code=403, detail={"code": "ERR_EDIT_LOCK_REQUIRED"})
        
    try:
        path = file_manager.resolve_image_path(p.folder_path, kind, file_name)
        path.unlink()

        # Eğer orijinal siliniyorsa, thumbnail'i de sil
        if kind == "originals":
            try:
                thumb_path = file_manager.resolve_image_path(p.folder_path, "thumbnails", file_name)
                thumb_path.unlink()
            except FileNotFoundError:
                pass

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})
    p.images = [img for img in (p.images or []) if img.get("fileName") != file_name]
    activity_logger.log(db, "update", product_id=p.id, product_title=p.title_raw,
                        details={"changed": {"image_deleted": {"from": file_name, "to": ""}}})
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@router.patch("/api/products/{product_id}/images/originals/{file_name}/mark-ai", response_model=ProductRecord)
def mark_product_image_as_ai(
    product_id: str,
    file_name: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    jouri_edit_unlock: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    if p.status in _IMAGE_LOCKED_STATUSES and not auth_service.is_valid_edit_unlock(jouri_edit_unlock):
        raise HTTPException(status_code=403, detail={"code": "ERR_EDIT_LOCK_REQUIRED"})

    try:
        new_images, target = file_manager.mark_image_as_ai(Path(p.folder_path), file_name, list(p.images or []))
        p.images = new_images
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})

    activity_logger.log(
        db, "mark_ai_image",
        product_id=p.id,
        product_title=p.title_raw,
        details={"source": file_name, "new_name": target.get("fileName")},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record
