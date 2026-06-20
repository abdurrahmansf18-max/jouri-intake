import re
import unicodedata
from dataclasses import dataclass

from models import ProductRecord, ProductSearchMatch, ProductSearchResult


@dataclass(frozen=True)
class SearchField:
    key: str
    label: str
    value: str
    weight: int


TOKEN_ALIASES = {
    "summer": ["summer", "yaz", "yazlik", "صيفي"],
    "yaz": ["summer", "yaz", "yazlik", "صيفي"],
    "yazlik": ["summer", "yaz", "yazlik", "صيفي"],
    "winter": ["winter", "kis", "kislik", "شتوي"],
    "kis": ["winter", "kis", "kislik", "شتوي"],
    "kislik": ["winter", "kis", "kislik", "شتوي"],
    "spring": ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
    "ilkbahar": ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
    "ilkbaharlik": ["spring", "ilkbahar", "ilkbaharlik", "ربيعي"],
    "boys": ["boys", "boy", "erkek", "ولادي"],
    "boy": ["boys", "boy", "erkek", "ولادي"],
    "erkek": ["boys", "boy", "erkek", "ولادي"],
    "girls": ["girls", "girl", "kiz", "بناتي"],
    "girl": ["girls", "girl", "kiz", "بناتي"],
    "kiz": ["girls", "girl", "kiz", "بناتي"],
    "baby": ["baby", "bebe", "bebek", "newborn", "بيبي"],
    "bebe": ["baby", "bebe", "bebek", "newborn", "بيبي"],
    "bebek": ["baby", "bebe", "bebek", "newborn", "بيبي"],
}


def normalize_text(value: str) -> str:
    text = unicodedata.normalize("NFD", value or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    return (
        text.replace("ı", "i")
        .replace("İ", "i")
        .replace("أ", "ا")
        .replace("إ", "ا")
        .replace("آ", "ا")
        .replace("ٱ", "ا")
        .replace("ى", "ي")
        .replace("ئ", "ي")
        .replace("ة", "ه")
        .lower()
    )


def search_tokens(query: str) -> list[str]:
    return [token for token in re.split(r"\s+", normalize_text(query).strip()) if token]


def expanded_tokens(query: str) -> list[list[str]]:
    groups: list[list[str]] = []
    for token in search_tokens(query):
        values = [token, *TOKEN_ALIASES.get(token, [])]
        seen: list[str] = []
        for value in values:
            normalized = normalize_text(value)
            if normalized and normalized not in seen:
                seen.append(normalized)
        groups.append(seen)
    return groups


def _join(values: list[object]) -> str:
    return " ".join(str(v).strip() for v in values if v is not None and str(v).strip())


def product_search_fields(record: ProductRecord, include_archive_fields: bool = False) -> list[SearchField]:
    parsed = record.parsed
    size_stock_text = _join([_join([stock.size, stock.qty]) for stock in record.sizeStocks])
    fields = [
        SearchField("title", "Title", parsed.titleRaw, 120),
        SearchField("season", "Season", parsed.season, 110),
        SearchField("category", "Category", parsed.categorySuggestion, 100),
        SearchField("product_type", "Product type", parsed.productTypeSuggestion, 95),
        SearchField("color", "Color", parsed.colorRaw, 85),
        SearchField("german_color", "German color", parsed.colorGermanSuggestion, 75),
        SearchField("sizes", "Sizes", _join([parsed.sizesRaw, size_stock_text]), 70),
        SearchField("price", "Price", _join([parsed.priceAmount, parsed.currency]), 65),
        SearchField("tags", "Tags", _join(parsed.tags), 55),
        SearchField("notes", "Notes", record.notes, 45),
        SearchField("description", "Description", record.description, 30),
        SearchField("folder", "Folder", record.folderName, 15),
    ]
    if include_archive_fields:
        fields.append(
            SearchField(
                "sold_sizes",
                "Sold sizes",
                _join([_join([entry.size, entry.note]) for entry in record.soldSizes]),
                80,
            )
        )
    return [field for field in fields if field.value]


def match_product(record: ProductRecord, query: str, include_archive_fields: bool = False) -> ProductSearchResult | None:
    token_groups = expanded_tokens(query)
    if not token_groups:
        return ProductSearchResult(record=record, matches=[], score=0)

    matches_by_key: dict[str, ProductSearchMatch] = {}
    score = 0
    fields = product_search_fields(record, include_archive_fields)

    for group in token_groups:
        token_matches: list[ProductSearchMatch] = []
        for field in fields:
            normalized_value = normalize_text(field.value)
            matched_token = next((token for token in group if token in normalized_value), "")
            if not matched_token:
                continue
            field_score = field.weight
            if normalized_value == matched_token:
                field_score += 35
            elif normalized_value.startswith(matched_token):
                field_score += 15
            token_matches.append(
                ProductSearchMatch(key=field.key, label=field.label, value=field.value, score=field_score)
            )

        if not token_matches:
            return None

        token_matches.sort(key=lambda match: match.score, reverse=True)
        score += token_matches[0].score
        for match in token_matches[:3]:
            previous = matches_by_key.get(match.key)
            if previous is None or match.score > previous.score:
                matches_by_key[match.key] = match

    matches = sorted(matches_by_key.values(), key=lambda match: match.score, reverse=True)[:4]
    return ProductSearchResult(record=record, matches=matches, score=score)


def search_products(records: list[ProductRecord], query: str, include_archive_fields: bool = False) -> list[ProductSearchResult]:
    token_groups = expanded_tokens(query)
    if not token_groups:
        return [ProductSearchResult(record=record, matches=[], score=0) for record in records]

    results = [match_product(record, query, include_archive_fields) for record in records]
    return sorted(
        [result for result in results if result is not None],
        key=lambda result: (result.score, result.record.createdAt),
        reverse=True,
    )
