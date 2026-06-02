import re
from models import ParsedProduct


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
