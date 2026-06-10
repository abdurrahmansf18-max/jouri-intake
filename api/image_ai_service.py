import base64
import os
import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from openai import AsyncOpenAI

from models import AiImageGenerateRequest


OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1.5")
OPENAI_IMAGE_SIZE = os.environ.get("OPENAI_IMAGE_SIZE", "1024x1024")
OPENAI_IMAGE_QUALITY = os.environ.get("OPENAI_IMAGE_QUALITY", "medium")


@dataclass(frozen=True)
class GeneratedAiImage:
    file_name: str
    content: bytes
    mime_type: str = "image/jpeg"


def is_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY", "").strip())


async def generate_product_images(
    source_path: Path,
    product: Any,
    request: AiImageGenerateRequest,
) -> list[GeneratedAiImage]:
    if not is_configured():
        raise HTTPException(status_code=503, detail={"code": "ERR_AI_IMAGE_NOT_CONFIGURED"})

    client = AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"])
    prompts = [
        ("ai-model-worn.jpg", _worn_prompt(product, request)),
        ("ai-studio-hanger.jpg", _studio_prompt(product, request)),
        ("ai-original-clean.jpg", _clean_original_prompt(product, request)),
    ]

    generated: list[GeneratedAiImage] = []
    for file_name, prompt in prompts:
        try:
            with source_path.open("rb") as image_file:
                response = await client.images.edit(
                    model=OPENAI_IMAGE_MODEL,
                    image=image_file,
                    prompt=prompt,
                    n=1,
                    size=OPENAI_IMAGE_SIZE,
                    quality=OPENAI_IMAGE_QUALITY,
                    output_format="jpeg",
                    input_fidelity="high",
                )
        except HTTPException:
            raise
        except Exception as exc:
            print("[image_ai] OpenAI image generation failed:", _brief_error(exc))
            raise HTTPException(status_code=502, detail={"code": "ERR_AI_IMAGE_FAILED"})

        if not response.data:
            raise HTTPException(status_code=502, detail={"code": "ERR_AI_IMAGE_FAILED"})
        content = _image_content(response.data[0])
        if not content:
            raise HTTPException(status_code=502, detail={"code": "ERR_AI_IMAGE_FAILED"})
        generated.append(GeneratedAiImage(file_name=file_name, content=content))

    return generated


def _image_content(item: Any) -> bytes:
    b64_json = getattr(item, "b64_json", None)
    if b64_json:
        return base64.b64decode(b64_json)

    url = getattr(item, "url", None)
    if not url:
        return b""

    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def _product_context(product: Any, request: AiImageGenerateRequest) -> str:
    size_text = _size_context(product, request)
    audience_text = request.gender.strip() or _infer_audience(product)
    age_text = request.age.strip() or _infer_age_from_sizes(size_text)
    return "\n".join(
        part for part in [
            f"Product title: {_value(product, 'title_raw')}" if _value(product, "title_raw") else "",
            f"Category/audience: {_value(product, 'category')}" if _value(product, "category") else "",
            f"Product type: {_value(product, 'product_type')}" if _value(product, "product_type") else "",
            f"Color: {_value(product, 'color_raw')}" if _value(product, "color_raw") else "",
            f"Age/size: {size_text}" if size_text else "",
            "Size notation: M means months, Y means years. For example 12M is 12 months, 3Y is 3 years, and 3-6M is 3 to 6 months. Plain numbers such as 24 or 30 are clothing size labels, not ages. Only standard EU children's clothing sizes like 50-164 may be used as approximate age guidance.",
            f"Gender/audience note: {audience_text}" if audience_text else "",
            f"Age note: {age_text}" if age_text else "",
            f"Extra user instruction: {request.instructions.strip()}" if request.instructions.strip() else "",
        ] if part
    )


def _worn_prompt(product: Any, request: AiImageGenerateRequest) -> str:
    context = _product_context(product, request)
    scene = _scene_guidance(product, request)
    return f"""
Use the uploaded product photo as the source of truth for the clothing.
Create a realistic ecommerce lifestyle mockup showing the same clothing worn by an age-appropriate child/person.

Product context:
{context}

Scene guidance:
{scene}

Strict rules:
- Preserve the actual product: colors, fabric look, printed graphics, logo/text, patterns, buttons, trim, and number of visible clothing pieces.
- Do not invent new colors, slogans, logos, accessories, or extra garments that are not in the source image.
- The person must be fully clothed, natural, and appropriate for the provided age/size.
- Choose the scene from the guidance above; keep the setting realistic, bright, clean, and suitable for ecommerce.
- This is an AI mockup to show fit and use; keep it honest and close to the original product photo.
- No watermark, no price text, no promotional text.
""".strip()


def _studio_prompt(product: Any, request: AiImageGenerateRequest) -> str:
    context = _product_context(product, request)
    return f"""
Use the uploaded product photo as the source of truth for the clothing.
Create a clean ecommerce product presentation of the most visible/important garment piece or pieces, displayed on a hanger or neat studio flat-lay.

Product context:
{context}

Strict rules:
- Preserve the actual product: colors, fabric look, printed graphics, logo/text, patterns, buttons, trim, and number of visible clothing pieces when they are clear.
- If multiple pieces are shown, feature the clearest main piece and include matching pieces only when they are visibly part of the same set.
- Do not invent new colors, slogans, logos, accessories, or extra garments.
- Use a simple neutral studio background with good lighting.
- No person, no mannequin body, no watermark, no price text, no promotional text.
""".strip()


def _clean_original_prompt(product: Any, request: AiImageGenerateRequest) -> str:
    context = _product_context(product, request)
    return f"""
Use the uploaded product photo as the source of truth and create a cleaner, more trustworthy ecommerce version of the same photo.
Keep the original product arrangement and camera viewpoint recognizable.

Product context:
{context}

Strict rules:
- Preserve the actual product exactly: colors, fabric texture, printed graphics, logo/text, patterns, buttons, trim, seams, and number of visible clothing pieces.
- Do not turn the clothing into a different product, do not change style, fit, color, graphics, or included pieces.
- Do not add a model/person, hanger, mannequin, accessories, labels, text, watermark, or price.
- Improve only presentation quality: cleaner lighting, sharper product details, more balanced crop, tidier background, and natural ecommerce color accuracy.
- The result must feel honest and confidence-building for customers, not like a different or exaggerated product.
""".strip()


def _size_stock_text(product: Any) -> str:
    size_stocks = _value(product, "size_stocks")
    if not size_stocks:
        return ""
    return ", ".join(
        str(item.get("size", "")).strip()
        for item in size_stocks
        if str(item.get("size", "")).strip()
    )


def _size_context(product: Any, request: AiImageGenerateRequest) -> str:
    request_size = request.size.strip()
    stock_size = _size_stock_text(product)
    raw_size = _value(product, "sizes_raw")
    parts = [part for part in [request_size, stock_size, raw_size] if part]
    seen: set[str] = set()
    unique: list[str] = []
    for part in parts:
        key = str(part).strip().lower()
        if key not in seen:
            seen.add(key)
            unique.append(str(part).strip())
    return "; ".join(unique)


def _infer_audience(product: Any) -> str:
    category = str(_value(product, "category") or "").strip()
    # Explicit category has the highest priority to avoid overriding "Boys" with "Baby" just because the word "toddler" is in the description
    if category.lower() in {"boys", "boy"}:
        return "Boys"
    if category.lower() in {"girls", "girl"}:
        return "Girls"
    if category.lower() in {"baby", "newborn", "infant"}:
        return "Baby"
    if category.lower() in {"kids", "kid"}:
        return "Kids"

    # Fallback to regex search on text if category is empty
    text = " ".join(
        str(value or "")
        for value in [
            _value(product, "title_raw"),
            _value(product, "product_type"),
            _value(product, "color_raw"),
            _value(product, "sizes_raw"),
            _value(product, "description"),
            _value(product, "notes"),
        ]
    ).lower()

    if re.search(r"\b(baby|newborn|infant|toddler|mini baby|bebe|bebek)\b|b\.?\s*b\.?|بيبي|رضيع|مواليد", text):
        return "Baby"
    if re.search(r"\b(girls?|girl'?s)\b|بناتي|بنات|بنت|فتيات|kız", text):
        return "Girls"
    if re.search(r"\b(boys?|boy'?s)\b|ولادي|اولادي|أولادي|ولد|صبيان|erkek", text):
        return "Boys"

    return ""


def _infer_age_from_sizes(size_text: str) -> str:
    age_range = _extract_age_range_in_months(size_text)
    if not age_range:
        return ""
    min_months, max_months = age_range
    if min_months == max_months:
        return f"About {_format_age(min_months)}"
    return f"About {_format_age(min_months)} to {_format_age(max_months)}"


def _extract_age_range_in_months(size_text: str) -> tuple[int, int] | None:
    text = str(size_text or "").lower().replace("–", "-").replace("—", "-")
    values: list[int] = []

    for match in re.finditer(r"(\d{1,2})\s*-\s*(\d{1,2})\s*(m|mo|month|months|y|yr|year|years)\b", text):
        factor = 12 if match.group(3).startswith("y") else 1
        values.extend([int(match.group(1)) * factor, int(match.group(2)) * factor])

    for match in re.finditer(r"\b(\d{1,2})\s*(m|mo|month|months|y|yr|year|years)\b", text):
        factor = 12 if match.group(2).startswith("y") else 1
        values.append(int(match.group(1)) * factor)

    eu_size_to_months = {
        50: 0, 56: 1, 62: 3, 68: 6, 74: 9, 80: 12, 86: 18, 92: 24,
        98: 36, 104: 48, 110: 60, 116: 72, 122: 84, 128: 96, 134: 108,
        140: 120, 146: 132, 152: 144, 158: 156, 164: 168,
    }
    for match in re.finditer(r"\b(50|56|62|68|74|80|86|92|98|104|110|116|122|128|134|140|146|152|158|164)\b", text):
        values.append(eu_size_to_months[int(match.group(1))])

    clean = sorted({value for value in values if 0 <= value <= 216})
    if not clean:
        return None
    return clean[0], clean[-1]


def _format_age(months: int) -> str:
    if months == 0:
        return "newborn"
    if months < 24:
        return f"{months} month{'s' if months != 1 else ''}"
    if months % 12 == 0:
        years = months // 12
        return f"{years} year{'s' if years != 1 else ''}"
    return f"{months // 12} years {months % 12} months"


def _scene_guidance(product: Any, request: AiImageGenerateRequest) -> str:
    text = " ".join(
        str(value or "")
        for value in [
            _value(product, "title_raw"),
            _value(product, "category"),
            _value(product, "product_type"),
            _value(product, "description"),
            request.instructions,
        ]
    ).lower()

    indoor_terms = [
        "pajama", "pyjama", "sleep", "homewear", "nightwear",
        "baby", "bodysuit", "onesie", "romper", "jumpsuit",
        "knit", "cardigan", "sweater", "hoodie", "winter",
        "بيجاما", "بجاما", "بيبي", "افرول", "اوفرول",
    ]
    outdoor_terms = [
        "dress", "short", "t-shirt", "shirt", "set", "summer",
        "casual", "pants", "jeans", "skirt",
        "فستان", "شورت", "تيشيرت", "تيشرت", "بنطلون", "تنورة",
    ]

    if any(term in text for term in indoor_terms):
        return (
            "Prefer a bright indoor home or soft studio setting, such as a clean child room, "
            "nursery, cozy bedroom, or simple natural-light studio. This is best for pajamas, "
            "babywear, knitwear, jumpsuits, rompers, bodysuits, and homewear."
        )
    if any(term in text for term in outdoor_terms):
        return (
            "Prefer a clean outdoor or natural-light lifestyle setting, such as a garden, "
            "sidewalk, simple storefront, or bright minimal patio. Use this for casual daywear, "
            "t-shirts, shorts, dresses, skirts, pants, jeans, and summer sets."
        )
    return (
        "If the clothing looks like sleepwear, babywear, knitwear, or homewear, use a bright indoor setting. "
        "If it looks like casual daywear, summer clothing, dresses, t-shirts, shorts, or pants, use a clean outdoor or natural-light lifestyle setting."
    )


def _value(product: Any, field: str) -> Any:
    if isinstance(product, dict):
        return product.get(field, "")
    return getattr(product, field, "")


def _brief_error(exc: Exception) -> str:
    text = str(exc).replace("\n", " ").strip()
    return text[:300] or exc.__class__.__name__

def get_prompt_previews(product: Any, request: AiImageGenerateRequest) -> dict[str, str]:
    """Returns the generated prompts that would be sent to the AI service."""
    return {
        "productContext": _product_context(product, request),
        "wornPrompt": _worn_prompt(product, request),
        "studioPrompt": _studio_prompt(product, request),
        "cleanOriginalPrompt": _clean_original_prompt(product, request),
    }
