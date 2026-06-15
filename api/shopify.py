import base64
import html
import os
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import aiohttp
from dotenv import load_dotenv

import file_manager
from db_models import Product


try:
    load_dotenv()
except Exception:
    pass


class ShopifyConfigError(Exception):
    pass


class ShopifyPushError(Exception):
    pass


@dataclass(frozen=True)
class ShopifyCredentials:
    shop_url: str
    access_token: str
    api_version: str


@dataclass(frozen=True)
class ShopifyConfig:
    shop_url: str
    api_version: str
    access_token: str
    client_id: str
    client_secret: str


_TOKEN_CACHE: dict[str, dict[str, Any]] = {}


async def push_to_shopify(product: Product) -> dict[str, Any]:
    config = _config()
    timeout = aiohttp.ClientTimeout(total=600)

    async with aiohttp.ClientSession(timeout=timeout) as session:
        credentials = await _credentials(session, config)
        existing_id = _stored_product_id(product)
        existing_product = None
        created = False

        if existing_id:
            existing_product = await _request(
                session, credentials, "GET", f"products/{existing_id}.json", allow_404=True
            )

        if existing_id and existing_product:
            product_id = str(existing_product["product"]["id"])
            await _request(
                session,
                credentials,
                "PUT",
                f"products/{product_id}.json",
                {"product": _product_payload(product, include_create_only=False)},
            )
            variants_result = await _sync_variants(session, credentials, product_id, existing_product["product"], product)
        else:
            create_payload = _product_payload(product, include_create_only=True)
            create_payload["variants"] = _local_variants(product)
            create_payload["options"] = [{"name": "Size"}]
            create_payload["status"] = "draft"

            created_response = await _request(
                session,
                credentials,
                "POST",
                "products.json",
                {"product": create_payload},
            )
            created = True
            product_id = str(created_response["product"]["id"])
            variants_result = {"created": len(create_payload["variants"]), "updated": 0, "disabled": 0}

        refreshed = await _request(session, credentials, "GET", f"products/{product_id}.json")
        category_result = await _sync_standard_category(session, credentials, product_id, product)
        image_result = await _upload_missing_images(session, credentials, product_id, refreshed["product"], product)
        final_product = await _request(session, credentials, "GET", f"products/{product_id}.json")

        return {
            "product": final_product["product"],
            "created": created,
            "variants": variants_result,
            "category": category_result,
            "images": image_result,
        }


def _config() -> ShopifyConfig:
    shop_url = (os.getenv("SHOPIFY_STORE_URL") or "").strip()
    raw_access_token = (os.getenv("SHOPIFY_ACCESS_TOKEN") or "").strip()
    client_id = (os.getenv("SHOPIFY_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("SHOPIFY_CLIENT_SECRET") or "").strip()
    api_version = (os.getenv("SHOPIFY_API_VERSION") or "2026-04").strip()

    shop_url = re.sub(r"^https?://", "", shop_url).strip("/")
    access_token = raw_access_token

    # A Dev Dashboard client secret commonly starts with shpss_. If it was put
    # into SHOPIFY_ACCESS_TOKEN by mistake, use it as the client secret instead.
    if raw_access_token.startswith("shpss_"):
        access_token = ""
        client_secret = client_secret or raw_access_token

    has_static_token = bool(access_token)
    has_client_credentials = bool(client_id and client_secret)
    if not shop_url or not (has_static_token or has_client_credentials):
        raise ShopifyConfigError(
            "Shopify bilgileri eksik. SHOPIFY_STORE_URL ile birlikte SHOPIFY_CLIENT_ID + "
            "SHOPIFY_CLIENT_SECRET veya eski SHOPIFY_ACCESS_TOKEN ayarlanmalı."
        )
    return ShopifyConfig(
        shop_url=shop_url,
        api_version=api_version,
        access_token=access_token,
        client_id=client_id,
        client_secret=client_secret,
    )


async def _credentials(session: aiohttp.ClientSession, config: ShopifyConfig) -> ShopifyCredentials:
    access_token = config.access_token or await _client_credentials_token(session, config)
    return ShopifyCredentials(shop_url=config.shop_url, access_token=access_token, api_version=config.api_version)


async def _client_credentials_token(session: aiohttp.ClientSession, config: ShopifyConfig) -> str:
    cache_key = f"{config.shop_url}:{config.client_id}"
    cached = _TOKEN_CACHE.get(cache_key)
    now = time.time()
    if cached and cached.get("expires_at", 0) > now:
        return str(cached["access_token"])

    url = f"https://{config.shop_url}/admin/oauth/access_token"
    payload = {
        "grant_type": "client_credentials",
        "client_id": config.client_id,
        "client_secret": config.client_secret,
    }
    async with session.post(url, data=payload, headers={"Content-Type": "application/x-www-form-urlencoded"}) as response:
        text = await response.text()
        if response.status != 200:
            raise ShopifyConfigError(_summarize_token_error(response.status, text))
        data = await response.json()

    access_token = str(data.get("access_token") or "").strip()
    if not access_token:
        raise ShopifyConfigError("Shopify access token alınamadı. Client ID ve secret kontrol edilmeli.")

    try:
        expires_in = max(300, int(data.get("expires_in", 86400)))
    except Exception:
        expires_in = 86400
    _TOKEN_CACHE[cache_key] = {
        "access_token": access_token,
        "expires_at": now + max(60, expires_in - 300),
    }
    return access_token


async def _request(
    session: aiohttp.ClientSession,
    credentials: ShopifyCredentials,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    allow_404: bool = False,
) -> dict[str, Any] | None:
    url = f"https://{credentials.shop_url}/admin/api/{credentials.api_version}/{path}"
    headers = {
        "X-Shopify-Access-Token": credentials.access_token,
        "Content-Type": "application/json",
    }
    async with session.request(method, url, headers=headers, json=payload) as response:
        text = await response.text()
        if allow_404 and response.status == 404:
            return None
        if response.status not in {200, 201}:
            raise ShopifyPushError(_summarize_shopify_error(response.status, text))
        if not text.strip():
            return {}
        return await response.json()


async def _graphql_request(
    session: aiohttp.ClientSession,
    credentials: ShopifyCredentials,
    query: str,
    variables: dict[str, Any],
) -> dict[str, Any]:
    url = f"https://{credentials.shop_url}/admin/api/{credentials.api_version}/graphql.json"
    headers = {
        "X-Shopify-Access-Token": credentials.access_token,
        "Content-Type": "application/json",
    }
    async with session.post(url, headers=headers, json={"query": query, "variables": variables}) as response:
        text = await response.text()
        if response.status not in {200, 201}:
            raise ShopifyPushError(_summarize_shopify_error(response.status, text))
        data = await response.json()

    if data.get("errors"):
        raise ShopifyPushError(_summarize_graphql_errors(data.get("errors")))
    return data


def _product_payload(product: Product, *, include_create_only: bool) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "title": product.title_raw or "Binbon Kids Product",
        "body_html": _description_html(product.description),
        "vendor": (os.getenv("SHOPIFY_VENDOR") or "Binbon Kids").strip() or "Binbon Kids",
        "product_type": product.product_type or "",
        "tags": _tags(product),
    }
    if include_create_only:
        payload["handle"] = _handle(product)
    return payload


async def _sync_standard_category(
    session: aiohttp.ClientSession,
    credentials: ShopifyCredentials,
    shopify_product_id: str,
    product: Product,
) -> dict[str, Any]:
    category_id = _standard_category_id(product)
    if not category_id:
        return {"set": False, "reason": "no_mapping"}

    mutation = """
    mutation ProductCategoryUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          category {
            id
            fullName
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    data = await _graphql_request(
        session,
        credentials,
        mutation,
        {
            "product": {
                "id": _shopify_product_gid(shopify_product_id),
                "category": category_id,
            }
        },
    )
    payload = (data.get("data") or {}).get("productUpdate") or {}
    errors = payload.get("userErrors") or []
    if errors:
        message = "; ".join(
            f"{'.'.join(map(str, err.get('field') or []))}: {err.get('message')}"
            for err in errors
        )
        raise ShopifyPushError(f"Shopify standart kategori kabul edilmedi: {message[:240]}")

    category = ((payload.get("product") or {}).get("category") or {})
    return {
        "set": True,
        "id": category.get("id") or category_id,
        "fullName": category.get("fullName") or "",
    }


def _standard_category_id(product: Product) -> str:
    override = _category_override(product)
    if override:
        return override

    product_type = _category_key(product.product_type)
    text = _category_key(" ".join([
        product.title_raw or "",
        product.product_type or "",
        product.category or "",
        product.description or "",
    ]))
    child = _is_child_product(product)

    if "pajama" in product_type or "pyjama" in product_type or "pajama" in text or "pyjama" in text:
        return "gid://shopify/TaxonomyCategory/aa-1-17-4"
    if "tshirt" in product_type or "tee" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-9-7" if child else "gid://shopify/TaxonomyCategory/aa-1-13-8"
    if "shirt" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-9-6" if child else "gid://shopify/TaxonomyCategory/aa-1-13"
    if "dress" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-3" if child else "gid://shopify/TaxonomyCategory/aa-1-4"
    if "bodysuit" in product_type or "onesie" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-9-2" if child else "gid://shopify/TaxonomyCategory/aa-1-13-2"
    if "jumpsuit" in product_type or "romper" in product_type or "overall" in product_type:
        if "set" in text or child:
            return "gid://shopify/TaxonomyCategory/aa-1-25-5"
        return "gid://shopify/TaxonomyCategory/aa-1-9"
    if "set" in product_type or "outfit" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-5" if child else "gid://shopify/TaxonomyCategory/aa-1-11"
    if "jeans" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-1-4" if child else "gid://shopify/TaxonomyCategory/aa-1-12"
    if "pants" in product_type or "trouser" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-1-14" if child else "gid://shopify/TaxonomyCategory/aa-1-12"
    if "short" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-1" if child else "gid://shopify/TaxonomyCategory/aa-1-14"
    if "skirt" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-1-11" if child else "gid://shopify/TaxonomyCategory/aa-1-15"
    if "jacket" in product_type or "coat" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-4-17" if child else "gid://shopify/TaxonomyCategory/aa-1-10"
    if "sweater" in product_type or "hoodie" in product_type or "sweatshirt" in product_type:
        return "gid://shopify/TaxonomyCategory/aa-1-25-9-12" if child else "gid://shopify/TaxonomyCategory/aa-1-13-12"
    if child:
        return "gid://shopify/TaxonomyCategory/aa-1-25"
    return ""


def _category_override(product: Product) -> str:
    raw = (os.getenv("SHOPIFY_CATEGORY_MAP") or "").strip()
    if not raw:
        return ""
    keys = {
        _category_key(product.product_type),
        _category_key(product.title_raw),
        _category_key(product.category),
    }
    for part in re.split(r"[;\n]+", raw):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if _category_key(key) in keys:
            mapped = value.strip()
            if mapped.startswith("gid://shopify/TaxonomyCategory/"):
                return mapped
    return ""


def _is_child_product(product: Product) -> bool:
    text = _category_key(" ".join([
        product.category or "",
        product.title_raw or "",
        product.sizes_raw or "",
        product.description or "",
    ]))
    return bool(re.search(r"(baby|boys|girls|kids|children|child|infant|toddler|bebek|bebe|بيبي|رضيع|اطفال|بناتي|ولادي)", text))


def _category_key(value: str | None) -> str:
    raw = (value or "").strip().lower()
    raw = raw.replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").replace("ٱ", "ا")
    raw = raw.replace("ى", "ي").replace("ئ", "ي").replace("ة", "ه")
    return re.sub(r"[^a-z0-9\u0600-\u06ff]+", "", raw)


def _shopify_product_gid(shopify_product_id: str) -> str:
    return f"gid://shopify/Product/{shopify_product_id}"


def _local_variants(product: Product) -> list[dict[str, Any]]:
    price = _price(product.price_amount)
    stocks = list(product.size_stocks or [])
    if not stocks:
        sizes = [s.strip() for s in (product.sizes_raw or "").split(",") if s.strip()]
        qty = max(0, int(product.stock_quantity or 0))
        stocks = [{"size": s, "qty": qty} for s in sizes] or [{"size": "One Size", "qty": qty}]

    variants = []
    seen: set[str] = set()
    for stock in stocks:
        size = str(stock.get("size") or "One Size").strip() or "One Size"
        if size in seen:
            continue
        seen.add(size)
        try:
            qty = max(0, int(stock.get("qty", 0)))
        except Exception:
            qty = 0
        variants.append({
            "option1": size,
            "price": price,
            "inventory_management": "shopify",
            "inventory_policy": "deny",
            "inventory_quantity": qty,
            "sku": _sku(product, size),
        })
    return variants or [{
        "option1": "One Size",
        "price": price,
        "inventory_management": "shopify",
        "inventory_policy": "deny",
        "inventory_quantity": max(0, int(product.stock_quantity or 0)),
        "sku": _sku(product, "One Size"),
    }]


async def _sync_variants(
    session: aiohttp.ClientSession,
    credentials: ShopifyCredentials,
    shopify_product_id: str,
    shopify_product: dict[str, Any],
    product: Product,
) -> dict[str, int]:
    existing = shopify_product.get("variants") or []
    existing_by_size = {str(v.get("option1") or "").strip(): v for v in existing}
    local_variants = _local_variants(product)
    local_sizes = {v["option1"] for v in local_variants}
    updated = created = disabled = 0

    for variant in local_variants:
        current = existing_by_size.get(variant["option1"])
        if current:
            payload = {"variant": {"id": current["id"], **variant}}
            await _request(session, credentials, "PUT", f"variants/{current['id']}.json", payload)
            updated += 1
        else:
            await _request(session, credentials, "POST", f"products/{shopify_product_id}/variants.json", {"variant": variant})
            created += 1

    for current in existing:
        option = str(current.get("option1") or "").strip()
        if option and option not in local_sizes and option != "Default Title":
            payload = {
                "variant": {
                    "id": current["id"],
                    "inventory_quantity": 0,
                    "inventory_management": "shopify",
                    "inventory_policy": "deny",
                }
            }
            await _request(session, credentials, "PUT", f"variants/{current['id']}.json", payload)
            disabled += 1

    return {"created": created, "updated": updated, "disabled": disabled}


async def _upload_missing_images(
    session: aiohttp.ClientSession,
    credentials: ShopifyCredentials,
    shopify_product_id: str,
    shopify_product: dict[str, Any],
    product: Product,
) -> dict[str, int]:
    existing_alts = {str(img.get("alt") or "") for img in shopify_product.get("images") or []}
    limit = _image_limit()
    uploaded = skipped = 0

    shopify_images = [
        image for image in list(product.images or [])
        if str(image.get("folder") or "originals") == "enhanced"
    ][:limit]

    for image in shopify_images:
        file_name = str(image.get("fileName") or "")
        folder = str(image.get("folder") or "enhanced")
        if not file_name:
            skipped += 1
            continue
        alt = _image_alt(product, folder, file_name)
        if alt in existing_alts:
            skipped += 1
            continue
        try:
            path = file_manager.resolve_image_path(product.folder_path, folder, file_name)
            attachment = base64.b64encode(Path(path).read_bytes()).decode("ascii")
        except Exception:
            skipped += 1
            continue

        await _request(
            session,
            credentials,
            "POST",
            f"products/{shopify_product_id}/images.json",
            {"image": {"attachment": attachment, "filename": file_name, "alt": alt}},
        )
        existing_alts.add(alt)
        uploaded += 1

    return {"uploaded": uploaded, "skipped": skipped}


def _stored_product_id(product: Product) -> str | None:
    raw = (product.shopify_product_id or "").strip()
    if not raw and product.notes:
        match = re.search(r"\[Shopify\]\s*Product ID:\s*(\d+)", product.notes)
        raw = match.group(1) if match else ""
    match = re.search(r"(\d+)$", raw)
    return match.group(1) if match else None


def _description_html(description: str) -> str:
    paragraphs = [p.strip() for p in (description or "").splitlines() if p.strip()]
    if not paragraphs:
        return ""
    return "\n".join(f"<p>{html.escape(p)}</p>" for p in paragraphs)


def _tags(product: Product) -> str:
    raw = [
        "Binbon Kids",
        f"binbonkids-id:{product.id}",
        product.category,
        product.product_type,
        product.color_raw,
        f"Season: {product.season}" if product.season else None,
        *(product.tags or []),
    ]
    seen: set[str] = set()
    tags = []
    for tag in raw:
        value = str(tag or "").strip()
        if not value or value.lower() in seen:
            continue
        seen.add(value.lower())
        tags.append(value)
    return ", ".join(tags)


def _price(amount: str) -> str:
    raw = (amount or "").strip()
    cleaned = re.sub(r"[^\d,.-]", "", raw).replace(",", ".")
    match = re.search(r"-?\d+(?:\.\d+)?", cleaned)
    if not match:
        return "0.00"
    value = max(0.0, float(match.group(0)))
    return f"{value:.2f}"


def _handle(product: Product) -> str:
    title = product.title_raw or product.folder_name or product.id
    slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")
    suffix = re.sub(r"[^a-z0-9]+", "", product.id.lower())[-8:]
    return f"{slug[:50] or 'binbonkids-product'}-{suffix}"


def _sku(product: Product, size: str) -> str:
    base = re.sub(r"[^A-Za-z0-9]+", "-", product.id).strip("-").upper()[-18:]
    size_part = re.sub(r"[^A-Za-z0-9]+", "-", size).strip("-").upper()[:10] or "ONE"
    return f"BINBONKIDS-{base}-{size_part}"


def _image_alt(product: Product, folder: str, file_name: str) -> str:
    return f"Binbon Kids:{product.id}:{folder}:{file_name}"


def _image_limit() -> int:
    try:
        return max(1, int(os.getenv("SHOPIFY_IMAGE_LIMIT", "12")))
    except Exception:
        return 12


def _summarize_shopify_error(status: int, text: str) -> str:
    compact = " ".join((text or "").split())
    if status in {401, 403}:
        return "Shopify yetkisi reddedildi. Client ID/secret veya ürün yazma izinlerini kontrol et."
    if status == 404:
        return "Shopify ürünü bulunamadı; yeniden oluşturma gerekebilir."
    if status == 422:
        return f"Shopify ürün verisini kabul etmedi: {compact[:240]}"
    if status == 429:
        return "Shopify API hız limiti aşıldı. Biraz bekleyip tekrar dene."
    return f"Shopify hata verdi ({status}): {compact[:240]}"


def _summarize_graphql_errors(errors: Any) -> str:
    if not isinstance(errors, list):
        return "Shopify GraphQL hata verdi."
    parts = []
    for err in errors:
        if isinstance(err, dict):
            parts.append(str(err.get("message") or err))
        else:
            parts.append(str(err))
    return f"Shopify GraphQL hata verdi: {'; '.join(parts)[:240]}"


def _summarize_token_error(status: int, text: str) -> str:
    compact = " ".join((text or "").split())
    if status in {400, 401, 403}:
        return (
            "Shopify token alınamadı. SHOPIFY_STORE_URL, SHOPIFY_CLIENT_ID, "
            "SHOPIFY_CLIENT_SECRET ve uygulama kurulum/izinlerini kontrol et."
        )
    return f"Shopify token endpoint hata verdi ({status}): {compact[:240]}"
