import base64
import os
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
                    response_format="b64_json",
                    input_fidelity="high",
                )
        except HTTPException:
            raise
        except Exception as exc:
            print("[image_ai] OpenAI image generation failed:", _brief_error(exc))
            raise HTTPException(status_code=502, detail={"code": "ERR_AI_IMAGE_FAILED"})

        if not response.data or not response.data[0].b64_json:
            raise HTTPException(status_code=502, detail={"code": "ERR_AI_IMAGE_FAILED"})
        generated.append(GeneratedAiImage(file_name=file_name, content=base64.b64decode(response.data[0].b64_json)))

    return generated


def _product_context(product: Any, request: AiImageGenerateRequest) -> str:
    size_text = request.size.strip() or _value(product, "sizes_raw") or _size_stock_text(product)
    return "\n".join(
        part for part in [
            f"Product title: {_value(product, 'title_raw')}" if _value(product, "title_raw") else "",
            f"Category/audience: {_value(product, 'category')}" if _value(product, "category") else "",
            f"Product type: {_value(product, 'product_type')}" if _value(product, "product_type") else "",
            f"Color: {_value(product, 'color_raw')}" if _value(product, "color_raw") else "",
            f"Age/size: {size_text}" if size_text else "",
            f"Gender/audience note: {request.gender.strip()}" if request.gender.strip() else "",
            f"Age note: {request.age.strip()}" if request.age.strip() else "",
            f"Extra user instruction: {request.instructions.strip()}" if request.instructions.strip() else "",
        ] if part
    )


def _worn_prompt(product: Any, request: AiImageGenerateRequest) -> str:
    context = _product_context(product, request)
    return f"""
Use the uploaded product photo as the source of truth for the clothing.
Create a realistic ecommerce lifestyle mockup showing the same clothing worn by an age-appropriate child/person.

Product context:
{context}

Strict rules:
- Preserve the actual product: colors, fabric look, printed graphics, logo/text, patterns, buttons, trim, and number of visible clothing pieces.
- Do not invent new colors, slogans, logos, accessories, or extra garments that are not in the source image.
- The person must be fully clothed, natural, and appropriate for the provided age/size.
- Use a clean, bright, realistic indoor setting suitable for a clothing store.
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


def _size_stock_text(product: Any) -> str:
    size_stocks = _value(product, "size_stocks")
    if not size_stocks:
        return ""
    return ", ".join(
        str(item.get("size", "")).strip()
        for item in size_stocks
        if str(item.get("size", "")).strip()
    )


def _value(product: Any, field: str) -> Any:
    if isinstance(product, dict):
        return product.get(field, "")
    return getattr(product, field, "")


def _brief_error(exc: Exception) -> str:
    text = str(exc).replace("\n", " ").strip()
    return text[:300] or exc.__class__.__name__
