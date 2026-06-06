import json
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Annotated

from fastapi import BackgroundTasks, Cookie, Depends, FastAPI, File, Form, HTTPException, Query, Request, Response, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import activity_logger
import auth_service
import backup_service
import file_manager
import log_service
import shopify
import startup_service
from database import get_db
from db_models import Product
from models import (
    AuthRequest,
    ParseRequest,
    ParsedProduct,
    ProductRecord,
    ProductStatus,
    ProductUpdateRequest,
    ResetSalesRequest,
    RestoreProductRequest,
    RestoreSizeRequest,
    SaleRecord,
    SavedImage,
    SellProductRequest,
    SizeStock,
    SoldSizeEntry,
    StatusUpdateRequest,
    UpdateRelatedRequest,
)
from parser import parse_description, parse_description_ai


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


@asynccontextmanager
async def lifespan(_: FastAPI):
    startup_service.run_startup_tasks()
    yield


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
    auth_service.verify_access_token(jouri_session)


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
        soldSizes=[SoldSizeEntry(**ss) for ss in (p.sold_sizes or [])],
        relatedProducts=list(p.related_products or []),
    )


def _get_or_404(db: Session, product_id: str) -> Product:
    p = db.query(Product).filter(Product.id == product_id).first()
    if not p:
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})
    return p


# ── Auth endpoints ────────────────────────────────────────────────────────────

@app.post("/api/auth/verify")
def auth_verify(body: AuthRequest, response: Response, request: Request):
    client_ip = (request.client.host if request.client else "unknown")
    token = auth_service.verify_login(body.code, client_ip)
    if token is None:
        return {"ok": True}

    response.set_cookie(
        auth_service.AUTH_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=auth_service.COOKIE_SECURE,
        max_age=auth_service.SESSION_TTL,
    )
    return {"ok": True}


@app.get("/api/auth/required")
def auth_required():
    return {"required": auth_service.is_auth_required()}


@app.get("/api/auth/check")
def auth_check(_: Annotated[None, Depends(verify_access)]):
    return {"authed": True}


@app.post("/api/auth/logout")
def auth_logout(response: Response):
    response.delete_cookie(auth_service.AUTH_COOKIE_NAME, path="/")
    return {"ok": True}


@app.post("/api/auth/verify-edit-lock")
def verify_edit_lock(body: AuthRequest, _: Annotated[None, Depends(verify_access)]):
    auth_service.verify_edit_lock_code(body.code)
    return {"ok": True}


@app.websocket("/ws")
async def websocket_endpoint(
    ws: WebSocket,
    jouri_session: Annotated[str | None, Cookie()] = None,
):
    if auth_service.is_auth_required() and not auth_service.is_valid_session(jouri_session):
        await ws.close(code=4001)
        return
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)


# ── AI Parsing ────────────────────────────────────────────────────────────────

@app.post("/api/parse-product")
async def parse_product_text(
    req: ParseRequest,
    _: Annotated[None, Depends(verify_access)]
):
    result = await parse_description_ai(req.text)
    return result

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
    categorySuggestion: Annotated[str | None, Form()] = None,
    productTypeSuggestion: Annotated[str | None, Form()] = None,
    priceAmount: Annotated[str | None, Form()] = None,
    currency: Annotated[str | None, Form()] = None,
    colorRaw: Annotated[str | None, Form()] = None,
    colorGermanSuggestion: Annotated[str | None, Form()] = None,
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
        product_title=parsed.titleRaw,
        details={"source": source} if source else None,
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
        product_title=p.title_raw,
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
        product_title=p.title_raw,
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

        # Beden tamamen bitti → sold_sizes'a ekle / güncelle
        sold_qty_after = next((ss["qty"] for ss in new_size_stocks if ss["size"] == body.size), 0)
        if sold_qty_after == 0:
            sold_sizes_list = [s for s in (p.sold_sizes or []) if s["size"] != body.size]
            sold_sizes_list.append({
                "size": body.size,
                "soldAt": now.isoformat(),
                "note": (body.note or "").strip(),
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

    activity_logger.log(
        db, "sell",
        product_id=p.id,
        product_title=p.title_raw,
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
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.post("/api/products/{product_id}/restore-size", response_model=ProductRecord)
def restore_product_size(
    product_id: str,
    body: RestoreSizeRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    """Satılan belirli bir bedeni geri alır (iade)."""
    p = _get_or_404(db, product_id)
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

    activity_logger.log(
        db, "restore",
        product_id=p.id,
        product_title=p.title_raw,
        details={"size": size_name},
    )
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


@app.patch("/api/products/{product_id}/related", response_model=ProductRecord)
def update_related_products(
    product_id: str,
    body: UpdateRelatedRequest,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    """Renk varyantlarını çift yönlü günceller."""
    p = _get_or_404(db, product_id)

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

    record = _to_record(p)
    for aff in affected:
        aff_rec = _to_record(aff)
        background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": aff_rec.model_dump(mode="json")})
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
        product_title=p.title_raw,
        details={"count": len(new_images)},
    )
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
    return record



@app.post("/api/products/{product_id}/shopify-push", response_model=ProductRecord)
async def push_product_to_shopify(
    product_id: str,
    _: Annotated[None, Depends(verify_access)] = None,
    db: Session = Depends(get_db)
):
    p = _get_or_404(db, product_id)
    record = _to_record(p)
    
    try:
        res = await shopify.push_to_shopify(record.model_dump(), record.images)
        p.notes = (p.notes or "") + f"\n[Shopify] Product ID: {res.get('product', {}).get('id')}"
        db.commit()
        db.refresh(p)
        record = _to_record(p)
        await ws_manager.broadcast({"type": "product_updated", "product": record.model_dump(mode="json")})
        return record
    except Exception as e:
        raise HTTPException(status_code=500, detail={"code": "ERR_GENERAL", "message": str(e)})


@app.delete("/api/products/{product_id}")
def delete_product(
    product_id: str,
    background_tasks: BackgroundTasks,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    p = _get_or_404(db, product_id)
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
        
        # Eğer orijinal siliniyorsa, thumbnail'i de sil
        if kind == "originals":
            try:
                thumb_path = file_manager.resolve_image_path(p.folder_path, "thumbnails", file_name)
                thumb_path.unlink()
            except FileNotFoundError:
                pass
                
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail={"code": "ERR_IMAGE_NOT_FOUND"})
    p.images = [img for img in (p.images or []) if img.get("fileName") != file_name]
    activity_logger.log(db, "update", product_id=p.id, product_title=p.title_raw,
                        details={"changed": {"image_deleted": {"from": file_name, "to": ""}}})
    db.commit()
    db.refresh(p)
    record = _to_record(p)
    background_tasks.add_task(ws_manager.broadcast, {"type": "product_updated", "product": record.model_dump(mode="json")})
    return record


# ── Backup management ─────────────────────────────────────────────────────────


@app.get("/api/backups")
def get_backups(_: Annotated[None, Depends(verify_access)]):
    return backup_service.get_backup_overview()


@app.post("/api/backups/run")
def run_backup(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    return backup_service.run_manual_backup(db)


@app.delete("/api/backups/{date}")
def delete_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    return backup_service.delete_local_backup(date)


@app.delete("/api/backups/drive/{date}")
def delete_drive_backup(
    date: str,
    _: Annotated[None, Depends(verify_access)],
):
    return backup_service.delete_drive_backup(date)


# ── Activity logs ─────────────────────────────────────────────────────────────

@app.get("/api/logs")
def get_logs(
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
    limit: int = Query(default=50, le=200),
):
    return log_service.list_logs(db, limit)


@app.delete("/api/logs/{log_id}")
def delete_log(
    log_id: int,
    _: Annotated[None, Depends(verify_access)],
    db: Session = Depends(get_db),
):
    return log_service.delete_log(db, log_id)
