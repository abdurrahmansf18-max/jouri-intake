import json
from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

import activity_logger
import auth_service
import file_manager
import product_service
import search_service
import shopify
from database import get_db
from db_models import Product
from dependencies import verify_access
from models import (
    BulkUpdateRequest,
    BulkShopifyPushRequest,
    ProductRecord,
    ProductSearchResult,
    ProductUpdateRequest,
    StatusUpdateRequest,
    UpdateRelatedRequest,
)
from parser import normalize_category, normalize_product_type, normalize_season, parse_description
from realtime import ws_manager
from shopify_stock_sync import queue_shopify_stock_sync


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


@router.get("/api/products/search", response_model=list[ProductSearchResult])
def search_products_endpoint(
    _: Annotated[None, Depends(verify_access)],
    q: Annotated[str, Query(max_length=200)] = "",
    status: Annotated[str, Query()] = "all",
    category: Annotated[str, Query()] = "all",
    product_type: Annotated[str, Query(alias="productType")] = "all",
    season: Annotated[str, Query()] = "all",
    include_archive: Annotated[bool, Query(alias="includeArchive")] = False,
    db: Session = Depends(get_db),
):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    records = [product_service.to_record(p) for p in products]
    filtered: list[ProductRecord] = []
    normalized_category_filter = normalize_category(category)
    normalized_type_filter = normalize_product_type(product_type)
    normalized_season_filter = normalize_season(season)

    for record in records:
        if not include_archive and record.status == "sold_archive":
            continue
        if status != "all" and record.status != status:
            continue

        record_category = normalize_category(record.parsed.categorySuggestion)
        if category == "uncategorized" and record_category:
            continue
        if category not in {"all", "uncategorized"} and record_category != normalized_category_filter:
            continue

        record_type = normalize_product_type(record.parsed.productTypeSuggestion)
        if product_type == "untyped" and record_type:
            continue
        if product_type not in {"all", "untyped"} and record_type != normalized_type_filter:
            continue

        record_season = normalize_season(record.parsed.season)
        if season == "unspecified" and record_season:
            continue
        if season not in {"all", "unspecified"} and record_season != normalized_season_filter:
            continue

        filtered.append(record)

    return search_service.search_products(filtered, q, include_archive_fields=include_archive)


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
    season: Annotated[str | None, Form()] = None,
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
        "categorySuggestion": normalize_category(categorySuggestion or parsed.categorySuggestion),
        "productTypeSuggestion": normalize_product_type(productTypeSuggestion or parsed.productTypeSuggestion),
        "priceAmount": priceAmount.strip() if priceAmount else parsed.priceAmount,
        "currency": currency.strip() if currency else (parsed.currency or "EUR"),
        "colorRaw": colorRaw.strip() if colorRaw else parsed.colorRaw,
        "colorGermanSuggestion": colorGermanSuggestion.strip() if colorGermanSuggestion else parsed.colorGermanSuggestion,
        "season": normalize_season(season or parsed.season),
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
        season=parsed.season,
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
    if new_status == "sold_archive" or old_status == "sold_archive":
        queue_shopify_stock_sync(background_tasks, p.id, "status_change", p.shopify_product_id)
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
    stock_changed = False

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
        stock_changed = True
        p.size_stocks = new_ss
        new_total = sum(ss.qty for ss in body.sizeStocks)
        track("stock", p.stock_quantity, new_total)
        p.stock_quantity = new_total
        p.sizes_raw = ", ".join(ss.size for ss in body.sizeStocks if ss.size)
    elif body.stockQuantity is not None:
        track("stock", p.stock_quantity, max(0, int(body.stockQuantity)))
        stock_changed = True
        p.stock_quantity = max(0, int(body.stockQuantity))
    if body.parsed:
        pd = body.parsed
        if pd.titleRaw is not None:
            track("title", p.title_raw, pd.titleRaw); p.title_raw = pd.titleRaw
        if pd.categorySuggestion is not None:
            category = normalize_category(pd.categorySuggestion)
            track("category", p.category, category); p.category = category
        if pd.productTypeSuggestion is not None:
            product_type = normalize_product_type(pd.productTypeSuggestion)
            track("product_type", p.product_type, product_type); p.product_type = product_type
        if pd.priceAmount is not None:
            track("price", p.price_amount, pd.priceAmount); p.price_amount = pd.priceAmount
        if pd.currency is not None:
            track("currency", p.currency, pd.currency); p.currency = pd.currency
        if pd.colorRaw is not None:
            track("color", p.color_raw, pd.colorRaw); p.color_raw = pd.colorRaw
        if pd.colorGermanSuggestion is not None:
            p.color_german = pd.colorGermanSuggestion
        if pd.season is not None:
            season = normalize_season(pd.season)
            track("season", p.season, season); p.season = season
        if pd.sizesRaw is not None:
            track("sizes", p.sizes_raw, pd.sizesRaw); p.sizes_raw = pd.sizesRaw
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
    if stock_changed:
        queue_shopify_stock_sync(background_tasks, p.id, "stock_update", p.shopify_product_id)
    return record


class RewriteDescriptionResponse(BaseModel):
    description: str


@router.post("/api/products/{product_id}/rewrite-description", response_model=RewriteDescriptionResponse)
async def rewrite_product_description(
    product_id: str,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    from parser import rewrite_description_ai
    p = product_service.get_or_404(db, product_id)
    
    context_parts = []
    if p.sizes_raw: context_parts.append(f"Sizes: {p.sizes_raw}")
    if p.color_german or p.color_raw: context_parts.append(f"Color: {p.color_german or p.color_raw}")
    if p.category: context_parts.append(f"Category: {p.category}")
    if p.product_type: context_parts.append(f"Product Type: {p.product_type}")
    
    context = ", ".join(context_parts)
    
    import file_manager
    import base64
    
    image_base64 = None
    if p.images:
        img = p.images[0]
        try:
            img_path = file_manager.resolve_image_path(p.folder_path, img.get("folder", "originals"), img.get("fileName"))
            if img_path.exists():
                image_base64 = base64.b64encode(img_path.read_bytes()).decode("utf-8")
        except Exception as e:
            print("Failed to load image for AI rewrite:", str(e))
            
    new_desc = await rewrite_description_ai(
        title=p.title_raw or "",
        description=p.description or "",
        context=context,
        image_base64=image_base64
    )
    
    return RewriteDescriptionResponse(description=new_desc)



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


@router.post("/api/products/bulk/shopify-push")
async def bulk_push_to_shopify(
    body: BulkShopifyPushRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    return await _bulk_push_to_shopify_impl(body, background_tasks, db)


@router.post("/api/products/{product_id}/shopify-push", response_model=ProductRecord)
async def push_product_to_shopify(
    product_id: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)] = None,
    db: Session = Depends(get_db)
):
    p = product_service.get_or_404(db, product_id)
    if p.status != "published":
        raise HTTPException(status_code=400, detail={"code": "ERR_SHOPIFY_STATUS_REQUIRED"})

    try:
        res = await shopify.push_to_shopify(p)
        shopify_product = res.get("product") or {}
        p.shopify_product_id = str(shopify_product.get("id") or "")
        p.shopify_product_handle = shopify_product.get("handle") or ""
        p.shopify_synced_at = datetime.now(timezone.utc)
        p.shopify_last_inventory_sync_at = p.shopify_synced_at
        p.shopify_variants = res.get("variantLinks") or []
        p.shopify_last_error = None
        activity_logger.log(
            db,
            "shopify_push",
            product_id=p.id,
            product_title=p.title_raw,
            details={
                "mode": "create" if res.get("created") else "update",
                "shopify_product_id": p.shopify_product_id,
                "handle": p.shopify_product_handle,
                "images": res.get("images"),
                "variants": res.get("variants"),
            },
        )
        db.commit()
        db.refresh(p)
        record = product_service.to_record(p)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
        return record
    except shopify.ShopifyConfigError as e:
        p.shopify_last_error = str(e)
        db.commit()
        record = product_service.to_record(p)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
        raise HTTPException(status_code=500, detail={"code": "ERR_SHOPIFY_CONFIG", "message": str(e)})
    except Exception as e:
        p.shopify_last_error = str(e)
        db.commit()
        record = product_service.to_record(p)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
        raise HTTPException(status_code=500, detail={"code": "ERR_SHOPIFY_FAILED", "message": str(e)})


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


@router.patch("/api/products/bulk/update", response_model=list[ProductRecord])
def bulk_update_products(
    body: BulkUpdateRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    updated_records = []
    for pid in body.productIds:
        p = db.query(Product).filter(Product.id == pid).first()
        if not p:
            continue
        
        if body.season is not None:
            p.season = normalize_season(body.season)
        
        activity_logger.log(
            db, "bulk_update",
            product_id=p.id,
            product_title=p.title_raw,
            details={"season": normalize_season(body.season)} if body.season is not None else {}
        )
        updated_records.append(p)
        
    db.commit()
    
    result = []
    for p in updated_records:
        db.refresh(p)
        record = product_service.to_record(p)
        result.append(record)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
        
    return result


async def _bulk_push_to_shopify_impl(
    body: BulkShopifyPushRequest,
    background_tasks: BackgroundTasks,
    db: Session,
):
    import asyncio
    
    products_by_id = {
        product.id: product
        for product in db.query(Product).filter(Product.id.in_(body.productIds)).all()
    }
    results = []

    for product_id in body.productIds:
        p = products_by_id.get(product_id)
        if not p:
            results.append({"id": product_id, "success": False, "error": "Product not found"})
            continue
        if p.status != "published":
            p.shopify_last_error = "Shopify'a göndermek için ürün published durumunda olmalı."
            db.commit()
            record = product_service.to_record(p)
            background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
            results.append({"id": p.id, "success": False, "error": p.shopify_last_error})
            continue

        try:
            res = await shopify.push_to_shopify(p)
            shopify_product = res.get("product") or {}
            p.shopify_product_id = str(shopify_product.get("id") or "")
            p.shopify_product_handle = str(shopify_product.get("handle") or "")
            p.shopify_synced_at = datetime.now(timezone.utc)
            p.shopify_last_inventory_sync_at = p.shopify_synced_at
            p.shopify_variants = res.get("variantLinks") or []
            p.shopify_last_error = None

            activity_logger.log(
                db,
                "shopify_push",
                product_id=p.id,
                product_title=p.title_raw,
                details={
                    "mode": "create" if res.get("created") else "update",
                    "shopify_product_id": p.shopify_product_id,
                    "handle": p.shopify_product_handle,
                    "images": res.get("images"),
                    "variants": res.get("variants"),
                },
            )
            db.commit()
            db.refresh(p)
            record = product_service.to_record(p)
            background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
            results.append({"id": p.id, "success": True, "created": bool(res.get("created")), "variants": res.get("variants")})
        except Exception as e:
            db.rollback()
            p.shopify_last_error = str(e)
            db.commit()
            record = product_service.to_record(p)
            background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
            results.append({"id": p.id, "success": False, "error": str(e)})

        # Rate limiting pause
        await asyncio.sleep(1)

    return {"success": all(result.get("success") for result in results), "results": results}
