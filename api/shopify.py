import os
import aiohttp
from dotenv import load_dotenv

load_dotenv()

async def push_to_shopify(product_data: dict, images: list):
    shop_url = os.getenv("SHOPIFY_STORE_URL")
    access_token = os.getenv("SHOPIFY_ACCESS_TOKEN")
    
    if not shop_url or not access_token:
        raise Exception("Shopify API credentials missing in .env")
        
    url = f"https://{shop_url}/admin/api/2024-01/products.json"
    headers = {
        "X-Shopify-Access-Token": access_token,
        "Content-Type": "application/json"
    }
    
    # Very basic Shopify Payload Construction
    # A real integration would map variants properly
    variants = []
    for s in product_data.get("sizeStocks", []):
        variants.append({
            "option1": s.get("size"),
            "price": product_data.get("parsed", {}).get("priceAmount", "0"),
            "inventory_quantity": s.get("qty", 1),
            "inventory_management": "shopify"
        })
        
    payload = {
        "product": {
            "title": product_data.get("parsed", {}).get("titleRaw", "Draft Product"),
            "body_html": product_data.get("description", ""),
            "vendor": product_data.get("parsed", {}).get("categorySuggestion", ""),
            "product_type": product_data.get("parsed", {}).get("productTypeSuggestion", ""),
            "status": "draft",
            "options": [{"name": "Size"}],
            "variants": variants
        }
    }
    
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json=payload) as response:
            if response.status not in [200, 201]:
                err = await response.text()
                raise Exception(f"Shopify Error: {err}")
            data = await response.json()
            return data
