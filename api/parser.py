import os
import re
import json
from dotenv import load_dotenv
from openai import AsyncOpenAI
from models import ParsedProduct

load_dotenv()

# We prefer Gemini first, then local Ollama/Gemma, then a deterministic parser.
# Ollama is expected to be reachable only from the backend/container network.

_gemini_client = None
_gemini_model_name = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
if os.getenv("GEMINI_API_KEY"):
    _gemini_client = AsyncOpenAI(
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
    )

_ollama_client = None
_ollama_model_name = os.getenv("OLLAMA_MODEL", "gemma3:4b-it-qat")
if os.getenv("OLLAMA_URL"):
    _ollama_client = AsyncOpenAI(
        api_key="ollama",
        base_url=os.getenv("OLLAMA_URL")
    )

_SYSTEM_PROMPT = """
You are an AI assistant for a clothing store. The user will provide a raw product description (usually in Arabic or mixed languages).
Your job is to extract and translate the information into a JSON object matching the following schema.
Translate the title and description to English.

IMPORTANT for Description: Write a rich, appealing, and well-structured product description. It should not be too short nor too long. Describe the style, comfort, and occasions it fits. DO NOT just repeat the title. Use 2-3 sentences.

IMPORTANT for Variants: If the user provides multiple colors (e.g. Beige size 2, Brown size 3), extract them into the `variants` array so we know exactly which sizes belong to which color. If sizes are not tied to colors, just list the same sizes for each color variant.
For color lines like "رمادي :3/2/1 Y" and "ابيض : 2 Y", return two variants: Gray with "3Y, 2Y, 1Y" and White with "2Y".

Return ONLY valid JSON. No markdown formatting like ```json.

JSON Schema:
{
    "titleRaw": "English Title",
    "categorySuggestion": "A suggested category like 'Boys', 'Girls', 'Women', etc.",
    "productTypeSuggestion": "e.g. 'Pajamas', 'Dress', 'T-Shirt'",
    "priceAmount": "numeric string, e.g. 25",
    "currency": "EUR",
    "variants": [
        {
            "color": "Color in English (e.g. Beige)",
            "sizes": "Comma separated sizes (e.g. 2, 3, S)"
        }
    ],
    "description": "Rich and appealing translated English description."
}
"""

async def parse_description_ai(description: str) -> ParsedProduct:
    if _gemini_client:
        try:
            return await _parse_with_ai(
                _gemini_client,
                _gemini_model_name,
                description,
                provider="gemini",
            )
        except Exception as e:
            print("Gemini parsing failed:", _brief_error(e))

    if _ollama_client:
        try:
            return await _parse_with_ai(
                _ollama_client,
                _ollama_model_name,
                description,
                provider="gemma",
            )
        except Exception as e:
            print("Gemma parsing failed:", _brief_error(e))

    return parse_description_structured(description)


async def _parse_with_ai(client: AsyncOpenAI, model_name: str, description: str, provider: str) -> dict:
    content = await _request_ai_content(client, model_name, description)
    data = json.loads(_strip_json_fence(content))
    return _merge_ai_data(description, data, provider)


async def _request_ai_content(client: AsyncOpenAI, model_name: str, description: str) -> str:
    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": description}
            ],
            response_format={ "type": "json_object" }
        )
    except Exception as e:
        if "response_format" not in str(e).lower():
            raise
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": description}
            ],
        )
    return (response.choices[0].message.content or "").strip()


def _merge_ai_data(description: str, data: dict, provider: str) -> dict:
    structured = parse_description_structured(description)
    structured_parsed = structured["parsed"]
    structured_variants = structured.get("variants", [])
    variants = _normalize_variants(data.get("variants", []))
    if not variants and structured_variants:
        variants = structured_variants

    color_raw = _field(data.get("colorRaw", ""))
    sizes_raw = _field(data.get("sizesRaw", ""))

    if not color_raw and variants:
        color_raw = ", ".join([v.get("color", "") for v in variants if v.get("color")])
    if not sizes_raw and variants:
        all_sizes = []
        for v in variants:
            for s in v.get("sizes", "").split(","):
                s = s.strip()
                if s and s not in all_sizes:
                    all_sizes.append(s)
        sizes_raw = ", ".join(all_sizes)

    title_raw = _field(data.get("titleRaw", ""))
    if _contains_arabic(title_raw):
        title_raw = ""

    category = _field(data.get("categorySuggestion", ""))
    if _looks_like_kids_sizes(sizes_raw or structured_parsed.get("sizesRaw", "")) and category.lower() not in {"boys", "girls", "kids"}:
        category = ""

    return {
        "parsed": ParsedProduct(
            titleRaw=title_raw or structured_parsed.get("titleRaw", ""),
            categorySuggestion=category or structured_parsed.get("categorySuggestion", ""),
            productTypeSuggestion=_field(data.get("productTypeSuggestion", "")) or structured_parsed.get("productTypeSuggestion", ""),
            priceAmount=_field(data.get("priceAmount", "")) or structured_parsed.get("priceAmount", ""),
            currency=_field(data.get("currency", "")) or "EUR",
            colorRaw=color_raw,
            colorGermanSuggestion="",
            sizesRaw=sizes_raw,
            tags=[]
        ).model_dump(),
        "description": _field(data.get("description", "")) or structured.get("description", ""),
        "variants": variants,
        "provider": provider,
    }


def parse_description(description: str) -> ParsedProduct:
    lines = [l.strip() for l in description.split("\n") if l.strip()]
    title_raw = lines[0] if lines else ""

    price_match = re.search(r"(\d+(?:[.,]\d{1,2})?)\s*(€|eur|euro)", description, re.IGNORECASE)
    color_match = re.search(
        r"(?:بلون(?:\s+واحد)?|اللون|لون|renk(?:ler)?|color)\s*[:：]?\s*([^\r\n]+)",
        description, re.IGNORECASE
    )
    sizes_match = re.search(
        r"(?:القياسات|المقاسات|beden(?:ler)?|olcu(?:ler)?|ölçü(?:ler)?|size(?:s)?)\s*[:：]?\s*([^\r\n]+)",
        description, re.IGNORECASE
    )

    color_raw = _clean(color_match.group(1)) if color_match else ""

    price_amount = ""
    currency = ""
    if price_match:
        price_amount = price_match.group(1).replace(",", ".")
        currency = "EUR"

    return ParsedProduct(
        titleRaw=title_raw,
        categorySuggestion="",
        productTypeSuggestion="",
        priceAmount=price_amount,
        currency=currency,
        colorRaw=color_raw,
        colorGermanSuggestion="",
        sizesRaw=_clean(sizes_match.group(1)) if sizes_match else "",
        tags=[],
    )


def _clean(value: str) -> str:
    return re.sub(r"^[:：\s]+", "", value).strip()


def parse_description_structured(description: str) -> dict:
    parsed = parse_description(description)
    variants = _extract_variants(description)

    if variants:
        parsed.colorRaw = ", ".join(v["color"] for v in variants if v.get("color"))
        parsed.sizesRaw = _unique_join(
            size
            for variant in variants
            for size in variant.get("sizes", "").split(",")
        )

    price = _extract_price(description)
    if price and not parsed.priceAmount:
        parsed.priceAmount = price
        parsed.currency = "EUR"

    translated_title = _translate_title(parsed.titleRaw)
    if translated_title:
        parsed.titleRaw = translated_title
    if not parsed.productTypeSuggestion:
        parsed.productTypeSuggestion = _guess_product_type(description)
    if not parsed.categorySuggestion:
        parsed.categorySuggestion = _guess_category(parsed.sizesRaw, description)

    return {
        "parsed": parsed.model_dump(),
        "description": _fallback_description(parsed),
        "variants": variants,
        "provider": "parser",
    }


def _strip_json_fence(content: str) -> str:
    cleaned = content.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    if cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    return cleaned.strip()


def _field(value) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _brief_error(error: Exception) -> str:
    text = str(error).replace("\n", " ")
    return text[:500]


def _contains_arabic(value: str) -> bool:
    return bool(re.search(r"[\u0600-\u06ff]", value))


def _looks_like_kids_sizes(value: str) -> bool:
    return bool(re.search(r"\b\d+\s*y\b", value, re.IGNORECASE))


def _extract_variants(description: str) -> list[dict[str, str]]:
    variants = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line or ":" not in line:
            continue
        label, value = re.split(r"[:：]", line, maxsplit=1)
        label = _clean(label)
        value = _clean(value)
        if not label or not value:
            continue
        if re.search(r"(?:السعر|price|قياس|مقاس|beden|size)", label, re.IGNORECASE):
            continue
        sizes = _normalize_sizes(value)
        if not sizes:
            continue
        variants.append({
            "color": _translate_color(label),
            "sizes": ", ".join(sizes),
        })
    return variants


def _normalize_variants(raw_variants) -> list[dict[str, str]]:
    normalized = []
    if not isinstance(raw_variants, list):
        return normalized
    for variant in raw_variants:
        if not isinstance(variant, dict):
            continue
        color = _translate_color(str(variant.get("color", "")).strip())
        sizes = _normalize_sizes(str(variant.get("sizes", "")).strip())
        if color or sizes:
            normalized.append({"color": color, "sizes": ", ".join(sizes)})
    return normalized


def _normalize_sizes(value: str) -> list[str]:
    if not value:
        return []
    compact = value.replace("،", ",").replace("／", "/")
    suffix_match = re.search(r"\b([A-Za-z]+)\b\s*$", compact)
    suffix = suffix_match.group(1).upper() if suffix_match else ""
    tokens = re.split(r"[/,]+", compact)
    sizes = []
    for token in tokens:
        cleaned = re.sub(r"\s+", "", token.strip())
        cleaned = re.sub(r"[^0-9A-Za-z.+-]", "", cleaned)
        if not cleaned:
            continue
        if suffix and re.fullmatch(r"\d+(?:[.,]\d+)?", cleaned):
            cleaned = f"{cleaned}{suffix}"
        else:
            cleaned = cleaned.upper()
        if cleaned not in sizes:
            sizes.append(cleaned)
    return sizes


def _extract_price(description: str) -> str:
    match = re.search(
        r"(?:السعر|price|fiyat)\s*[:：]?\s*(\d+(?:[.,]\d{1,2})?)",
        description,
        re.IGNORECASE,
    )
    if not match:
        match = re.search(r"(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur|euro)", description, re.IGNORECASE)
    return match.group(1).replace(",", ".") if match else ""


def _translate_color(value: str) -> str:
    colors = {
        "رمادي": "Gray",
        "رمادى": "Gray",
        "رصاصي": "Gray",
        "ابيض": "White",
        "أبيض": "White",
        "اسود": "Black",
        "أسود": "Black",
        "احمر": "Red",
        "أحمر": "Red",
        "ازرق": "Blue",
        "أزرق": "Blue",
        "كحلي": "Navy",
        "تركواز": "Turquoise",
        "فيروزي": "Turquoise",
        "فيروزى": "Turquoise",
        "وردي": "Pink",
        "زهري": "Pink",
        "بيج": "Beige",
        "بني": "Brown",
        "اخضر": "Green",
        "أخضر": "Green",
        "اصفر": "Yellow",
        "أصفر": "Yellow",
        "بنفسجي": "Purple",
        "برتقالي": "Orange",
    }
    return colors.get(value.strip(), value.strip())


def _translate_title(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    has_pajama = "بيجاما" in text or "بجاما" in text
    has_short = "شورت" in text
    if has_pajama and has_short:
        return "Short Pajama Set"
    if has_pajama:
        return "Pajama Set"
    if has_short:
        return "Shorts"
    return text


def _guess_product_type(description: str) -> str:
    text = description.lower()
    if "بيجاما" in description or "pajama" in text:
        return "Pajamas"
    if "شورت" in description or "short" in text:
        return "Shorts"
    return ""


def _guess_category(sizes_raw: str, description: str) -> str:
    if re.search(r"\b\d+\s*y\b", sizes_raw, re.IGNORECASE) or re.search(r"\b\d+\s*y\b", description, re.IGNORECASE):
        return "Kids"
    return ""


def _fallback_description(parsed: ParsedProduct) -> str:
    title = parsed.titleRaw or "Product"
    title_lower = title.lower()
    audience = "children" if parsed.categorySuggestion == "Kids" else "everyday wear"
    product_type = (parsed.productTypeSuggestion or title).lower()

    if "pajama" in product_type:
        return (
            f"Drift into easy comfort with this {title_lower}, made for relaxed nights, cozy mornings, and everyday lounging. "
            f"The soft, practical design gives {audience} room to move freely while keeping the look neat and playful. "
            "A dependable choice for bedtime, homewear, or sleepovers, it balances comfort, style, and simple daily wearability."
        )

    return (
        f"{title} brings together a comfortable everyday fit with a clean, easy-to-style look. "
        "Designed for regular wear, it feels practical without losing the polished feel customers expect. "
        "A versatile piece for casual outfits, daily use, and simple wardrobe matching."
    )


def _unique_join(values) -> str:
    result = []
    for value in values:
        item = str(value).strip()
        if item and item not in result:
            result.append(item)
    return ", ".join(result)
