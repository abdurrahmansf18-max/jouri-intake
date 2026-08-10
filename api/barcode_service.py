from fastapi import HTTPException
from sqlalchemy.orm import Session

from db_models import Product


def clean_barcode(value: str) -> str:
    return "".join(ch for ch in str(value or "").strip() if not ch.isspace())


def clean_barcodes(values: list[str] | None) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values or []:
        cleaned = clean_barcode(value)
        key = cleaned.lower()
        if cleaned and key not in seen:
            seen.add(key)
            result.append(cleaned)
    return result


def ensure_unique_barcodes(db: Session, product_id: str, barcodes: list[str], size_stocks: list[dict]) -> None:
    requested = {clean_barcode(code).lower() for code in barcodes if clean_barcode(code)}
    requested.update(
        clean_barcode(str(stock.get("barcode") or "")).lower()
        for stock in size_stocks
        if clean_barcode(str(stock.get("barcode") or ""))
    )
    requested.discard("")
    if not requested:
        return

    products = db.query(Product).all()
    for product in products:
        for code in product.barcodes or []:
            key = clean_barcode(str(code)).lower()
            if key in requested and product.id != product_id:
                raise HTTPException(status_code=409, detail={"code": "ERR_BARCODE_DUPLICATE"})
        for stock in product.size_stocks or []:
            key = clean_barcode(str(stock.get("barcode") or "")).lower()
            if key in requested and product.id != product_id:
                raise HTTPException(status_code=409, detail={"code": "ERR_BARCODE_DUPLICATE"})
