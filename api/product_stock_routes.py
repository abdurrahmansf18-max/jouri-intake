from datetime import datetime, timezone
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

import activity_logger
import file_manager
import product_service
from database import get_db
from dependencies import verify_access
from models import (
    ProductRecord,
    ResetSalesRequest,
    RestoreProductRequest,
    RestoreSizeRequest,
    SellProductRequest,
)
from realtime import ws_manager
from shopify_stock_sync import queue_shopify_stock_sync


router = APIRouter()


@router.post("/api/products/{product_id}/sell", response_model=ProductRecord)
def sell_product(
    product_id: str,
    body: SellProductRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    quantity = max(1, int(body.quantity))
    size_stocks = list(p.size_stocks or [])
    now = datetime.now(timezone.utc)

    if size_stocks:
        # Beden bazlı stok takibi
        if not body.size:
            raise HTTPException(status_code=400, detail={"code": "ERR_SIZE_REQUIRED"})
        size_entry = next((ss for ss in size_stocks if ss["size"] == body.size), None)
        if not size_entry:
            raise HTTPException(status_code=400, detail={"code": "ERR_SIZE_NOT_FOUND"})
        if size_entry["qty"] <= 0:
            raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})
        sold_amount = min(quantity, size_entry["qty"])
        new_size_stocks = [
            {"size": ss["size"], "qty": ss["qty"] - sold_amount if ss["size"] == body.size else ss["qty"]}
            for ss in size_stocks
        ]
        p.size_stocks = new_size_stocks
        next_stock = sum(ss["qty"] for ss in new_size_stocks)

        # Beden tamamen bitti → sold_sizes'a ekle / güncelle
        sold_qty_after = next((ss["qty"] for ss in new_size_stocks if ss["size"] == body.size), 0)
        if sold_qty_after == 0:
            sold_sizes_list = [s for s in (p.sold_sizes or []) if s["size"] != body.size]
            sold_sizes_list.append({
                "size": body.size,
                "soldAt": now.isoformat(),
                "note": (body.note or "").strip(),
                "source": "manual",
            })
            p.sold_sizes = sold_sizes_list
    else:
        # Eski sistem (beden yoksa toplam stok)
        current_stock = max(0, p.stock_quantity)
        if current_stock <= 0:
            raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})
        sold_amount = min(quantity, current_stock)
        next_stock = current_stock - sold_amount

    new_history = list(p.sale_history or []) + [
        {
            "soldAt": now.isoformat(),
            "quantity": sold_amount,
            "size": body.size or "",
            "note": (body.note or "").strip(),
            "source": "manual",
        }
    ]
    p.sale_history = new_history[-200:]  # son 200 satış kaydını tut
    p.sold_quantity = (p.sold_quantity or 0) + sold_amount
    p.last_sold_at = now
    p.stock_quantity = next_stock

    if next_stock == 0 and p.status != "sold_archive":
        new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "sold_archive")
        p.folder_path = new_path
        p.status = "sold_archive"
        p.images = file_manager.rebase_image_relative_paths(p.images, p.folder_name, "sold_archive")

    activity_logger.log(
        db, "sell",
        product_id=p.id,
        product_title=p.title_raw,
        details={"quantity": sold_amount, "size": body.size or "", "note": body.note or ""},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    queue_shopify_stock_sync(background_tasks, p.id, "sell", p.shopify_product_id)
    return record


@router.post("/api/products/{product_id}/sales/reset", response_model=ProductRecord)
def reset_sales(
    product_id: str,
    body: ResetSalesRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    p.sold_quantity = 0
    p.last_sold_at = None
    p.sale_history = []
    p.sold_sizes = []
    if body.stockQuantity is not None:
        p.stock_quantity = max(0, int(body.stockQuantity))
        if p.size_stocks:
            sizes = [ss["size"] for ss in p.size_stocks]
            total = p.stock_quantity
            per_size = total // len(sizes) if sizes else 0
            remainder = total % len(sizes) if sizes else 0
            p.size_stocks = [
                {"size": s, "qty": per_size + (1 if i < remainder else 0)}
                for i, s in enumerate(sizes)
            ]

    activity_logger.log(db, "reset_sales", product_id=p.id, product_title=p.title_raw)
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    if body.stockQuantity is not None:
        queue_shopify_stock_sync(background_tasks, p.id, "reset_sales", p.shopify_product_id)
    return record


@router.post("/api/products/{product_id}/restore", response_model=ProductRecord)
def restore_product(
    product_id: str,
    body: RestoreProductRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = product_service.get_or_404(db, product_id)
    new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "pending")
    p.folder_path = new_path
    p.status = "pending"
    p.images = file_manager.rebase_image_relative_paths(p.images, p.folder_name, "pending")
    p.stock_quantity = max(1, int(body.stockQuantity))
    p.sold_sizes = []

    # Stoku mevcut bedenler arasında eşit dağıt
    if p.size_stocks:
        sizes = [ss["size"] for ss in p.size_stocks]
        total = p.stock_quantity
        per_size = total // len(sizes)
        remainder = total % len(sizes)
        p.size_stocks = [
            {"size": s, "qty": per_size + (1 if i < remainder else 0)}
            for i, s in enumerate(sizes)
        ]

    activity_logger.log(
        db, "restore",
        product_id=p.id,
        product_title=p.title_raw,
        details={"stock": p.stock_quantity},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    queue_shopify_stock_sync(background_tasks, p.id, "restore_product", p.shopify_product_id)
    return record


@router.post("/api/products/{product_id}/restore-size", response_model=ProductRecord)
def restore_product_size(
    product_id: str,
    body: RestoreSizeRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    """Satılan belirli bir bedeni geri alır (iade)."""
    p = product_service.get_or_404(db, product_id)
    size_name = body.size.strip()

    sold = list(p.sold_sizes or [])
    if not any(s["size"] == size_name for s in sold):
        raise HTTPException(status_code=404, detail={"code": "ERR_SIZE_NOT_FOUND"})

    # sold_sizes'tan kaldır — yeni dict objeleri oluştur (SQLAlchemy JSON mutation tuzağından kaçın)
    p.sold_sizes = [{"size": s["size"], "soldAt": s["soldAt"], "note": s.get("note", "")} for s in sold if s["size"] != size_name]

    # sizeStocks'a 1 adet olarak geri ekle — sell endpoint gibi yeni dict objeleri yarat
    current_stocks = list(p.size_stocks or [])
    size_exists = any(s["size"] == size_name for s in current_stocks)
    stocks = [
        {"size": s["size"], "qty": s["qty"] + 1} if s["size"] == size_name else {"size": s["size"], "qty": s["qty"]}
        for s in current_stocks
    ]
    if not size_exists:
        stocks.append({"size": size_name, "qty": 1})
    p.size_stocks = stocks
    p.stock_quantity = sum(s["qty"] for s in stocks)
    p.sizes_raw = ", ".join(s["size"] for s in stocks if s.get("size"))

    # sold_archive ise → stok gelince pending'e döndür
    if p.status == "sold_archive" and p.stock_quantity > 0:
        new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "pending")
        p.folder_path = new_path
        p.status = "pending"
        p.images = file_manager.rebase_image_relative_paths(p.images, p.folder_name, "pending")

    activity_logger.log(
        db, "restore",
        product_id=p.id,
        product_title=p.title_raw,
        details={"size": size_name},
    )
    db.commit()
    db.refresh(p)
    record = product_service.to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    queue_shopify_stock_sync(background_tasks, p.id, "restore_size", p.shopify_product_id)
    return record
