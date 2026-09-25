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
from size_utils import normalize_size_label, normalize_size_stock_list, size_key
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
    size_stocks = _normalize_product_size_state(p)
    requested_quantities: list[dict[str, int | str]] = []
    for item in body.sizeQuantities or []:
        size = str(item.get("size") or "").strip()
        if not size:
            continue
        try:
            item_quantity = max(1, int(item.get("quantity") or 1))
        except (TypeError, ValueError):
            item_quantity = 1
        requested_quantities.append({"size": size, "quantity": item_quantity})

    requested_sizes = [str(size).strip() for size in (body.sizes or []) if str(size).strip()]
    if not requested_sizes and body.size:
        requested_sizes = [body.size.strip()]
    if not requested_quantities:
        requested_quantities = [{"size": size, "quantity": quantity} for size in requested_sizes]
    selected_size = ""
    sold_details: list[dict] = []
    now = datetime.now(timezone.utc)

    if size_stocks:
        # Beden bazlı stok takibi
        if not requested_quantities:
            raise HTTPException(status_code=400, detail={"code": "ERR_SIZE_REQUIRED"})
        requested_keys = []
        quantity_by_key: dict[str, int] = {}
        for item in requested_quantities:
            key = size_key(str(item["size"]))
            if key and key not in requested_keys:
                requested_keys.append(key)
            if key:
                quantity_by_key[key] = int(item["quantity"])

        stock_by_key = {size_key(str(ss.get("size") or "")): ss for ss in size_stocks}
        for requested_key in requested_keys:
            size_entry = stock_by_key.get(requested_key)
            if not size_entry:
                raise HTTPException(status_code=400, detail={"code": "ERR_SIZE_NOT_FOUND"})
            if int(size_entry["qty"]) <= 0:
                raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})

        sold_by_key: dict[str, int] = {}
        selected_sizes: list[str] = []
        for requested_key in requested_keys:
            size_entry = stock_by_key[requested_key]
            size_name = str(size_entry.get("size") or "").strip()
            requested_amount = quantity_by_key.get(requested_key, quantity)
            if requested_amount > int(size_entry["qty"]):
                raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})
            amount = requested_amount
            sold_by_key[requested_key] = amount
            selected_sizes.append(size_name)
            sold_details.append({"size": size_name, "quantity": amount})

        selected_size = ", ".join(selected_sizes)
        sold_amount = sum(sold_by_key.values())
        new_size_stocks = []
        for ss in size_stocks:
            key = size_key(str(ss.get("size") or ""))
            new_size_stocks.append({
                "size": ss["size"],
                "qty": ss["qty"] - sold_by_key.get(key, 0),
            })
        p.size_stocks = new_size_stocks
        next_stock = sum(ss["qty"] for ss in new_size_stocks)

        # Beden tamamen bitti → sold_sizes'a ekle / güncelle
        sold_sizes_list = list(p.sold_sizes or [])
        for detail in sold_details:
            requested_key = size_key(str(detail.get("size") or ""))
            sold_qty_after = next((ss["qty"] for ss in new_size_stocks if size_key(str(ss.get("size") or "")) == requested_key), 0)
            if sold_qty_after != 0:
                continue
            sold_sizes_list = [s for s in sold_sizes_list if size_key(str(s.get("size") or "")) != requested_key]
            sold_sizes_list.append({
                "size": detail["size"],
                "soldAt": now.isoformat(),
                "note": (body.note or "").strip(),
                "source": body.source or "manual",
            })
        p.sold_sizes = sold_sizes_list
    else:
        # Eski sistem (beden yoksa toplam stok)
        current_stock = max(0, p.stock_quantity)
        if current_stock <= 0:
            raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})
        sold_amount = min(quantity, current_stock)
        next_stock = current_stock - sold_amount
        sold_details.append({"size": body.size or "", "quantity": sold_amount})

    new_history = list(p.sale_history or []) + [
        {
            "soldAt": now.isoformat(),
            "quantity": int(detail["quantity"]),
            "size": detail["size"],
            "note": (body.note or "").strip(),
            "source": body.source or "manual",
        }
        for detail in sold_details
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
        details={"quantity": sold_amount, "size": selected_size if size_stocks else (body.size or ""), "note": body.note or ""},
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
            current_stocks = _normalize_product_size_state(p)
            sizes = [str(ss.get("size") or "") for ss in current_stocks if ss.get("size")]
            total = p.stock_quantity
            per_size = total // len(sizes) if sizes else 0
            remainder = total % len(sizes) if sizes else 0
            p.size_stocks = [
                {"size": s, "qty": per_size + (1 if i < remainder else 0)}
                for i, s in enumerate(sizes)
            ]
            p.size_stocks = normalize_size_stock_list(p.size_stocks, _size_context_for_product(p))
            p.sizes_raw = ", ".join(str(ss.get("size") or "") for ss in p.size_stocks if ss.get("size"))

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
        current_stocks = _normalize_product_size_state(p)
        sizes = [str(ss.get("size") or "") for ss in current_stocks if ss.get("size")]
        total = p.stock_quantity
        per_size = total // len(sizes)
        remainder = total % len(sizes)
        p.size_stocks = [
            {"size": s, "qty": per_size + (1 if i < remainder else 0)}
            for i, s in enumerate(sizes)
        ]
        p.size_stocks = normalize_size_stock_list(p.size_stocks, _size_context_for_product(p))
        p.sizes_raw = ", ".join(str(ss.get("size") or "") for ss in p.size_stocks if ss.get("size"))

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
    size_name = normalize_size_label(body.size.strip(), f"{p.category} {p.title_raw} {p.sizes_raw}") or body.size.strip()
    requested_key = size_key(size_name)

    sold = list(p.sold_sizes or [])
    matched_sold = next((s for s in sold if size_key(str(s.get("size") or "")) == requested_key), None)
    if not matched_sold:
        raise HTTPException(status_code=404, detail={"code": "ERR_SIZE_NOT_FOUND"})
    size_name = str(matched_sold.get("size") or size_name)

    # sold_sizes'tan kaldır — yeni dict objeleri oluştur (SQLAlchemy JSON mutation tuzağından kaçın)
    p.sold_sizes = [
        {
            "size": s["size"],
            "soldAt": s["soldAt"],
            "note": s.get("note", ""),
            "source": s.get("source", "manual"),
            **({"orderName": s.get("orderName")} if s.get("orderName") else {}),
        }
        for s in sold
        if size_key(str(s.get("size") or "")) != requested_key
    ]

    # sizeStocks'a 1 adet olarak geri ekle — sell endpoint gibi yeni dict objeleri yarat
    current_stocks = _normalize_product_size_state(p)
    size_exists = any(size_key(str(s.get("size") or "")) == requested_key for s in current_stocks)
    stocks = [
        {"size": s["size"], "qty": s["qty"] + 1}
        if size_key(str(s.get("size") or "")) == requested_key
        else {"size": s["size"], "qty": s["qty"]}
        for s in current_stocks
    ]
    if not size_exists:
        stocks.append({"size": size_name, "qty": 1})
    p.size_stocks = normalize_size_stock_list(stocks, _size_context_for_product(p, size_name))
    p.stock_quantity = sum(int(s.get("qty") or 0) for s in p.size_stocks)
    p.sizes_raw = ", ".join(str(s.get("size") or "") for s in p.size_stocks if s.get("size"))

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


def _normalize_product_size_state(product) -> list[dict[str, int | str]]:
    """Keep saved size labels canonical before stock math touches Shopify variants."""
    normalized = normalize_size_stock_list(product.size_stocks or [], _size_context_for_product(product))
    current = list(product.size_stocks or [])
    if normalized != current:
        product.size_stocks = normalized
        product.sizes_raw = ", ".join(str(ss.get("size") or "") for ss in normalized if ss.get("size"))
        product.stock_quantity = sum(int(ss.get("qty") or 0) for ss in normalized)
    return normalized


def _size_context_for_product(product, extra: str = "") -> str:
    return " ".join([
        product.category or "",
        product.product_type or "",
        product.title_raw or "",
        product.sizes_raw or "",
        product.description or "",
        " ".join(product.tags or []),
        extra or "",
    ])
