import re
from models import ParsedProduct

COLOR_TRANSLATIONS: dict[str, str] = {
    "أبيض": "Weiß", "ابيض": "Weiß",
    "بيج": "Beige",
    "اسود": "Schwarz", "أسود": "Schwarz",
    "احمر": "Rot", "أحمر": "Rot",
    "زهري": "Rosa", "وردي": "Rosa",
    "تفاحي": "Apfelgrün",
    "كحلي": "Marineblau",
    "ازرق": "Blau", "أزرق": "Blau",
    "اخضر": "Grün", "أخضر": "Grün",
    "اصفر": "Gelb", "أصفر": "Gelb",
    "بنفسجي": "Lila",
    "بني": "Braun",
    "رمادي": "Grau",
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

    has_dress = bool(re.search(r"فستان|elbise|dress", description, re.IGNORECASE))
    has_girl = bool(re.search(r"بناتي|بنت|kiz|kız|maedchen|mädchen|girl", description, re.IGNORECASE))
    has_bolero = bool(re.search(r"بوليرو|bolero", description, re.IGNORECASE))

    color_raw = _clean(color_match.group(1)) if color_match else ""
    color_de = COLOR_TRANSLATIONS.get(color_raw, "")

    category = ""
    if has_dress and has_girl:
        category = "Mädchenkleider"
    elif has_dress:
        category = "Kleider"

    product_type = ""
    if has_dress:
        product_type = "Kleid mit Bolero" if has_bolero else "Kleid"

    price_amount = ""
    currency = ""
    if price_match:
        price_amount = price_match.group(1).replace(",", ".")
        currency = "EUR"

    tags = [t for t in [category, product_type, "Mädchen" if has_girl else "", color_de] if t]

    return ParsedProduct(
        titleRaw=title_raw,
        categorySuggestion=category,
        productTypeSuggestion=product_type,
        priceAmount=price_amount,
        currency=currency,
        colorRaw=color_raw,
        colorGermanSuggestion=color_de,
        sizesRaw=_clean(sizes_match.group(1)) if sizes_match else "",
        tags=tags,
    )


def _clean(value: str) -> str:
    return re.sub(r"^[:：\s]+", "", value).strip()
