import json
import re
from datetime import datetime, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

import file_manager
from database import SessionLocal
from db_models import Product
from size_utils import normalize_size_label, normalize_size_stock_list, normalize_size_values


def run_startup_tasks() -> None:
    _startup_migrate()
    _migrate_size_stocks()
    _normalize_existing_sizes()


def _startup_migrate() -> None:
    db = SessionLocal()
    try:
        count = db.query(Product).count()
        if count == 0:
            imported = _import_from_filesystem(db)
            if imported > 0:
                db.commit()
                print(f"[startup] Imported {imported} products from filesystem to PostgreSQL.")
    except Exception as exc:
        print(f"[startup] Migration warning: {exc}")
    finally:
        db.close()


def _import_from_filesystem(db: Session) -> int:
    status_dirs = {
        "pending": file_manager.DRAFT_ROOT,
        "ai_enhanced": file_manager.AI_ROOT,
        "published": file_manager.PUBLISHED_ROOT,
        "sold_archive": file_manager.SOLD_ARCHIVE_ROOT,
    }
    imported = 0
    for status_name, root in status_dirs.items():
        if not root.exists():
            continue
        for entry in root.iterdir():
            if not entry.is_dir():
                continue
            meta_path = entry / "metadata.json"
            if not meta_path.exists():
                continue
            try:
                data = json.loads(meta_path.read_text(encoding="utf-8"))
                record_id = data.get("id", entry.name)
                if db.query(Product).filter(Product.id == record_id).first():
                    continue
                parsed = data.get("parsed", {})
                last_sold_raw = data.get("lastSoldAt")
                last_sold = None
                if last_sold_raw:
                    try:
                        last_sold = datetime.fromisoformat(last_sold_raw)
                    except ValueError:
                        pass
                shopify_data = data.get("shopify") or {}
                shopify_synced = _parse_datetime(shopify_data.get("syncedAt"))
                shopify_inventory_synced = _parse_datetime(shopify_data.get("lastInventorySyncAt"))
                shopify_order_synced = _parse_datetime(shopify_data.get("lastOrderSyncAt"))
                created_raw = data.get("createdAt", "")
                try:
                    created_at = datetime.fromisoformat(created_raw)
                except ValueError:
                    created_at = datetime.now(timezone.utc)

                product = Product(
                    id=record_id,
                    created_at=created_at,
                    folder_name=data.get("folderName", entry.name),
                    folder_path=str(entry),
                    description=data.get("description", ""),
                    status=status_name,
                    notes=data.get("notes", ""),
                    stock_quantity=max(0, int(data.get("stockQuantity", 1))),
                    sold_quantity=max(0, int(data.get("soldQuantity", 0))),
                    last_sold_at=last_sold,
                    title_raw=parsed.get("titleRaw", ""),
                    category=parsed.get("categorySuggestion", ""),
                    product_type=parsed.get("productTypeSuggestion", ""),
                    price_amount=parsed.get("priceAmount", ""),
                    currency=parsed.get("currency", ""),
                    color_raw=parsed.get("colorRaw", ""),
                    color_german=parsed.get("colorGermanSuggestion", ""),
                    sizes_raw=parsed.get("sizesRaw", ""),
                    tags=parsed.get("tags", []),
                    is_discounted=bool(data.get("isDiscounted", False)),
                    compare_at_price_amount=data.get("compareAtPriceAmount", ""),
                    discount_note=data.get("discountNote", ""),
                    is_final_sale=bool(data.get("isFinalSale", False)),
                    is_limited_time_deal=bool(data.get("isLimitedTimeDeal", False)),
                    images=data.get("images", []),
                    sale_history=data.get("saleHistory", []),
                    shopify_product_id=shopify_data.get("productId"),
                    shopify_product_handle=shopify_data.get("handle"),
                    shopify_synced_at=shopify_synced,
                    shopify_last_inventory_sync_at=shopify_inventory_synced,
                    shopify_last_order_sync_at=shopify_order_synced,
                    shopify_last_error=shopify_data.get("lastError"),
                    shopify_variants=shopify_data.get("variants", []),
                    shopify_order_history=shopify_data.get("orderHistory", []),
                )
                db.add(product)
                imported += 1
            except Exception as exc:
                print(f"[startup] Skipping {entry.name}: {exc}")
    return imported


def _parse_datetime(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _migrate_size_stocks() -> None:
    """PostgreSQL'e size_stocks kolonu ekle ve mevcut ürünleri migrate et."""
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS size_stocks JSON"))
        db.execute(text("ALTER TABLE products DROP COLUMN IF EXISTS german_title"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_sizes JSON"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS related_products JSON"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_product_id VARCHAR"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_product_handle VARCHAR"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_synced_at TIMESTAMP WITH TIME ZONE"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_last_inventory_sync_at TIMESTAMP WITH TIME ZONE"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_last_order_sync_at TIMESTAMP WITH TIME ZONE"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_last_error TEXT"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_variants JSON"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS shopify_order_history JSON"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_discounted BOOLEAN NOT NULL DEFAULT FALSE"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS compare_at_price_amount VARCHAR NOT NULL DEFAULT ''"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS discount_note TEXT NOT NULL DEFAULT ''"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_final_sale BOOLEAN NOT NULL DEFAULT FALSE"))
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_limited_time_deal BOOLEAN NOT NULL DEFAULT FALSE"))
        db.commit()

        products = db.query(Product).filter(Product.size_stocks == None).all()  # noqa: E711
        for p in products:
            sizes = [s.strip() for s in (p.sizes_raw or "").split(",") if s.strip()]
            total = max(0, p.stock_quantity)
            if not sizes:
                p.size_stocks = [{"size": "—", "qty": total}] if total > 0 else []
            elif len(sizes) == 1:
                p.size_stocks = [{"size": sizes[0], "qty": total}]
            else:
                per_size = total // len(sizes)
                remainder = total % len(sizes)
                p.size_stocks = [
                    {"size": s, "qty": per_size + (1 if i < remainder else 0)}
                    for i, s in enumerate(sizes)
                ]
        db.commit()
        print(f"[startup] size_stocks migration done ({len(products)} products updated).")
    except Exception as exc:
        print(f"[startup] size_stocks migration warning: {exc}")
        db.rollback()
    finally:
        db.close()


def _normalize_existing_sizes() -> None:
    db = SessionLocal()
    changed = 0
    try:
        products = db.query(Product).all()
        for p in products:
            context = _size_context_for_product(p)
            next_stocks = normalize_size_stock_list(p.size_stocks or [], context)
            if next_stocks and next_stocks != (p.size_stocks or []):
                p.size_stocks = next_stocks
                changed += 1

            raw_sizes = [s.strip() for s in re.split(r"[,/]+", p.sizes_raw or "") if s.strip()]
            next_sizes = normalize_size_values(raw_sizes, context)
            next_sizes_raw = ", ".join(next_sizes)
            if next_sizes_raw and next_sizes_raw != (p.sizes_raw or ""):
                p.sizes_raw = next_sizes_raw
                changed += 1

            next_sold_sizes = []
            sold_changed = False
            for entry in p.sold_sizes or []:
                label = normalize_size_label(str((entry or {}).get("size") or ""), context)
                next_entry = {**entry, "size": label or str((entry or {}).get("size") or "")}
                if next_entry != entry:
                    sold_changed = True
                next_sold_sizes.append(next_entry)
            if sold_changed:
                p.sold_sizes = next_sold_sizes
                changed += 1

            next_variant_links = []
            variant_changed = False
            for link in p.shopify_variants or []:
                label = normalize_size_label(str((link or {}).get("size") or ""), context)
                next_link = {**link, "size": label or str((link or {}).get("size") or "")}
                if next_link != link:
                    variant_changed = True
                next_variant_links.append(next_link)
            if variant_changed:
                p.shopify_variants = next_variant_links
                changed += 1

        if changed:
            db.commit()
        print(f"[startup] size normalization done ({changed} product fields updated).")
    except Exception as exc:
        print(f"[startup] size normalization warning: {exc}")
        db.rollback()
    finally:
        db.close()


def _size_context_for_product(product: Product) -> str:
    return " ".join([
        product.category or "",
        product.product_type or "",
        product.title_raw or "",
        product.sizes_raw or "",
        product.description or "",
        " ".join(product.tags or []),
    ])
