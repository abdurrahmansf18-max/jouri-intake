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
You are an AI assistant for a clothing store. The user will provide a raw product description (usually in Arabic or mixed languages) and optionally a product image.
Your job is to extract and translate the information into a JSON object matching the following schema.
Translate the title and description to English.

IMPORTANT for Description: Write a rich, appealing, and well-structured product description. It should not be too short nor too long. Describe the style, comfort, and occasions it fits. DO NOT just repeat the title. Use 2-3 sentences.
CRITICAL FOR SHOPIFY: You MUST weave standard clothing features into the description text so Shopify's AI can automatically extract them.
- Target Gender: Explicitly mention who it is for (e.g., "for boys", "for girls", "unisex").
- Age Group: Explicitly mention the age group based on sizes (e.g., "for babies", "for toddlers", "for kids", "for adults").
- Fabric/Material: Mention the fabric if stated (e.g., "soft cotton", "linen").
- Neckline & Sleeves: Mention the neckline and sleeve length ONLY IF they are explicitly stated in the text, OR clearly visible in the provided image.
- Features: Mention features like "elastic waistband" or "button closure" ONLY IF present.

STRICT RULE: DO NOT guess, assume, or hallucinate any features (like "short sleeves" or "long sleeves") if they are not explicitly mentioned in the input text OR clearly visible in the image. It is better to omit a feature than to guess wrongly.

Example: "Crafted from soft breathable cotton, this boys' pajama set is perfect for toddlers..."

SOURCE-GROUNDING RULES:
- Do not invent colors, product pieces, materials, themes, or category.
- If the text lists product pieces, preserve exactly those pieces translated to English. Do not add extra pieces.
- If category is not explicit, infer it only from clear words like boys/girls/women/men/baby or age sizes such as 1 Year, 2 Years, 6 Months.
- If information is missing, leave the field empty instead of guessing.
- The description may be appealing, but it must not claim a fabric/material/feature/sleeve-length that is not present in the input.

CRITICAL: Determine the 'season' based on the image and text. It MUST be exactly one of these three words (in English): "Summer", "Winter", or "Mid-season".
- Summer: For hot weather (e.g., short sleeves, shorts, thin fabric).
- Winter: For cold weather (e.g., jackets, thick coats, sweaters, fleece).
- Mid-season: For transitional weather (e.g., long-sleeve thin shirts, light trousers, spring/autumn wear).

IMPORTANT for Variants: If the user provides multiple colors (e.g. Beige size 2, Brown size 3), extract them into the `variants` array so we know exactly which sizes belong to which color. If sizes are not tied to colors, just list the same sizes for each color variant.
For color lines like "رمادي :3/2/1 Y" and "ابيض : 2 Y", return two variants: Gray with "3 Years, 2 Years, 1 Year" and White with "2 Years".
Size suffix rule: when Y or M is attached to a number, translate it fully as Years or Months. Examples: 9Y -> 9 Years, 1Y -> 1 Year, 6M -> 6 Months, 1M -> 1 Month. A standalone adult size like S, M, L must stay as S, M, L.

Return ONLY valid JSON. No markdown formatting like ```json.

JSON Schema:
{
    "titleRaw": "English Title",
    "categorySuggestion": "A suggested category like 'Boys', 'Girls', 'Baby', 'Women', etc.",
    "productTypeSuggestion": "e.g. 'Pajamas', 'Dress', 'T-Shirt', 'Jumpsuit', 'Romper', 'Bodysuit'",
    "priceAmount": "numeric string, e.g. 25",
    "currency": "EUR",
    "season": "Must be exactly 'Summer', 'Winter', or 'Mid-season'",
    "variants": [
        {
            "color": "Color in English (e.g. Beige)",
            "sizes": "Comma separated sizes (e.g. 2, 3, S)"
        }
    ],
    "description": "Rich and appealing translated English description."
}
"""

_REWRITE_SYSTEM_PROMPT = """
You are an AI assistant for a clothing store. Your job is to rewrite an existing product description to be rich, appealing, and well-structured in English.
It should not be too short nor too long. Describe the style, comfort, and occasions it fits. Use 2-3 sentences.
CRITICAL FOR SHOPIFY: You MUST weave standard clothing features into the description text so Shopify's AI can automatically extract them based on the context provided.
- Target Gender: Explicitly mention who it is for (e.g., "for boys", "for girls", "unisex").
- Age Group: Explicitly mention the age group based on sizes or context (e.g., "for babies", "for toddlers", "for kids", "for adults").
- Fabric/Material: Mention the fabric if stated or implied (e.g., "soft cotton", "linen").
- Neckline & Sleeves: Mention the neckline and sleeve length ONLY IF they are explicitly stated or can be strictly inferred from the provided details.
- Features: Mention features like "elastic waistband" or "button closure" ONLY IF present.

STRICT RULE: DO NOT guess, assume, or hallucinate any features (like "short sleeves" or "long sleeves") if they are not explicitly mentioned in the original description or context. It is better to omit a feature than to guess wrongly.

Return ONLY the rewritten description as plain text (no JSON, no markdown formatting). Do not include any prefix or suffix.
"""

async def rewrite_description_ai(title: str, description: str, context: str, image_base64: str = None) -> str:
    user_prompt = f"Product Title: {title}\nContext/Details: {context}\nOriginal Description: {description}"
    if image_base64:
        user_prompt += "\n\n(An image of the product is also provided. Use it to accurately determine features like sleeve length, neckline, pattern, etc. ONLY if they are clearly visible. DO NOT guess.)"

    if _gemini_client:
        try:
            return await _request_ai_text(_gemini_client, _gemini_model_name, user_prompt, image_base64)
        except Exception as e:
            print("Gemini rewrite failed:", _brief_error(e))

    if _ollama_client:
        try:
            return await _request_ai_text(_ollama_client, _ollama_model_name, user_prompt, image_base64)
        except Exception as e:
            print("Ollama rewrite failed:", _brief_error(e))

    return description

async def _request_ai_text(client: AsyncOpenAI, model_name: str, text: str, image_base64: str = None) -> str:
    user_content = text
    if image_base64:
        user_content = [
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_base64}"}}
        ]

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": _REWRITE_SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
            ]
        )
    except Exception as e:
        if "Unsupported value: 'system'" in str(e) or "response_format" not in str(e).lower():
            fallback_content = user_content
            if isinstance(fallback_content, list):
                fallback_content[0]["text"] = f"{_REWRITE_SYSTEM_PROMPT}\n\nTask:\n{text}"
            else:
                fallback_content = f"{_REWRITE_SYSTEM_PROMPT}\n\nTask:\n{text}"
            
            response = await client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "user", "content": fallback_content}
                ]
            )
        else:
            raise
    content = response.choices[0].message.content or ""
    return content.strip().strip('"').strip()

async def parse_description_ai(description: str, image_base64: str = None, image_mime_type: str = None) -> ParsedProduct:
    image_mime_type = _normalize_image_mime_type(image_mime_type)
    if _gemini_client:
        try:
            return await _parse_with_ai(
                _gemini_client,
                _gemini_model_name,
                description,
                provider="gemini",
                image_base64=image_base64,
                image_mime_type=image_mime_type,
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
                image_base64=image_base64,
                image_mime_type=image_mime_type,
            )
        except Exception as e:
            print("Gemma parsing failed:", _brief_error(e))

    return parse_description_structured(description)


async def _parse_with_ai(client: AsyncOpenAI, model_name: str, description: str, provider: str, image_base64: str = None, image_mime_type: str = None) -> dict:
    content = await _request_ai_content(client, model_name, description, image_base64, image_mime_type)
    data = json.loads(_strip_json_fence(content))
    return _merge_ai_data(description, data, provider)


async def _request_ai_content(client: AsyncOpenAI, model_name: str, description: str, image_base64: str = None, image_mime_type: str = None) -> str:
    user_content = description
    if image_base64:
        image_mime_type = _normalize_image_mime_type(image_mime_type)
        user_content = [
            {"type": "text", "text": description},
            {"type": "image_url", "image_url": {"url": f"data:{image_mime_type};base64,{image_base64}"}}
        ]

    try:
        response = await client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_content}
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
                {"role": "user", "content": user_content}
            ],
        )
    return (response.choices[0].message.content or "").strip()


def _merge_ai_data(description: str, data: dict, provider: str) -> dict:
    structured = parse_description_structured(description)
    structured_parsed = structured["parsed"]
    structured_variants = structured.get("variants", [])
    ai_variants = _normalize_variants(data.get("variants", []))
    variants = structured_variants or ai_variants

    color_raw = _field(data.get("colorRaw", ""))
    sizes_raw = _field(data.get("sizesRaw", ""))

    if structured_variants:
        color_raw = structured_parsed.get("colorRaw", "")
        sizes_raw = structured_parsed.get("sizesRaw", "")

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
    structured_title = structured_parsed.get("titleRaw", "")
    if _contains_arabic(description) and structured_title and not _contains_arabic(structured_title):
        title_raw = structured_title

    category = _field(data.get("categorySuggestion", ""))
    if _looks_like_kids_sizes(sizes_raw or structured_parsed.get("sizesRaw", "")) and category.lower() not in {"boys", "girls", "kids"}:
        category = ""
    if structured_parsed.get("categorySuggestion"):
        category = structured_parsed.get("categorySuggestion", "")
    if _has_baby_signal(description, sizes_raw or structured_parsed.get("sizesRaw", "")):
        category = "Baby"
    category = normalize_category(category)

    price_amount = structured_parsed.get("priceAmount", "") or _field(data.get("priceAmount", ""))
    product_type = normalize_product_type(
        structured_parsed.get("productTypeSuggestion", "") or _field(data.get("productTypeSuggestion", ""))
    )
    season = normalize_season(_field(data.get("season", ""))) or structured_parsed.get("season", "")

    return {
        "parsed": ParsedProduct(
            titleRaw=title_raw or structured_title,
            categorySuggestion=category or structured_parsed.get("categorySuggestion", ""),
            productTypeSuggestion=product_type,
            priceAmount=price_amount,
            currency=_field(data.get("currency", "")) or "EUR",
            colorRaw=color_raw,
            colorGermanSuggestion="",
            sizesRaw=sizes_raw,
            season=season,
            tags=[]
        ).model_dump(),
        "description": _safe_description(description, data.get("description", ""), structured.get("description", "")),
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
        season=_guess_season(description, ""),
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
    else:
        normalized_sizes = _normalize_sizes(parsed.sizesRaw)
        if normalized_sizes:
            parsed.sizesRaw = ", ".join(normalized_sizes)

    if parsed.colorRaw:
        parsed.colorRaw = _translate_color(parsed.colorRaw)

    price = _extract_price(description)
    if price and not parsed.priceAmount:
        parsed.priceAmount = price
        parsed.currency = "EUR"

    translated_title = _translate_title(_title_source(description, parsed.titleRaw))
    if translated_title:
        parsed.titleRaw = translated_title
    if not parsed.productTypeSuggestion:
        parsed.productTypeSuggestion = _guess_product_type(description)
    parsed.productTypeSuggestion = normalize_product_type(parsed.productTypeSuggestion)
    parsed.season = normalize_season(parsed.season) or _guess_season(description, parsed.productTypeSuggestion)
    if not parsed.categorySuggestion:
        parsed.categorySuggestion = _guess_category(parsed.sizesRaw, description)
    parsed.categorySuggestion = normalize_category(parsed.categorySuggestion)

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


def normalize_category(value: str) -> str:
    cleaned = _field(value)
    cleaned = re.sub(r"^[`'\"‘’“”]+|[`'\"‘’“”]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return ""

    key = _normalize_category_key(cleaned)
    categories = {
        "boy": "Boys",
        "boys": "Boys",
        "صبياني": "Boys",
        "صبيان": "Boys",
        "ولادي": "Boys",
        "اولاد": "Boys",
        "girl": "Girls",
        "girls": "Girls",
        "بناتي": "Girls",
        "بنات": "Girls",
        "kid": "Kids",
        "kids": "Kids",
        "child": "Kids",
        "children": "Kids",
        "اطفال": "Kids",
        "women": "Women",
        "woman": "Women",
        "ladies": "Women",
        "نسائي": "Women",
        "حريمي": "Women",
        "men": "Men",
        "man": "Men",
        "رجالي": "Men",
        "baby": "Baby",
        "babies": "Baby",
        "bebe": "Baby",
        "bebek": "Baby",
        "minibebe": "Baby",
        "minibebek": "Baby",
        "minibaby": "Baby",
        "infant": "Baby",
        "infants": "Baby",
        "newborn": "Baby",
        "newborns": "Baby",
        "بيبي": "Baby",
        "مواليد": "Baby",
        "رضيع": "Baby",
        "رضع": "Baby",
    }
    return categories.get(key, cleaned)


def normalize_product_type(value: str) -> str:
    cleaned = _field(value)
    cleaned = re.sub(r"^[`'\"‘’“”]+|[`'\"‘’“”]+$", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return ""

    key = _normalize_category_key(cleaned)
    product_types = {
        "pajama": "Pajamas",
        "pajamas": "Pajamas",
        "pyjama": "Pajamas",
        "pyjamas": "Pajamas",
        "بيجاما": "Pajamas",
        "بجامه": "Pajamas",
        "tshirt": "T-Shirt",
        "tshirts": "T-Shirt",
        "tee": "T-Shirt",
        "tees": "T-Shirt",
        "تيشيرت": "T-Shirt",
        "تيشرت": "T-Shirt",
        "tshirtset": "T-Shirt Set",
        "dress": "Dress",
        "dresses": "Dress",
        "فستان": "Dress",
        "فساطين": "Dress",
        "set": "Set",
        "طقم": "Set",
        "suit": "Suit",
        "بدلة": "Suit",
        "short": "Shorts",
        "shorts": "Shorts",
        "شورت": "Shorts",
        "pants": "Pants",
        "trousers": "Pants",
        "بنطلون": "Pants",
        "jeans": "Jeans",
        "جينز": "Jeans",
        "shirt": "Shirt",
        "shirts": "Shirt",
        "قميص": "Shirt",
        "blouse": "Blouse",
        "بلوزه": "Blouse",
        "jacket": "Jacket",
        "جاكيت": "Jacket",
        "coat": "Coat",
        "معطف": "Coat",
        "sweater": "Sweater",
        "كنزه": "Sweater",
        "hoodie": "Hoodie",
        "هودي": "Hoodie",
        "skirt": "Skirt",
        "تنوره": "Skirt",
        "romper": "Romper",
        "rompers": "Romper",
        "سالوبيت": "Romper",
        "سلوبت": "Romper",
        "سالوبت": "Romper",
        "bodysuit": "Bodysuit",
        "bodysuits": "Bodysuit",
        "body": "Bodysuit",
        "onesie": "Bodysuit",
        "onesies": "Bodysuit",
        "بربتوز": "Bodysuit",
        "بدي": "Bodysuit",
        "jumpsuit": "Jumpsuit",
        "jumpsuits": "Jumpsuit",
        "overall": "Jumpsuit",
        "overalls": "Jumpsuit",
        "dungaree": "Jumpsuit",
        "dungarees": "Jumpsuit",
        "tulum": "Jumpsuit",
        "salopet": "Jumpsuit",
        "افرول": "Jumpsuit",
        "افورول": "Jumpsuit",
        "اوفرول": "Jumpsuit",
    }
    return product_types.get(key, cleaned)


def normalize_season(value: str) -> str:
    cleaned = _field(value)
    if not cleaned:
        return ""
    cleaned = (
        cleaned.replace("ı", "i").replace("İ", "I")
        .replace("ş", "s").replace("Ş", "S")
        .replace("ğ", "g").replace("Ğ", "G")
        .replace("ü", "u").replace("Ü", "U")
        .replace("ö", "o").replace("Ö", "O")
        .replace("ç", "c").replace("Ç", "C")
    )
    key = _normalize_category_key(cleaned)
    seasons = {
        "summer": "Summer",
        "yaz": "Summer",
        "yazlik": "Summer",
        "صيفي": "Summer",
        "صيف": "Summer",
        "winter": "Winter",
        "kis": "Winter",
        "kislik": "Winter",
        "شتوي": "Winter",
        "شتاء": "Winter",
        "midseason": "Mid-season",
        "mevsimlik": "Mid-season",
        "springautumn": "Mid-season",
        "springfall": "Mid-season",
        "ربيعي": "Mid-season",
        "خريفي": "Mid-season",
        "محير": "Mid-season",
    }
    return seasons.get(key, cleaned if cleaned in {"Summer", "Winter", "Mid-season"} else "")


def _guess_season(description: str, product_type: str = "") -> str:
    text = description.lower()
    if re.search(r"(?:جاكيت|jacket|coat|معطف|سويتر|sweater|كنزة|كنزه|هودي|hoodie|fleece|polar|thick|winter|شتوي|kislik|kışlık)", description, re.IGNORECASE):
        return "Winter"
    if re.search(r"(?:شورت|shorts?|short sleeve|sleeveless|tank|summer|صيفي|قطني خفيف|thin fabric|linen|كتان)", description, re.IGNORECASE):
        return "Summer"
    if product_type in {"Jacket", "Coat", "Sweater", "Hoodie"}:
        return "Winter"
    if product_type == "Shorts":
        return "Summer"
    if product_type in {"Pajamas", "Set", "T-Shirt", "T-Shirt Set", "Shirt", "Blouse", "Pants"}:
        return "Mid-season"
    return ""


def _normalize_image_mime_type(value: str | None) -> str:
    cleaned = (value or "image/jpeg").strip().lower()
    if cleaned in {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}:
        return "image/jpeg" if cleaned == "image/jpg" else cleaned
    return "image/jpeg"


def _normalize_category_key(value: str) -> str:
    key = value.strip().lower()
    key = key.replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").replace("ٱ", "ا")
    key = key.replace("ى", "ي").replace("ئ", "ي").replace("ة", "ه")
    key = re.sub(r"[^a-z\u0600-\u06ff]+", "", key)
    return key


def _brief_error(error: Exception) -> str:
    text = str(error).replace("\n", " ")
    return text[:500]


def _contains_arabic(value: str) -> bool:
    return bool(re.search(r"[\u0600-\u06ff]", value))


def _looks_like_kids_sizes(value: str) -> bool:
    return bool(
        re.search(r"\b\d+\s*y\b", value, re.IGNORECASE)
        or re.search(r"\b\d+\s*(?:year|years|month|months)\b", value, re.IGNORECASE)
    )


def _extract_variants(description: str) -> list[dict[str, str]]:
    variants = []
    current_variant: dict[str, str] | None = None
    current_suffix = ""
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if ":" not in line:
            if current_variant and _looks_like_size_line(line):
                sizes = _normalize_sizes(line, default_suffix=current_suffix)
                _append_variant_sizes(current_variant, sizes)
                current_suffix = _detect_size_suffix(line) or current_suffix
            continue
        label, value = re.split(r"[:：]", line, maxsplit=1)
        label = _clean(label)
        value = _clean(value)
        if not label or not value:
            continue
        if re.search(r"(?:السعر|price|قياس|مقاس|beden|size)", label, re.IGNORECASE):
            continue
        sizes = _normalize_sizes(value, default_suffix=current_suffix)
        if not sizes:
            current_variant = None
            current_suffix = ""
            continue
        current_variant = {
            "color": _translate_color(label),
            "sizes": ", ".join(sizes),
        }
        variants.append(current_variant)
        current_suffix = _detect_size_suffix(value) or current_suffix
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


def _normalize_sizes(value: str, default_suffix: str = "") -> list[str]:
    if not value:
        return []
    compact = value.replace("،", ",").replace("／", "/")
    suffix = _detect_size_suffix(compact) or default_suffix.upper()
    tokens = re.split(r"[/,]+", compact)
    sizes = []
    for token in tokens:
        cleaned = re.sub(r"\s+", "", token.strip())
        cleaned = re.sub(r"[^0-9A-Za-z.+-]", "", cleaned)
        if not cleaned:
            continue
        range_with_suffix = re.fullmatch(r"(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)([YM])", cleaned, re.IGNORECASE)
        range_with_word_suffix = re.fullmatch(r"(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)(YEARS?|MONTHS?)", cleaned, re.IGNORECASE)
        range_without_suffix = re.fullmatch(r"(\d+(?:[.,]\d+)?)-(\d+(?:[.,]\d+)?)", cleaned)
        age_word_suffix = re.fullmatch(r"(\d+(?:[.,]\d+)?)(YEARS?|MONTHS?)", cleaned, re.IGNORECASE)
        if range_with_suffix:
            cleaned = _format_age_size_range(range_with_suffix.group(1), range_with_suffix.group(2), range_with_suffix.group(3).upper())
        elif range_with_word_suffix:
            unit = "Y" if range_with_word_suffix.group(3).upper().startswith("YEAR") else "M"
            cleaned = _format_age_size_range(range_with_word_suffix.group(1), range_with_word_suffix.group(2), unit)
        elif range_without_suffix and suffix in {"Y", "M"}:
            cleaned = _format_age_size_range(range_without_suffix.group(1), range_without_suffix.group(2), suffix)
        elif age_word_suffix:
            unit = "Y" if age_word_suffix.group(2).upper().startswith("YEAR") else "M"
            cleaned = _format_age_size(age_word_suffix.group(1), unit)
        elif suffix in {"Y", "M"} and re.fullmatch(r"\d+(?:[.,]\d+)?", cleaned):
            cleaned = _format_age_size(cleaned, suffix)
        elif suffix and re.fullmatch(r"\d+(?:[.,]\d+)?", cleaned):
            cleaned = f"{cleaned}{suffix}"
        else:
            cleaned = _expand_age_suffix(cleaned.upper())
        if cleaned not in sizes:
            sizes.append(cleaned)
    return sizes


def _looks_like_size_line(value: str) -> bool:
    compact = value.strip()
    if not compact:
        return False
    return bool(re.fullmatch(r"[0-9\s.,/+\\-]+(?:[A-Za-z]+)?", compact))


def _detect_size_suffix(value: str) -> str:
    suffix_match = re.search(r"\b([A-Za-z]+)\b\s*$", value)
    suffix = suffix_match.group(1).upper() if suffix_match else ""
    return suffix if suffix in {"Y", "M"} else ""


def _append_variant_sizes(variant: dict[str, str], sizes: list[str]) -> None:
    existing = [s.strip() for s in variant.get("sizes", "").split(",") if s.strip()]
    for size in sizes:
        if size and size not in existing:
            existing.append(size)
    variant["sizes"] = ", ".join(existing)


def _expand_age_suffix(value: str) -> str:
    match = re.fullmatch(r"(\d+(?:[.,]\d+)?)([YM])", value, re.IGNORECASE)
    if not match:
        return value
    return _format_age_size(match.group(1), match.group(2).upper())


def _format_age_size(number: str, suffix: str) -> str:
    cleaned_number = number.replace(",", ".")
    singular = cleaned_number in {"1", "1.0"}
    if suffix == "Y":
        unit = "Year" if singular else "Years"
    else:
        unit = "Month" if singular else "Months"
    display_number = cleaned_number[:-2] if cleaned_number.endswith(".0") else cleaned_number
    return f"{display_number} {unit}"


def _format_age_size_range(start: str, end: str, suffix: str) -> str:
    start_number = start.replace(",", ".")
    end_number = end.replace(",", ".")
    try:
        if float(start_number) > float(end_number):
            start_number, end_number = end_number, start_number
    except ValueError:
        pass
    start_display = start_number[:-2] if start_number.endswith(".0") else start_number
    end_display = end_number[:-2] if end_number.endswith(".0") else end_number
    unit = "Years" if suffix == "Y" else "Months"
    return f"{start_display}-{end_display} {unit}"


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
        "اوف وايت": "Off White",
        "أوف وايت": "Off White",
        "سكري": "Ivory",
        "حليبي": "Milk White",
        "عسلي": "Honey",
        "جملي": "Camel",
        "اسود": "Black",
        "أسود": "Black",
        "احمر": "Red",
        "أحمر": "Red",
        "خمري": "Burgundy",
        "عنابي": "Burgundy",
        "ازرق": "Blue",
        "أزرق": "Blue",
        "سماوي": "Sky Blue",
        "كحلي": "Navy",
        "تركواز": "Turquoise",
        "فيروزي": "Turquoise",
        "فيروزى": "Turquoise",
        "وردي": "Pink",
        "زهري": "Pink",
        "زهر": "Pink",
        "فوشي": "Fuchsia",
        "موف": "Mauve",
        "ليلكي": "Lilac",
        "بيج": "Beige",
        "بني": "Brown",
        "اخضر": "Green",
        "أخضر": "Green",
        "زيتي": "Olive",
        "نعناعي": "Mint",
        "اصفر": "Yellow",
        "أصفر": "Yellow",
        "بنفسجي": "Purple",
        "برتقالي": "Orange",
        "فضي": "Silver",
        "ذهبي": "Gold",
    }
    key = _normalize_color_key(value)
    return colors.get(key, value.strip())


def _normalize_color_key(value: str) -> str:
    key = " ".join(value.strip().split())
    key = re.sub(r"^(?:ال)", "", key)
    key = key.replace("إ", "ا").replace("أ", "ا").replace("آ", "ا").replace("ى", "ي")
    return key


def _translate_title(value: str) -> str:
    text = value.strip()
    if not text:
        return ""
    if not _contains_arabic(text):
        return text

    audience = _audience_prefix(text)
    style = "Parachute " if re.search(r"(?:باراشوت|براشوت|parachute)", text, re.IGNORECASE) else ""
    material = _material_phrase(text)
    has_pajama = "بيجاما" in text or "بجاما" in text
    has_short = "شورت" in text
    if has_pajama and has_short:
        return f"{audience}{style}{material}Short Pajama Set".strip()
    if has_pajama:
        return f"{audience}{style}{material}Pajama Set".strip()
    if re.search(r"(?:افرول|افورول|اوفرول|jumpsuit|dungaree|overalls?|tulum|salopet)", text, re.IGNORECASE):
        return f"{audience}{style}{material}Jumpsuit".strip()
    if re.search(r"(?:فستان|dress)", text, re.IGNORECASE):
        return f"{audience}{style}{material}Dress".strip()
    if re.search(r"(?:توينز|طقم|set)", text, re.IGNORECASE):
        pieces = _known_piece_words(text)
        if pieces:
            return f"{audience}{style}{material}{' and '.join(pieces)} Set".strip()
        return f"{audience}{style}{material}Set".strip()
    if has_short:
        return f"{audience}{style}Shorts".strip()
    pieces = _known_piece_words(text)
    if pieces:
        return f"{audience}{style}{material}{' and '.join(pieces)}".strip()
    return text


def _guess_product_type(description: str) -> str:
    text = description.lower()
    has_set = bool(re.search(r"(?:توينز|طقم|set)", description, re.IGNORECASE))
    has_tshirt = bool(re.search(r"(?:تيشيرت|تيشرت|تشيرت|t-?shirt)", description, re.IGNORECASE))
    has_pajama = "بيجاما" in description or "بجاما" in description or "pajama" in text or "pyjama" in text
    if re.search(r"(?:jumpsuit|dungaree|overalls?|tulum|salopet|افرول|افورول|اوفرول)", description, re.IGNORECASE):
        return "Jumpsuit"
    if re.search(r"(?:rompers?|سالوبيت|سلوبت|سالوبت)", description, re.IGNORECASE):
        return "Romper"
    if re.search(r"(?:bodysuits?|onesies?|بربتوز|بدي)", description, re.IGNORECASE):
        return "Bodysuit"
    if has_pajama:
        return "Pajamas"
    if has_tshirt and has_set:
        return "T-Shirt Set"
    if has_tshirt:
        return "T-Shirt"
    if re.search(r"(?:فستان|dress)", description, re.IGNORECASE):
        return "Dress"
    if has_set:
        return "Set"
    if re.search(r"(?:بلوزة|blouse|top)", description, re.IGNORECASE):
        return "Top"
    if re.search(r"(?:بنطلون|pants|trousers)", description, re.IGNORECASE):
        return "Pants"
    if re.search(r"(?:تنورة|skirt)", description, re.IGNORECASE):
        return "Skirt"
    if re.search(r"(?:جاكيت|jacket)", description, re.IGNORECASE):
        return "Jacket"
    if re.search(r"(?:هودي|hoodie)", description, re.IGNORECASE):
        return "Hoodie"
    if "شورت" in description or "short" in text:
        return "Shorts"
    return ""


def _guess_category(sizes_raw: str, description: str) -> str:
    if _has_baby_signal(description, sizes_raw):
        return "Baby"
    if re.search(r"(?:صبياني|صبيان|ولادي|اولاد|أولاد|للأولاد|boy|boys)", description, re.IGNORECASE):
        return "Boys"
    if re.search(r"(?:بناتي|بنات|للبنات|girl|girls)", description, re.IGNORECASE):
        return "Girls"
    if re.search(r"(?:نسائي|حريمي|women|woman|ladies)", description, re.IGNORECASE):
        return "Women"
    if re.search(r"(?:رجالي|men|man)", description, re.IGNORECASE):
        return "Men"
    if re.search(r"(?:بيبي|مواليد|رضيع|رضع|baby|babies|bebe|bebek|mini\\s*bebe|mini\\s*bebek|mini\\s*baby|infant|newborn)", description, re.IGNORECASE):
        return "Baby"
    if _looks_like_kids_sizes(sizes_raw) or _looks_like_kids_sizes(description):
        return "Kids"
    return ""


def _has_baby_signal(description: str, sizes_raw: str = "") -> bool:
    text = f"{description}\n{sizes_raw}"
    has_baby_word = re.search(
        r"(?:بيبي|مواليد|رضيع|رضع|baby|babies|bebe|bebek|infant|newborn|toddler|b\.?\s*b\.?)",
        text,
        re.IGNORECASE,
    )
    has_mini_baby = _is_mini_baby_text(text)
    has_month_sizes = re.search(r"\b\d+(?:[.,]\d+)?(?:\s*-\s*\d+(?:[.,]\d+)?)?\s*(?:m|month|months)\b", text, re.IGNORECASE)
    has_size_heading = re.search(r"(?:القياسات|المقاسات|beden|size)", text, re.IGNORECASE)
    return bool(has_mini_baby or has_baby_word or (has_month_sizes and has_size_heading))


def _audience_prefix(text: str) -> str:
    category = _guess_category("", text)
    if category == "Baby" and _is_mini_baby_text(text):
        return "Mini Baby "
    return f"{category} " if category and category != "Kids" else ""


def _is_mini_baby_text(text: str) -> bool:
    has_mini = re.search(r"(?:ميني|mini)", text, re.IGNORECASE)
    has_baby = re.search(r"(?:بيبي|baby|b\.?b\.?|bebe|bebek)", text, re.IGNORECASE)
    return bool(has_mini and has_baby)


def _known_piece_words(text: str) -> list[str]:
    pieces = []
    piece_patterns = [
        (r"(?:بلوزة|blouse|top)", "Top"),
        (r"(?:تيشيرت|تيشرت|تشيرت|t-?shirt)", "T-Shirt"),
        (r"(?:بنطلون|pants|trousers)", "Pants"),
        (r"(?:شورت|shorts?)", "Shorts"),
        (r"(?:تنورة|skirt)", "Skirt"),
        (r"(?:جاكيت|jacket)", "Jacket"),
        (r"(?:هودي|hoodie)", "Hoodie"),
    ]
    for pattern, label in piece_patterns:
        if re.search(pattern, text, re.IGNORECASE) and label not in pieces:
            pieces.append(label)
    return pieces


def _title_source(description: str, fallback: str) -> str:
    title_lines = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if re.search(r"(?:القياسات|المقاسات|beden|size|السعر|price|fiyat)", line, re.IGNORECASE):
            break
        if ":" in line or "：" in line:
            break
        title_lines.append(line)
        if len(title_lines) >= 3:
            break
    return " ".join(title_lines) or fallback


def _material_phrase(text: str) -> str:
    materials = []
    material_matches = [
        ("Cotton", re.search(r"(?:قطن|cotton)", text, re.IGNORECASE)),
        ("Linen", re.search(r"(?:كتان|linen)", text, re.IGNORECASE)),
    ]
    for label, match in sorted(
        ((label, match) for label, match in material_matches if match),
        key=lambda item: item[1].start(),
    ):
        materials.append(label)
    return f"{' and '.join(materials)} " if materials else ""


def _safe_description(source: str, ai_description, fallback: str) -> str:
    description = _field(ai_description)
    if not description:
        return fallback
    if _contains_unsupported_material_claim(source, description):
        return fallback
    return description


def _contains_unsupported_material_claim(source: str, description: str) -> bool:
    source_lower = source.lower()
    description_lower = description.lower()
    material_terms = [
        ("cotton", ["cotton", "قطن"]),
        ("linen", ["linen", "كتان"]),
        ("blend", ["blend", "mixed", "خليط", "ممزوج"]),
        ("wool", ["wool", "صوف"]),
        ("silk", ["silk", "حرير"]),
        ("denim", ["denim", "jeans", "جينز"]),
    ]
    for english_term, source_terms in material_terms:
        if english_term in description_lower and not any(term in source_lower for term in source_terms):
            return True
    return False


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
