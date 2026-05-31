import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timezone
from typing import Annotated

import pyotp
from fastapi import Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Query, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import activity_logger
import file_manager
from database import SessionLocal, get_db
from db_models import ActivityLog, Product
from models import (
    AuthRequest,
    ParsedProduct,
    ProductRecord,
    ProductStatus,
    ProductUpdateRequest,
    ResetSalesRequest,
    RestoreProductRequest,
    SaleRecord,
    SavedImage,
    SellProductRequest,
    StatusUpdateRequest,
)
from parser import parse_description

TOTP_SECRET = os.environ.get("TOTP_SECRET", "").strip()
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
AUTH_COOKIE_NAME = "jouri_session"
SESSION_TTL = 60 * 60 * 24 * 7  # 7 gün

# Bellek içi oturum deposu: {token: oluşturulma_zamanı}
_sessions: dict[str, float] = {}


def _create_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time()
    # Süresi dolmuş oturumları temizle
    expired = [t for t, ts in list(_sessions.items()) if time.time() - ts > SESSION_TTL]
    for t in expired:
        _sessions.pop(t, None)
    return token


def _is_valid_session(token: str | None) -> bool:
    if not token:
        return False
    ts = _sessions.get(token)
    if ts is None:
        return False
    if time.time() - ts > SESSION_TTL:
        _sessions.pop(token, None)
        return False
    return True


# ── Startup helpers (defined before lifespan so they are in scope) ────────────

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
                    german_title=parsed.get("germanTitleSuggestion", ""),
                    category=parsed.get("categorySuggestion", ""),
                    product_type=parsed.get("productTypeSuggestion", ""),
                    price_amount=parsed.get("priceAmount", ""),
                    currency=parsed.get("currency", ""),
                    color_raw=parsed.get("colorRaw", ""),
                    color_german=parsed.get("colorGermanSuggestion", ""),
                    sizes_raw=parsed.get("sizesRaw", ""),
                    tags=parsed.get("tags", []),
                    images=data.get("images", []),
                    sale_history=data.get("saleHistory", []),
                )
                db.add(product)
                imported += 1
            except Exception as exc:
                print(f"[startup] Skipping {entry.name}: {exc}")
    return imported


@asynccontextmanager
async def lifespan(_: FastAPI):
    _startup_migrate()
    yield


app = FastAPI(title="Jouri Intake API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Auth guard ────────────────────────────────────────────────────────────────

def verify_access(
    jouri_session: Annotated[str | None, Cookie()] = None,
):
    if not TOTP_SECRET:
        return  # Auth yapılandırılmamış, serbest
    if not _is_valid_session(jouri_session):
        raise HTTPException(status_code=401, detail={"code": "ERR_UNAUTHORIZED"})


# ── Helpers ───────────────────────────────────────────────────────────────────

def _to_record(p: Product) -> ProductRecord:
    from pathlib import Path
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
            germanTitleSuggestion=p.german_title,
            categorySuggestion=p.category,
            productTypeSuggestion=p.product_type,
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
    )


def _get_or_404(db: Session, product_id: str) -> Product:
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    return p


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/api/auth/verify")
def auth_verify(body: AuthRequest, response: Response):
    if not TOTP_SECRET:
        return {"ok": True}
    totp = pyotp.TOTP(TOTP_SECRET)
    if not totp.verify(body.code.strip(), valid_window=1):
        raise HTTPException(status_code=401, detail={"code": "ERR_WRONG_CODE"})
    token = _create_session()
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=COOKIE_SECURE,
        max_age=SESSION_TTL,
    )
    return {"ok": True}


@app.get("/api/auth/required")
def auth_required():
    return {"required": bool(TOTP_SECRET)}


# ── Products ──────────────────────────────────────────────────────────────────

@app.get("/api/products", response_model=list[ProductRecord])
def get_products(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    products = db.query(Product).order_by(Product.created_at.desc()).all()
    return [_to_record(p) for p in products]


@app.post("/api/products", response_model=ProductRecord)
async def create_product(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    description: Annotated[str, Form()] = "",
    images: Annotated[list[UploadFile], File()] = [],
    titleRaw: Annotated[str | None, Form()] = None,
    germanTitleSuggestion: Annotated[str | None, Form()] = None,
    categorySuggestion: Annotated[str | None, Form()] = None,
    productTypeSuggestion: Annotated[str | None, Form()] = None,
    priceAmount: Annotated[str | None, Form()] = None,
    currency: Annotated[str | None, Form()] = None,
    colorRaw: Annotated[str | None, Form()] = None,
    colorGermanSuggestion: Annotated[str | None, Form()] = None,
    sizesRaw: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
    stockQuantity: Annotated[int | None, Form()] = None,
):
    # Required field validation
    if not titleRaw or not titleRaw.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_TITLE_REQUIRED"})
    if not priceAmount or not priceAmount.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_PRICE_REQUIRED"})
    if not colorRaw or not colorRaw.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_COLOR_REQUIRED"})
    if not sizesRaw or not sizesRaw.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_SIZE_REQUIRED"})
    if stockQuantity is None or stockQuantity < 1:
        raise HTTPException(status_code=422, detail={"code": "ERR_STOCK_REQUIRED"})
    if not images:
        raise HTTPException(status_code=422, detail={"code": "ERR_IMAGE_REQUIRED"})
    if not description.strip():
        raise HTTPException(status_code=422, detail={"code": "ERR_DESCRIPTION_REQUIRED"})

    parsed = parse_description(description)
    overrides = {
        "titleRaw": titleRaw.strip() if titleRaw else parsed.titleRaw,
        "germanTitleSuggestion": germanTitleSuggestion.strip() if germanTitleSuggestion else parsed.germanTitleSuggestion,
        "categorySuggestion": categorySuggestion.strip() if categorySuggestion else parsed.categorySuggestion,
        "productTypeSuggestion": productTypeSuggestion.strip() if productTypeSuggestion else parsed.productTypeSuggestion,
        "priceAmount": priceAmount.strip() if priceAmount else parsed.priceAmount,
        "currency": currency.strip() if currency else (parsed.currency or "EUR"),
        "colorRaw": colorRaw.strip() if colorRaw else parsed.colorRaw,
        "colorGermanSuggestion": colorGermanSuggestion.strip() if colorGermanSuggestion else parsed.colorGermanSuggestion,
        "sizesRaw": sizesRaw.strip() if sizesRaw else parsed.sizesRaw,
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
        stock_quantity=max(1, stockQuantity),
        sold_quantity=0,
        title_raw=parsed.titleRaw,
        german_title=parsed.germanTitleSuggestion,
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
    )
    db.add(product)
    activity_logger.log(
        db, "create",
        product_id=folder_name,
        product_title=parsed.titleRaw or parsed.germanTitleSuggestion,
    )
    db.commit()
    db.refresh(product)
    return _to_record(product)


@app.patch("/api/products/{product_id}/status", response_model=ProductRecord)
def update_status(
    product_id: str,
    body: StatusUpdateRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    old_status = p.status
    new_status = body.status.value

    if old_status != new_status:
        new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, new_status)
        p.folder_path = new_path

    p.status = new_status
    p.stock_quantity = 0 if new_status == "sold_archive" else max(1, p.stock_quantity)

    activity_logger.log(
        db, "status_change",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
        details={"from": old_status, "to": new_status},
    )
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.patch("/api/products/{product_id}", response_model=ProductRecord)
def update_product(
    product_id: str,
    body: ProductUpdateRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)

    if body.notes is not None:
        p.notes = body.notes
    if body.stockQuantity is not None:
        p.stock_quantity = max(0, int(body.stockQuantity))
    if body.parsed:
        pd = body.parsed
        if pd.titleRaw is not None: p.title_raw = pd.titleRaw
        if pd.germanTitleSuggestion is not None: p.german_title = pd.germanTitleSuggestion
        if pd.categorySuggestion is not None: p.category = pd.categorySuggestion
        if pd.productTypeSuggestion is not None: p.product_type = pd.productTypeSuggestion
        if pd.priceAmount is not None: p.price_amount = pd.priceAmount
        if pd.currency is not None: p.currency = pd.currency
        if pd.colorRaw is not None: p.color_raw = pd.colorRaw
        if pd.colorGermanSuggestion is not None: p.color_german = pd.colorGermanSuggestion
        if pd.sizesRaw is not None: p.sizes_raw = pd.sizesRaw
        if pd.tags is not None: p.tags = pd.tags

    activity_logger.log(
        db, "update",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
    )
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.post("/api/products/{product_id}/sell", response_model=ProductRecord)
def sell_product(
    product_id: str,
    body: SellProductRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    quantity = max(1, int(body.quantity))
    current_stock = max(0, p.stock_quantity)
    sold_amount = min(quantity, max(current_stock, 1))
    next_stock = max(0, current_stock - quantity)
    now = datetime.now(timezone.utc)

    p.sale_history = list(p.sale_history or []) + [
        {"soldAt": now.isoformat(), "quantity": sold_amount, "note": (body.note or "").strip()}
    ]
    p.sold_quantity = (p.sold_quantity or 0) + sold_amount
    p.last_sold_at = now
    p.stock_quantity = next_stock

    if next_stock == 0:
        new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "sold_archive")
        p.folder_path = new_path
        p.status = "sold_archive"

    activity_logger.log(
        db, "sell",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
        details={"quantity": sold_amount, "note": body.note or ""},
    )
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.post("/api/products/{product_id}/sales/reset", response_model=ProductRecord)
def reset_sales(
    product_id: str,
    body: ResetSalesRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    p.sold_quantity = 0
    p.last_sold_at = None
    p.sale_history = []
    if body.stockQuantity is not None:
        p.stock_quantity = max(0, int(body.stockQuantity))

    activity_logger.log(db, "reset_sales", product_id=p.id, product_title=p.title_raw or p.german_title)
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.post("/api/products/{product_id}/restore", response_model=ProductRecord)
def restore_product(
    product_id: str,
    body: RestoreProductRequest,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "pending")
    p.folder_path = new_path
    p.status = "pending"
    p.stock_quantity = max(1, int(body.stockQuantity))

    activity_logger.log(
        db, "restore",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
        details={"stock": p.stock_quantity},
    )
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.post("/api/products/{product_id}/images", response_model=ProductRecord)
async def add_product_images(
    product_id: str,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    images: Annotated[list[UploadFile], File()] = [],
):
    if not images:
        raise HTTPException(status_code=422, detail={"code": "ERR_IMAGE_REQUIRED"})

    p = _get_or_404(db, product_id)
    existing = list(p.images or [])
    next_idx = file_manager.get_next_image_index(existing)

    from pathlib import Path
    image_data = [
        (img.filename or "image.jpg", await img.read(), img.content_type or "image/jpeg")
        for img in images
    ]
    new_images = file_manager.save_images(Path(p.folder_path), image_data, start_index=next_idx)
    p.images = existing + [img.model_dump() for img in new_images]

    activity_logger.log(
        db, "add_images",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
        details={"count": len(new_images)},
    )
    db.commit()
    db.refresh(p)
    return _to_record(p)


@app.delete("/api/products/{product_id}")
def delete_product(
    product_id: str,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    title = p.title_raw or p.german_title or product_id
    folder_path = p.folder_path

    activity_logger.log(db, "delete", product_id=p.id, product_title=title)
    db.delete(p)
    db.flush()

    try:
        file_manager.delete_product_folder(folder_path)
    except Exception:
        pass

    db.commit()
    return {"ok": True}


@app.get("/api/products/{product_id}/images/{kind}/{file_name}")
def product_image(
    product_id: str,
    kind: str,
    file_name: str,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    try:
        path = file_manager.resolve_image_path(p.folder_path, kind, file_name)
        return FileResponse(path)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})


# ── Backup management ─────────────────────────────────────────────────────────

BACKUP_ROOT = Path("/backups")


@app.get("/api/backups")
def get_backups(_: Annotated[None, Depends(verify_access)]):
    from pathlib import Path as P
    import json as _json

    status_file = BACKUP_ROOT / "status.json"
    status = {}
    if status_file.exists():
        try:
            status = _json.loads(status_file.read_text())
        except Exception:
            pass

    backups = []
    if BACKUP_ROOT.exists():
        for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
            if not entry.is_dir() or not entry.name.startswith("20"):
                continue
            db_file = entry / "db.sql"
            img_dir = entry / "products_photo"
            backups.append({
                "date": entry.name,
                "db_size": _dir_size(db_file),
                "img_size": _dir_size(img_dir),
            })

    return {"status": status, "backups": backups}


@app.delete("/api/backups/{date}")
def delete_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    import re as _re
    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise HTTPException(status_code=400, detail={"code": "ERR_GENERAL"})
    backup_dir = BACKUP_ROOT / date
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    import shutil as _shutil
    _shutil.rmtree(str(backup_dir))
    return {"ok": True}


def _dir_size(path) -> str:
    from pathlib import Path as P
    p = P(path)
    if not p.exists():
        return "-"
    if p.is_file():
        size = p.stat().st_size
    else:
        size = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


# ── Activity logs ─────────────────────────────────────────────────────────────

@app.get("/api/logs")
def get_logs(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=200),
):
    logs = (
        db.query(ActivityLog)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": log.id,
            "created_at": log.created_at.isoformat(),
            "action": log.action,
            "product_id": log.product_id,
            "product_title": log.product_title,
            "details": log.details,
        }
        for log in logs
    ]
