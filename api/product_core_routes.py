import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

import activity_logger
import auth_service
import file_manager
import product_service
import shopify
from database import get_db
from db_models import Product
from dependencies import verify_access
from models import (
    ProductRecord,
    ProductUpdateRequest,
    StatusUpdateRequest,
    UpdateRelatedRequest,
)
from parser import parse_description
from realtime import ws_manager


router = APIRouter()

_ACTIVE_STATUS_RANK = {
    "pending": 0,
    "ai_enhanced": 1,
    "published": 2,
}


@router.get("/api/products", response_model=list[ProductRecord])
def get_products(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    return [product_service.to_record(p) for p in products]


@router.post("/api/products", response_model=ProductRecord)
async def create_product(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    description: Annotated[str, Form()] = "",
    images: Annotated[list[UploadFile], File()] = [],
    titleRaw: Annotated[str | None, Form()] = None,
    categorySuggestion: Annotated[str | None, Form()] = None,
    productTypeSuggestion: Annotated[str | None, Form()] = None,
    priceAmount: Annotated[str | None, Form()] = None,
    currency: Annotated[str | None, Form()] = None,
    colorRaw: Annotated[str | None, Form()] = None,
    colorGermanSuggestion: Annotated[str | None, Form()] = None,
    sizeStocksJson: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
    source: Annotated[str | None, Form()] = None,
):
    # Required field validation
    if not titleRaw or not titleRaw.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_TITLE_REQUIRED"})
    if not priceAmount or not priceAmount.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_PRICE_REQUIRED"})
    if not colorRaw or not colorRaw.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_COLOR_REQUIRED"})

    # sizeStocks validasyonu
    size_stocks_data: list[dict] = []
    if sizeStocksJson:
        try:
            size_stocks_data = json.loads(sizeStocksJson)
        except Exception:
            raise HTTPException(status_code=422, detail={"code": "ERR_SIZE_REQUIRED"})
    if not size_stocks_data or not any(int(ss.get("qty", 0)) >= 1 for ss in size_stocks_data):
        raise HTTPException(status_code=422, detail={"code": "ERR_SIZE_REQUIRED"})

    if not images:
        raise HTTPException(status_code=422, detail={"code": "ERR_IMAGE_REQUIRED"})
    if not description.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_DESCRIPTION_REQUIRED"})

    total_stock = sum(max(0, int(ss.get("qty", 0))) for ss in size_stocks_data)
    sizes_raw_derived = ", ".join(ss.get("size", "") for ss in size_stocks_data if ss.get("size"))

    parsed = parse_description(description)
    overrides = {
        "titleRaw": titleRaw.strip() if titleRaw else parsed.titleRaw,
        "categorySuggestion": categorySuggestion.strip() if categorySuggestion else parsed.categorySuggestion,
        "productTypeSuggestion": productTypeSuggestion.strip() if productTypeSuggestion else parsed.productTypeSuggestion,
        "priceAmount": priceAmount.strip() if priceAmount else parsed.priceAmount,
        "currency": currency.strip() if currency else (parsed.currency or "EUR"),
        "colorRaw": colorRaw.strip() if colorRaw else parsed.colorRaw,
        "colorGermanSuggestion": colorGermanSuggestion.strip() if colorGermanSuggestion else parsed.colorGermanSuggestion,
        "sizesRaw": sizes_raw_derived or parsed.sizesRaw,
    }
    parsed = parsed.model_copy(update=overrides)

    folder_name, folder_path = file_manager.create_product_folder(parsed.titleRaw, description)
    image_data = [
        (img.filename or "image.jpg", await img.read(), img.content_type or "image/jpeg")
        for img in images
    ]
    saved_images = file_manager.save_images(folder_path, image_data, start_index=1)

    now = datetime.now(timezone.utc)
    product = Product(
        id=folder_name,
        created_at=now,
        folder_name=folder_name,
        folder_path=str(folder_path),
        description=description,
        status="pending",
        notes=notes or "",
        stock_quantity=total_stock,
        sold_quantity=0,
        title_raw=parsed.titleRaw,
        category=parsed.categorySuggestion,
        product_type=parsed.productTypeSuggestion,
        price_amount=parsed.priceAmount,
        currency=parsed.currency or "EUR",
        color_raw=parsed.colorRaw,
        color_german=parsed.colorGermanSuggestion,
        sizes_raw=parsed.sizesRaw,
        tags=parsed.tags,
        images=[img.model_dump() for img in saved_images],
        sale_history=[],
        size_stocks=size_stocks_data,
    )
    db.add(product)
    activity_logger.log(
        db, "create",
        product_id=folder_name,
        product_title=parsed.titleRaw,
        details={"source": source} if source else None,
    )
    db.commit()
    db.refresh(product)
    return product_service.to_record(product)


@router.patch("/api/products/{product_id}/status", response_model=ProductRecord)
def update_status(
    product_id: str,
    body: StatusUpdateRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    jouri_edit_unlock: Annotated[str | None, Cookie()] = None,
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    old_status = p.status
    new_status = body.status.value

    if _status_change_requires_unlock(old_status, new_status) and not auth_service.is_valid_edit_unlock(jouri_edit_unlock):
        raise HTTPException(status_code=403, detail={"code": "ERR_EDIT_LOCK_REQUIRED"})

    if old_status != new_status:
        new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, new_status)
        p.folder_path = new_path
        p.images = file_manager.rebase_image_relative_paths(p.images, p.folder_name, new_status)

    p.status = new_status
    if new_status == "sold_archive":
        p.stock_quantity = 0
        if p.size_stocks:
            p.size_stocks = [{"size": ss["size"], "qty": 0} for ss in p.size_stocks]
    else:
        p.stock_quantity = max(1, p.stock_quantity)

    activity_logger.log(
        db, "status_change",
        product_id=p.id,
        product_title=p.title_raw,
        details={"from": old_status, "to": new_status},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


def _status_change_requires_unlock(old_status: str, new_status: str) -> bool:
    if old_status == new_status:
        return False
    if new_status == "sold_archive":
        return True
    if old_status == "sold_archive":
        return True
    if old_status in _ACTIVE_STATUS_RANK and new_status in _ACTIVE_STATUS_RANK:
        return _ACTIVE_STATUS_RANK[new_status] < _ACTIVE_STATUS_RANK[old_status]
    return False


@router.patch("/api/products/{product_id}", response_model=ProductRecord)
def update_product(
    product_id: str,
    body: ProductUpdateRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)

    # Değişiklikleri takip et
    changes: dict[str, dict] = {}

    def track(field: str, old_val, new_val):
        if new_val is not None and str(old_val) != str(new_val):
            changes[field] = {"from": str(old_val), "to": str(new_val)}

    if body.description is not None:
        track("description", p.description, body.description)
        p.description = body.description
    if body.notes is not None:
        track("notes", p.notes, body.notes)
        p.notes = body.notes
    if body.sizeStocks is not None:
        new_ss = [ss.model_dump() for ss in body.sizeStocks]
        p.size_stocks = new_ss
        new_total = sum(ss.qty for ss in body.sizeStocks)
        track("stock", p.stock_quantity, new_total)
        p.stock_quantity = new_total
        p.sizes_raw = ", ".join(ss.size for ss in body.sizeStocks if ss.size)
    elif body.stockQuantity is not None:
        track("stock", p.stock_quantity, max(0, int(body.stockQuantity)))
        p.stock_quantity = max(0, int(body.stockQuantity))
    if body.parsed:
        pd = body.parsed
        if pd.titleRaw is not None:
            track("title", p.title_raw, pd.titleRaw); p.title_raw = pd.titleRaw
        if pd.categorySuggestion is not None:
            track("category", p.category, pd.categorySuggestion); p.category = pd.categorySuggestion
        if pd.productTypeSuggestion is not None:
            track("product_type", p.product_type, pd.productTypeSuggestion); p.product_type = pd.productTypeSuggestion
        if pd.priceAmount is not None:
            track("price", p.price_amount, pd.priceAmount); p.price_amount = pd.priceAmount
        if pd.currency is not None:
            track("currency", p.currency, pd.currency); p.currency = pd.currency
        if pd.colorRaw is not None:
            track("color", p.color_raw, pd.colorRaw); p.color_raw = pd.colorRaw
        if pd.colorGermanSuggestion is not None:
            p.color_german = pd.colorGermanSuggestion
        if pd.sizesRaw is not None:
            track("size", p.sizes_raw, pd.sizesRaw); p.sizes_raw = pd.sizesRaw
        if pd.tags is not None:
            p.tags = pd.tags

    activity_logger.log(
        db, "update",
        product_id=p.id,
        product_title=p.title_raw,
        details={"changed": changes} if changes else None,
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@router.patch("/api/products/{product_id}/related", response_model=ProductRecord)
def update_related_products(
    product_id: str,
    body: UpdateRelatedRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    """Renk varyantlarını çift yönlü günceller."""
    p = product_service.get_or_404(db, product_id)

    new_ids = [rid for rid in body.relatedIds if rid != product_id]  # kendini ekleme

    # Var olmayan ID'leri reddet
    for rid in new_ids:
        if not db.query(Product).filter(Product.id == rid).first():
            raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})

    old_ids = set(p.related_products or [])
    next_ids = set(new_ids)

    added = next_ids - old_ids
    removed = old_ids - next_ids

    affected: list[Product] = []

    for rid in added:
        rel = db.query(Product).filter(Product.id == rid).first()
        if rel:
            rp = list(rel.related_products or [])
            if product_id not in rp:
                rel.related_products = rp + [product_id]
                affected.append(rel)

    for rid in removed:
        rel = db.query(Product).filter(Product.id == rid).first()
        if rel:
            rp = list(rel.related_products or [])
            if product_id in rp:
                rel.related_products = [x for x in rp if x != product_id]
                affected.append(rel)

    p.related_products = list(next_ids)

    db.commit()
    db.refresh(p)
    for aff in affected:
        db.refresh(aff)

    record = product_service.to_record(p)
    for aff in affected:
        aff_rec = product_service.to_record(aff)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": aff_rec.model_dump(mode="json")})
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})

    return record


@router.post("/api/products/{product_id}/shopify-push", response_model=ProductRecord)
async def push_product_to_shopify(
    product_id: str,
    _: Annotated[None, Depends(verify_access)] = None,
    db: Session = Depends(get_db)
):
    p = product_service.get_or_404(db, product_id)
    record = product_service.to_record(p)

    try:
        res = await shopify.push_to_shopify(record.model_dump(), record.images)
        p.notes = (p.notes or "") + f"\n[Shopify] Product ID: {res.get('product', {}).get('id')}"
        db.commit()
        db.refresh(p)
        record = product_service.to_record(p)
        await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
        return record
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "ERR_GENERAL", "message": str(e)})


@router.delete("/api/products/{product_id}")
def delete_product(
    product_id: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    title = p.title_raw or product_id
    folder_path = p.folder_path

    # Silinecek ürünün ID'sini diğer ürünlerin related_products listesinden temizle
    if p.related_products:
        linked = db.query(Product).filter(Product.id.in_(p.related_products)).all()
        for lp in linked:
            rp = list(lp.related_products or [])
            if product_id in rp:
                lp.related_products = [x for x in rp if x != product_id]

    activity_logger.log(db, "delete", product_id=p.id, product_title=title)
    db.delete(p)
    db.flush()

    try:
        file_manager.delete_product_folder(folder_path)
    except Exception:
        pass

    db.commit()
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_deleted", "id": product_id})
    return {"ok": True}
