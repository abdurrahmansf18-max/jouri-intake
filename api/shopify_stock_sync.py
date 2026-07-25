from datetime import datetime, timezone
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

import activity_logger
import product_service
import shopify
from database import SessionLocal
from db_models import Product
from realtime import ws_manager


def queue_shopify_stock_sync(
    background_tasks: BackgroundTasks,
    product_id: str,
    reason: str,
    linked_product_id: str | None,
) -> None:
    if not (linked_product_id or "").strip():
        return
    background_tasks.add_task(sync_shopify_stock_after_change, product_id, reason)


def queue_shopify_metadata_sync(
    background_tasks: BackgroundTasks,
    product_id: str,
    reason: str,
    linked_product_id: str | None,
) -> None:
    if not (linked_product_id or "").strip():
        return
    background_tasks.add_task(sync_shopify_metadata_after_change, product_id, reason)


async def sync_shopify_stock_after_change(product_id: str, reason: str) -> None:
    db: Session = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product or not (product.shopify_product_id or "").strip():
            return

        try:
            result = await shopify.sync_existing_product_inventory(product)
            if result.get("skipped"):
                return
            now = datetime.now(timezone.utc)
            product.shopify_synced_at = now
            product.shopify_last_inventory_sync_at = now
            product.shopify_variants = result.get("variantLinks") or product.shopify_variants
            product.shopify_last_error = None
            activity_logger.log(
                db,
                "shopify_stock_sync",
                product_id=product.id,
                product_title=product.title_raw,
                details={
                    "reason": reason,
                    "variants": result.get("variants"),
                    "inventory": result.get("inventory"),
                    "filters": result.get("filters"),
                    "googleShopping": result.get("googleShopping"),
                },
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            product = db.query(Product).filter(Product.id == product_id).first()
            if not product:
                return
            product.shopify_last_error = _stock_sync_error(reason, exc)
            activity_logger.log(
                db,
                "shopify_stock_sync_failed",
                product_id=product.id,
                product_title=product.title_raw,
                details={"reason": reason, "error": str(exc)},
            )
            db.commit()

        db.refresh(product)
        record = product_service.to_record(product)
        await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
    finally:
        db.close()


async def sync_shopify_metadata_after_change(product_id: str, reason: str) -> None:
    db: Session = SessionLocal()
    try:
        product = db.query(Product).filter(Product.id == product_id).first()
        if not product or not (product.shopify_product_id or "").strip():
            return

        try:
            related_products = _load_related_shopify_products(db, product)
            result = await shopify.sync_existing_product_metafields(product, related_products)
            if result.get("skipped"):
                return
            now = datetime.now(timezone.utc)
            product.shopify_synced_at = now
            product.shopify_last_error = None
            activity_logger.log(
                db,
                "shopify_metadata_sync",
                product_id=product.id,
                product_title=product.title_raw,
                details={
                    "reason": reason,
                    "filters": result.get("filters"),
                    "googleShopping": result.get("googleShopping"),
                },
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            product = db.query(Product).filter(Product.id == product_id).first()
            if not product:
                return
            product.shopify_last_error = _metadata_sync_error(reason, exc)
            activity_logger.log(
                db,
                "shopify_metadata_sync_failed",
                product_id=product.id,
                product_title=product.title_raw,
                details={"reason": reason, "error": str(exc)},
            )
            db.commit()

        db.refresh(product)
        record = product_service.to_record(product)
        await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
    finally:
        db.close()


def _load_related_shopify_products(db: Session, product: Product) -> list[Product]:
    ids = [rid for rid in (product.related_products or []) if rid and rid != product.id]
    if not ids:
        return []
    products = db.query(Product).filter(Product.id.in_(ids)).all()
    by_id = {related.id: related for related in products if (related.shopify_product_id or "").strip()}
    return [by_id[rid] for rid in ids if rid in by_id]


def _stock_sync_error(reason: str, exc: Any) -> str:
    message = " ".join(str(exc).split())
    return f"Shopify stock sync failed after {reason}: {message[:220]}"


def _metadata_sync_error(reason: str, exc: Any) -> str:
    message = " ".join(str(exc).split())
    return f"Shopify metadata sync failed after {reason}: {message[:220]}"
