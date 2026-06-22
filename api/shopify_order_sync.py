import re
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

import activity_logger
import file_manager
import product_service
from db_models import Product
from realtime import ws_manager


def process_shopify_order(db: Session, order: dict[str, Any], topic: str = "") -> dict[str, Any]:
    order_id = str(order.get("id") or "").strip()
    order_name = str(order.get("name") or order.get("order_number") or order_id).strip()
    if not order_id:
        return {"processed": 0, "skipped": 0, "errors": [{"message": "missing_order_id"}]}

    processed = skipped = 0
    errors: list[dict[str, Any]] = []
    updated_products: list[Product] = []

    for line_item in order.get("line_items") or []:
        result = _process_line_item(db, order_id, order_name, line_item, topic)
        if result["status"] == "synced":
            processed += 1
        elif result["status"] == "skipped":
            skipped += 1
        else:
            errors.append(result)

        product = result.get("product")
        if product and product not in updated_products:
            updated_products.append(product)

    db.commit()
    for product in updated_products:
        db.refresh(product)

    return {
        "processed": processed,
        "skipped": skipped,
        "errors": errors,
        "updatedProductIds": [p.id for p in updated_products],
    }


async def broadcast_products(products: list[Product]) -> None:
    for product in products:
        record = product_service.to_record(product)
        await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})


def products_from_ids(db: Session, product_ids: list[str]) -> list[Product]:
    if not product_ids:
        return []
    return db.query(Product).filter(Product.id.in_(product_ids)).all()


def _process_line_item(
    db: Session,
    order_id: str,
    order_name: str,
    line_item: dict[str, Any],
    topic: str,
) -> dict[str, Any]:
    line_item_id = str(line_item.get("id") or "").strip()
    processed_key = f"{order_id}:{line_item_id or 'line'}"
    quantity = max(1, _int(line_item.get("quantity"), 1))
    variant_id = str(line_item.get("variant_id") or "").strip()
    shopify_product_id = str(line_item.get("product_id") or "").strip()

    product = _find_product(db, shopify_product_id, variant_id, str(line_item.get("sku") or ""))
    if not product:
        return {
            "status": "error",
            "processedKey": processed_key,
            "orderId": order_id,
            "orderName": order_name,
            "lineItemId": line_item_id,
            "variantId": variant_id or None,
            "quantity": quantity,
            "message": "product_not_found",
        }

    if _already_processed(product, processed_key):
        return {"status": "skipped", "product": product, "processedKey": processed_key}

    now = datetime.now(timezone.utc)
    size = _resolve_size(product, variant_id, line_item)
    status = "synced"
    message = ""
    sold_amount = 0

    size_stocks = list(product.size_stocks or [])
    if size_stocks:
        if not size:
            status = "error"
            message = "size_not_found"
        else:
            size_key = _size_key(size)
            matched = next((ss for ss in size_stocks if _size_key(str(ss.get("size") or "")) == size_key), None)
            if not matched:
                status = "error"
                message = f"size_not_in_local_stock:{size}"
            elif _int(matched.get("qty"), 0) <= 0:
                status = "error"
                message = f"local_size_out_of_stock:{size}"
            else:
                sold_amount = min(quantity, _int(matched.get("qty"), 0))
                product.size_stocks = [
                    {
                        "size": ss.get("size"),
                        "qty": max(0, _int(ss.get("qty"), 0) - sold_amount) if _size_key(str(ss.get("size") or "")) == size_key else _int(ss.get("qty"), 0),
                    }
                    for ss in size_stocks
                ]
                if sold_amount < quantity:
                    status = "partial"
                    message = f"local_stock_lower_than_shopify_order:{sold_amount}/{quantity}"
    else:
        current_stock = max(0, _int(product.stock_quantity, 0))
        if current_stock <= 0:
            status = "error"
            message = "local_product_out_of_stock"
        else:
            sold_amount = min(quantity, current_stock)
            product.stock_quantity = current_stock - sold_amount
            if sold_amount < quantity:
                status = "partial"
                message = f"local_stock_lower_than_shopify_order:{sold_amount}/{quantity}"

    if sold_amount > 0:
        _record_sale(product, now, sold_amount, size, order_id, order_name, line_item_id, variant_id, topic)

    if product.size_stocks:
        product.stock_quantity = sum(max(0, _int(ss.get("qty"), 0)) for ss in product.size_stocks or [])

    _append_order_history(
        product,
        processed_key=processed_key,
        order_id=order_id,
        order_name=order_name,
        line_item_id=line_item_id,
        variant_id=variant_id,
        size=size,
        quantity=quantity,
        status=status,
        message=message,
        synced_at=now,
    )
    product.shopify_last_order_sync_at = now
    if status in {"synced", "skipped"}:
        product.shopify_last_error = None
    else:
        product.shopify_last_error = f"Shopify order sync warning for {order_name}: {message}"

    if product.stock_quantity <= 0 and product.status != "sold_archive":
        new_path = file_manager.move_product_folder(product.folder_path, product.folder_name, "sold_archive")
        product.folder_path = new_path
        product.status = "sold_archive"
        product.images = file_manager.rebase_image_relative_paths(product.images, product.folder_name, "sold_archive")

    activity_logger.log(
        db,
        "shopify_order_sync" if status in {"synced", "partial"} else "shopify_order_sync_failed",
        product_id=product.id,
        product_title=product.title_raw,
        details={
            "order": order_name,
            "lineItemId": line_item_id,
            "variantId": variant_id,
            "size": size,
            "quantity": quantity,
            "sold": sold_amount,
            "status": status,
            "message": message,
        },
    )
    return {"status": status, "product": product, "processedKey": processed_key, "message": message}


def _record_sale(
    product: Product,
    sold_at: datetime,
    quantity: int,
    size: str,
    order_id: str,
    order_name: str,
    line_item_id: str,
    variant_id: str,
    topic: str,
) -> None:
    sale = {
        "soldAt": sold_at.isoformat(),
        "quantity": quantity,
        "size": size or "",
        "note": f"Shopify {order_name}",
        "source": "shopify",
        "orderId": order_id,
        "orderName": order_name,
        "lineItemId": line_item_id,
        "variantId": variant_id,
        "topic": topic,
    }
    product.sale_history = (list(product.sale_history or []) + [sale])[-200:]
    product.sold_quantity = max(0, product.sold_quantity or 0) + quantity
    product.last_sold_at = sold_at

    if size and product.size_stocks:
        matched = next((ss for ss in product.size_stocks if _size_key(str(ss.get("size") or "")) == _size_key(size)), None)
        if matched and _int(matched.get("qty"), 0) == 0:
            sold_sizes = [s for s in (product.sold_sizes or []) if _size_key(str(s.get("size") or "")) != _size_key(size)]
            sold_sizes.append({
                "size": matched.get("size") or size,
                "soldAt": sold_at.isoformat(),
                "note": f"Shopify {order_name}",
                "source": "shopify",
                "orderName": order_name,
            })
            product.sold_sizes = sold_sizes


def _append_order_history(product: Product, **entry: Any) -> None:
    normalized = {
        "processedKey": entry["processed_key"],
        "orderId": entry["order_id"],
        "orderName": entry["order_name"],
        "lineItemId": entry["line_item_id"],
        "variantId": entry.get("variant_id") or None,
        "size": entry.get("size") or None,
        "quantity": entry["quantity"],
        "status": entry["status"],
        "message": entry.get("message") or "",
        "syncedAt": entry["synced_at"].isoformat(),
    }
    existing = [item for item in (product.shopify_order_history or []) if item.get("processedKey") != normalized["processedKey"]]
    product.shopify_order_history = (existing + [normalized])[-200:]


def _already_processed(product: Product, processed_key: str) -> bool:
    return any(item.get("processedKey") == processed_key for item in (product.shopify_order_history or []))


def _find_product(db: Session, shopify_product_id: str, variant_id: str, sku: str) -> Product | None:
    if shopify_product_id:
        product = db.query(Product).filter(Product.shopify_product_id == shopify_product_id).first()
        if product:
            return product

    products = db.query(Product).filter(Product.shopify_product_id.isnot(None)).all()
    if variant_id:
        for product in products:
            for link in product.shopify_variants or []:
                if str(link.get("variantId") or "") == variant_id:
                    return product

    sku_key = _sku_product_key(sku)
    if sku_key:
        for product in products:
            if _id_key(product.id).endswith(sku_key) or sku_key in _id_key(product.id):
                return product

    return None


def _resolve_size(product: Product, variant_id: str, line_item: dict[str, Any]) -> str:
    if variant_id:
        for link in product.shopify_variants or []:
            if str(link.get("variantId") or "") == variant_id:
                return str(link.get("size") or "").strip()

    variant_title = str(line_item.get("variant_title") or "").strip()
    if variant_title and variant_title.lower() != "default title":
        return variant_title

    size_stocks = list(product.size_stocks or [])
    if len(size_stocks) == 1:
        return str(size_stocks[0].get("size") or "").strip()

    sku_size = _sku_size(str(line_item.get("sku") or ""))
    if sku_size:
        for ss in size_stocks:
            if _size_key(str(ss.get("size") or "")) == _size_key(sku_size):
                return str(ss.get("size") or "")
    return ""


def _sku_product_key(sku: str) -> str:
    parts = [part for part in re.split(r"-+", sku or "") if part]
    if len(parts) < 3 or parts[0].upper() != "BINBONKIDS":
        return ""
    return _id_key("-".join(parts[1:-1]))


def _sku_size(sku: str) -> str:
    parts = [part for part in re.split(r"-+", sku or "") if part]
    if len(parts) < 3 or parts[0].upper() != "BINBONKIDS":
        return ""
    return parts[-1]


def _id_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _size_key(size: str) -> str:
    cleaned = (size or "").strip().lower()
    cleaned = cleaned.replace("ı", "i").replace("İ", "i")
    cleaned = cleaned.replace("ş", "s").replace("ğ", "g").replace("ü", "u").replace("ö", "o").replace("ç", "c")
    cleaned = re.sub(r"\b(years?|yrs?|yas|yaş)\b", "y", cleaned)
    cleaned = re.sub(r"\b(months?|mos?|ay)\b", "m", cleaned)
    cleaned = re.sub(r"\b(one size|onesize|tek beden|standard)\b", "onesize", cleaned)
    cleaned = re.sub(r"(\d+)\s*-\s*(\d+)\s*y\b", r"\1-\2y", cleaned)
    cleaned = re.sub(r"(\d+)\s*-\s*(\d+)\s*m\b", r"\1-\2m", cleaned)
    cleaned = re.sub(r"(\d+)\s*y\b", r"\1y", cleaned)
    cleaned = re.sub(r"(\d+)\s*m\b", r"\1m", cleaned)
    return re.sub(r"[^a-z0-9]+", "", cleaned) or "onesize"


def _int(value: Any, default: int) -> int:
    try:
        return int(value)
    except Exception:
        return default
