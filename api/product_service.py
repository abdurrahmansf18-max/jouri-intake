from pathlib import Path

from fastapi import HTTPException
from sqlalchemy.orm import Session

import file_manager
from db_models import Product
from models import (
    ParsedProduct,
    ProductRecord,
    ProductStatus,
    SaleRecord,
    SavedImage,
    SizeStock,
    SoldSizeEntry,
    ShopifySyncInfo,
)
from parser import normalize_category, normalize_product_type


def to_record(p: Product) -> ProductRecord:
    folder_path = Path(p.folder_path)
    image_folders = file_manager.build_image_folders(folder_path, p.folder_name, p.status)
    return ProductRecord(
        id=p.id,
        createdAt=p.created_at.isoformat(),
        folderName=p.folder_name,
        folderPath=p.folder_path,
        imageFolders=image_folders,
        description=p.description,
        parsed=ParsedProduct(
            titleRaw=p.title_raw,
            categorySuggestion=normalize_category(p.category),
            productTypeSuggestion=normalize_product_type(p.product_type),
            priceAmount=p.price_amount,
            currency=p.currency,
            colorRaw=p.color_raw,
            colorGermanSuggestion=p.color_german,
            sizesRaw=p.sizes_raw,
            tags=p.tags or [],
        ),
        images=[SavedImage(**img) for img in (p.images or [])],
        status=ProductStatus(p.status),
        notes=p.notes or "",
        stockQuantity=max(0, p.stock_quantity),
        soldQuantity=max(0, p.sold_quantity),
        lastSoldAt=p.last_sold_at.isoformat() if p.last_sold_at else None,
        saleHistory=[SaleRecord(**s) for s in (p.sale_history or [])],
        sizeStocks=[SizeStock(**ss) for ss in (p.size_stocks or [])],
        soldSizes=[SoldSizeEntry(**ss) for ss in (p.sold_sizes or [])],
        relatedProducts=list(p.related_products or []),
        shopify=ShopifySyncInfo(
            productId=p.shopify_product_id,
            handle=p.shopify_product_handle,
            syncedAt=p.shopify_synced_at.isoformat() if p.shopify_synced_at else None,
            lastError=p.shopify_last_error,
        ),
    )


def get_or_404(db: Session, product_id: str) -> Product:
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    return product
