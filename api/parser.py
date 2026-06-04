import os
import re
import json
from pydantic import ValidationError
from dotenv import load_dotenv
from openai import AsyncOpenAI
from models import ParsedProduct

load_dotenv()

# We support OpenAI, Gemini (via OpenAI compatibility), or Ollama.
# If GEMINI_API_KEY is present, we use Gemini endpoint.
# If OPENAI_API_KEY is present, we use OpenAI.
# If OLLAMA_URL is present, we use Ollama.

_client = None
_model_name = "gpt-4o-mini"

if os.getenv("GEMINI_API_KEY"):
    _client = AsyncOpenAI(
        api_key=os.getenv("GEMINI_API_KEY"),
        base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
    )
    _model_name = "gemini-1.5-flash"
elif os.getenv("OPENAI_API_KEY"):
    _client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    _model_name = "gpt-4o-mini"
elif os.getenv("OLLAMA_URL"):
    _client = AsyncOpenAI(
        api_key="ollama",
        base_url=os.getenv("OLLAMA_URL")
    )
    _model_name = os.getenv("OLLAMA_MODEL", "llama3")

async def parse_description_ai(description: str) -> ParsedProduct:
    if not _client:
        return parse_description(description)
        
    system_prompt = """
    You are an AI assistant for a clothing store. The user will provide a raw product description (usually in Arabic or mixed languages).
    Your job is to extract and translate the information into a JSON object matching the following schema.
    Translate the title and description to English.
    
    IMPORTANT for Description: Write a rich, appealing, and well-structured product description. It should not be too short nor too long. Describe the style, comfort, and occasions it fits. DO NOT just repeat the title. Use 2-3 sentences.
    
    IMPORTANT for Variants: If the user provides multiple colors (e.g. Beige size 2, Brown size 3), extract them into the `variants` array so we know exactly which sizes belong to which color. If sizes are not tied to colors, just list the same sizes for each color variant.
    
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
    
    try:
        response = await _client.chat.completions.create(
            model="gemini-2.5-flash",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": description}
            ],
            response_format={ "type": "json_object" }
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
            
        data = json.loads(content.strip())
        
        variants = data.get("variants", [])
        
        # Build fallback strings for backwards compatibility
        color_raw = data.get("colorRaw", "")
        sizes_raw = data.get("sizesRaw", "")
        
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
            
        return {
            "parsed": ParsedProduct(
                titleRaw=data.get("titleRaw", ""),
                categorySuggestion=data.get("categorySuggestion", ""),
                productTypeSuggestion=data.get("productTypeSuggestion", ""),
                priceAmount=str(data.get("priceAmount", "")),
                currency=data.get("currency", "EUR"),
                colorRaw=color_raw,
                colorGermanSuggestion="",
                sizesRaw=sizes_raw,
                tags=[]
            ).model_dump(),
            "description": data.get("description", ""),
            "variants": variants
        }
    except Exception as e:
        print("AI parsing failed:", e)
        # Fallback to regex parser
        parsed = parse_description(description)
        return {"parsed": parsed.model_dump(), "description": description}


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
