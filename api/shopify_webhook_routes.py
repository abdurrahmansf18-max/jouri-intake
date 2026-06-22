import base64
import hashlib
import hmac
import json
import os
from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, Request

from database import SessionLocal
import shopify_order_sync


router = APIRouter()


@router.post("/api/shopify/webhooks/orders-paid")
async def shopify_orders_paid_webhook(
    request: Request,
    x_shopify_hmac_sha256: Annotated[str | None, Header(alias="X-Shopify-Hmac-Sha256")] = None,
    x_shopify_topic: Annotated[str | None, Header(alias="X-Shopify-Topic")] = None,
):
    return await _handle_order_webhook(request, x_shopify_hmac_sha256, x_shopify_topic or "orders/paid")


@router.post("/api/shopify/webhooks/orders-create")
async def shopify_orders_create_webhook(
    request: Request,
    x_shopify_hmac_sha256: Annotated[str | None, Header(alias="X-Shopify-Hmac-Sha256")] = None,
    x_shopify_topic: Annotated[str | None, Header(alias="X-Shopify-Topic")] = None,
):
    return await _handle_order_webhook(request, x_shopify_hmac_sha256, x_shopify_topic or "orders/create")


async def _handle_order_webhook(request: Request, signature: str | None, topic: str):
    body = await request.body()
    _verify_hmac(body, signature)
    try:
        order = json.loads(body.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail={"code": "ERR_SHOPIFY_WEBHOOK_INVALID_JSON"})

    db = SessionLocal()
    try:
        result = shopify_order_sync.process_shopify_order(db, order, topic)
        updated = shopify_order_sync.products_from_ids(db, result.get("updatedProductIds") or [])
        await shopify_order_sync.broadcast_products(updated)
        return {"ok": True, **result}
    except Exception as exc:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail={"code": "ERR_SHOPIFY_ORDER_SYNC_FAILED", "message": str(exc)[:240]},
        )
    finally:
        db.close()


def _verify_hmac(body: bytes, signature: str | None) -> None:
    secret = (os.getenv("SHOPIFY_WEBHOOK_SECRET") or "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail={"code": "ERR_SHOPIFY_WEBHOOK_SECRET_MISSING"})
    if not signature:
        raise HTTPException(status_code=401, detail={"code": "ERR_SHOPIFY_WEBHOOK_SIGNATURE_MISSING"})

    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    if not hmac.compare_digest(expected, signature.strip()):
        raise HTTPException(status_code=401, detail={"code": "ERR_SHOPIFY_WEBHOOK_SIGNATURE_INVALID"})
