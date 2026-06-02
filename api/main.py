import json
import os
import secrets
import time
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Annotated

import pyotp
from collections import defaultdict
from fastapi import BackgroundTasks, Cookie, Depends, FastAPI, File, Form, Header, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy import text
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
    SizeStock,
    StatusUpdateRequest,
)
from parser import parse_description

TOTP_SECRET = os.environ.get("TOTP_SECRET", "").strip()
USER_PASSWORD = os.environ.get("USER_PASSWORD", "").strip()
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
AUTH_COOKIE_NAME = "jouri_session"
SESSION_TTL = 60 * 60 * 24  # 24 saat
EDIT_LOCK_CODE = os.environ.get("EDIT_LOCK_CODE", "").strip()

# Bellek içi oturum deposu: {token: oluşturulma_zamanı}
_sessions: dict[str, float] = {}


# ── WebSocket bağlantı yöneticisi ─────────────────────────────────────────────

class ConnectionManager:
    def __init__(self) -> None:
        self._conns: list[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._conns.append(ws)

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self._conns:
            self._conns.remove(ws)

    async def broadcast(self, data: dict) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._conns):
            try:
                await ws.send_json(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ws_manager = ConnectionManager()


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


def _migrate_size_stocks() -> None:
    """PostgreSQL'e size_stocks kolonu ekle ve mevcut ürünleri migrate et."""
    db = SessionLocal()
    try:
        db.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS size_stocks JSON"))
        db.commit()

        # size_stocks'u olmayan ürünleri otomatik migrate et
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    _startup_migrate()
    _migrate_size_stocks()
    yield


# Auth endpoint rate limiter: IP başına 10 deneme / 60 saniye, sonra 5 dk ban
_auth_attempts: dict[str, list[float]] = defaultdict(list)
_AUTH_MAX = 10
_AUTH_WINDOW = 60
_AUTH_LOCKOUT = 300

def _auth_rate_ok(ip: str) -> bool:
    now = time.time()
    attempts = [t for t in _auth_attempts[ip] if now - t < _AUTH_WINDOW]
    _auth_attempts[ip] = attempts
    if len(attempts) >= _AUTH_MAX:
        return False
    attempts.append(now)
    return True


app = FastAPI(title="Jouri Intake API", lifespan=lifespan, docs_url=None, redoc_url=None)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://syncra.website", "https://www.syncra.website"],
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
        sizeStocks=[SizeStock(**ss) for ss in (p.size_stocks or [])],
    )


def _get_or_404(db: Session, product_id: str) -> Product:
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    return p


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/api/auth/verify")
def auth_verify(body: AuthRequest, response: Response, request: Request):
    # Auth yapılandırılmamışsa serbest geç
    if not TOTP_SECRET and not USER_PASSWORD:
        return {"ok": True}

    client_ip = (request.client.host if request.client else "unknown")
    if not _auth_rate_ok(client_ip):
        raise HTTPException(status_code=429, detail={"code": "ERR_RATE_LIMITED"})

    code = body.code.strip()

    # TOTP kontrolü (6 haneli sayı)
    totp_ok = False
    if TOTP_SECRET and code.isdigit() and len(code) == 6:
        totp_ok = pyotp.TOTP(TOTP_SECRET).verify(code, valid_window=1)

    # Sabit şifre kontrolü
    password_ok = bool(USER_PASSWORD and code == USER_PASSWORD)

    if not totp_ok and not password_ok:
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


@app.get("/api/auth/check")
def auth_check(_: Annotated[None, Depends(verify_access)]):
    return {"authed": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/auth/verify-edit-lock")
def verify_edit_lock(body: AuthRequest, _: Annotated[None, Depends(verify_access)]):
    if not EDIT_LOCK_CODE:
        return {"ok": True}
    if body.code.strip() != EDIT_LOCK_CODE:
        raise HTTPException(status_code=401, detail={"code": "ERR_WRONG_CODE"})
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    jouri_session: Annotated[str | None, Cookie()] = None,
):
    if TOTP_SECRET and not _is_valid_session(jouri_session):
        await ws.close(code=4001)
        return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


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
    sizeStocksJson: Annotated[str | None, Form()] = None,
    notes: Annotated[str | None, Form()] = None,
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
        "germanTitleSuggestion": "",
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
        size_stocks=size_stocks_data,
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
    background_tasks: BackgroundTasks,
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
    if new_status == "sold_archive":
        p.stock_quantity = 0
        if p.size_stocks:
            p.size_stocks = [{"size": ss["size"], "qty": 0} for ss in p.size_stocks]
    else:
        p.stock_quantity = max(1, p.stock_quantity)

    activity_logger.log(
        db, "status_change",
        product_id=p.id,
        product_title=p.title_raw or p.german_title,
        details={"from": old_status, "to": new_status},
    )
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.patch("/api/products/{product_id}", response_model=ProductRecord)
def update_product(
    product_id: str,
    body: ProductUpdateRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)

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
        if pd.germanTitleSuggestion is not None:
            track("german_title", p.german_title, pd.germanTitleSuggestion); p.german_title = pd.germanTitleSuggestion
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
        product_title=p.title_raw or p.german_title,
        details={"changed": changes} if changes else None,
    )
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.post("/api/products/{product_id}/sell", response_model=ProductRecord)
def sell_product(
    product_id: str,
    body: SellProductRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
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
    else:
        # Eski sistem (beden yoksa toplam stok)
        current_stock = max(0, p.stock_quantity)
        if current_stock <= 0:
            raise HTTPException(status_code=400, detail={"code": "ERR_OUT_OF_STOCK"})
        sold_amount = min(quantity, current_stock)
        next_stock = current_stock - sold_amount

    p.sale_history = list(p.sale_history or []) + [
        {
            "soldAt": now.isoformat(),
            "quantity": sold_amount,
            "size": body.size or "",
            "note": (body.note or "").strip(),
        }
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
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.post("/api/products/{product_id}/sales/reset", response_model=ProductRecord)
def reset_sales(
    product_id: str,
    body: ResetSalesRequest,
    background_tasks: BackgroundTasks,
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
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.post("/api/products/{product_id}/restore", response_model=ProductRecord)
def restore_product(
    product_id: str,
    body: RestoreProductRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    new_path = file_manager.move_product_folder(p.folder_path, p.folder_name, "pending")
    p.folder_path = new_path
    p.status = "pending"
    p.stock_quantity = max(1, int(body.stockQuantity))

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
        product_title=p.title_raw or p.german_title,
        details={"stock": p.stock_quantity},
    )
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


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
    record = _to_record(p)
    await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.delete("/api/products/{product_id}")
def delete_product(
    product_id: str,
    background_tasks: BackgroundTasks,
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
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_deleted", "id": product_id})
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


@app.delete("/api/products/{product_id}/images/{kind}/{file_name}", response_model=ProductRecord)
def delete_product_image(
    product_id: str,
    kind: str,
    file_name: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
    try:
        path = file_manager.resolve_image_path(p.folder_path, kind, file_name)
        path.unlink()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})
    p.images = [img for img in (p.images or []) if img.get("fileName") != file_name]
    activity_logger.log(db, "update", product_id=p.id, product_title=p.title_raw or p.german_title,
                        details={"changed": {"image_deleted": {"from": file_name, "to": ""}}})
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


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


@app.post("/api/backups/run")
def run_backup(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    """Manuel yedekleme: DB JSON export + artımlı fotoğraf kopyalama."""
    import json as _json
    import shutil as _shutil

    if not BACKUP_ROOT.exists():
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})

    now = datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    started_str = now.strftime("%Y-%m-%dT%H:%M:%S")

    today_dir = BACKUP_ROOT / date_str
    today_dir.mkdir(parents=True, exist_ok=True)

    try:
        # 1. DB — JSON formatında export
        products = db.query(Product).all()
        logs = db.query(ActivityLog).all()
        db_data = {
            "exported_at": started_str,
            "products": [
                {
                    "id": p.id,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "folder_name": p.folder_name,
                    "folder_path": p.folder_path,
                    "description": p.description,
                    "status": p.status,
                    "notes": p.notes,
                    "stock_quantity": p.stock_quantity,
                    "sold_quantity": p.sold_quantity,
                    "last_sold_at": p.last_sold_at.isoformat() if p.last_sold_at else None,
                    "title_raw": p.title_raw,
                    "german_title": p.german_title,
                    "category": p.category,
                    "product_type": p.product_type,
                    "price_amount": p.price_amount,
                    "currency": p.currency,
                    "color_raw": p.color_raw,
                    "color_german": p.color_german,
                    "sizes_raw": p.sizes_raw,
                    "tags": p.tags,
                    "images": p.images,
                    "sale_history": p.sale_history,
                    "size_stocks": p.size_stocks,
                }
                for p in products
            ],
            "activity_logs": [
                {
                    "id": log.id,
                    "created_at": log.created_at.isoformat() if log.created_at else None,
                    "action": log.action,
                    "product_id": log.product_id,
                    "product_title": log.product_title,
                    "details": log.details,
                }
                for log in logs
            ],
        }
        db_file = today_dir / "db.json"
        db_file.write_text(_json.dumps(db_data, ensure_ascii=False, indent=2), encoding="utf-8")

        # 2. Fotoğraflar — artımlı kopyalama (sadece yeni/değişen dosyalar)
        photos_src = Path("/products_photo")
        photos_dst = today_dir / "products_photo"
        if photos_src.exists():
            photos_dst.mkdir(exist_ok=True)
            for item in photos_src.rglob("*"):
                if not item.is_file():
                    continue
                rel = item.relative_to(photos_src)
                dst_file = photos_dst / rel
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                if not dst_file.exists() or item.stat().st_mtime > dst_file.stat().st_mtime:
                    _shutil.copy2(item, dst_file)

        # 3. Google Drive sync (rclone)
        import subprocess as _subprocess
        drive_ok: bool | None = None
        try:
            result = _subprocess.run(
                ["rclone", "sync", str(today_dir), f"gdrive:jouri-backups/{date_str}", "--quiet"],
                capture_output=True, timeout=120,
            )
            drive_ok = result.returncode == 0
        except (FileNotFoundError, _subprocess.TimeoutExpired):
            drive_ok = False

        # 4. status.json güncelle
        db_size = _dir_size(db_file)
        img_size = _dir_size(photos_dst) if photos_dst.exists() else "-"

        backups_list = []
        for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
            if not entry.is_dir() or not entry.name.startswith("20"):
                continue
            db_f = entry / "db.sql"
            if not db_f.exists():
                db_f = entry / "db.json"
            backups_list.append({
                "date": entry.name,
                "db_size": _dir_size(db_f),
                "img_size": _dir_size(entry / "products_photo"),
            })

        status_data: dict = {
            "last_run": started_str,
            "last_date": date_str,
            "last_db_size": db_size,
            "last_img_size": img_size,
            "drive_ok": drive_ok,
            "backups": backups_list,
        }
        (BACKUP_ROOT / "status.json").write_text(
            _json.dumps(status_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return {"status": status_data, "backups": backups_list}

    except Exception as exc:
        print(f"[backup] Manuel yedekleme hatası: {exc}")
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})


@app.delete("/api/backups/{date}")
def delete_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    import re as _re
    import shutil as _shutil
    import subprocess as _subprocess

    if not _re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise HTTPException(status_code=400, detail={"code": "ERR_GENERAL"})

    backup_dir = BACKUP_ROOT / date
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})

    # Local sil
    _shutil.rmtree(str(backup_dir))

    # Drive'dan da sil (hata olursa sessizce geç — local zaten silindi)
    try:
        _subprocess.run(
            ["rclone", "purge", f"gdrive:jouri-backups/{date}", "--quiet"],
            capture_output=True, timeout=30,
        )
    except Exception:
        pass

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
    # 7 günden eski logları otomatik sil
    cutoff = datetime.now(timezone.utc) - timedelta(days=7)
    db.query(ActivityLog).filter(ActivityLog.created_at < cutoff).delete()
    db.commit()

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


@app.delete("/api/logs/{log_id}")
def delete_log(
    log_id: int,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    log = db.query(ActivityLog).filter(ActivityLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    db.delete(log)
    db.commit()
    return {"ok": True}
