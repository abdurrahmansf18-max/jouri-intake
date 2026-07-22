from __future__ import annotations

import re
from typing import Any, Iterable


_MONTH_HINT_RE = re.compile(
    r"\b(?:baby|infant|newborn|toddler|month|months|mo|mos|ay|bebek|bebe)\b|"
    r"\b(?:18|24|30|36)\s*(?:m|mo|mos|month|months)?\b",
    re.IGNORECASE,
)


def normalize_size_label(size: str | None, context: str = "") -> str:
    """Return the customer-facing canonical label used for Shopify size variants."""
    raw = str(size or "").strip()
    if not raw:
        return ""

    cleaned = _clean_size_text(raw)
    compact = re.sub(r"\s+", "", cleaned)
    compact = _fix_unit_typos(compact)
    compact = re.sub(r"(?<=\d)\.(?=[-–])", "", compact)
    compact = re.sub(r"(?<=[-–])(\d+)\.(?=$|[a-z])", r"\1", compact)

    if re.fullmatch(r"(one[- ]?size|onesize|tekbeden|standard|defaulttitle|[-_—]+)", compact):
        return "One Size"

    range_match = re.fullmatch(
        r"(\d+(?:[.,]\d+)?)[-–](\d+(?:[.,]\d+)?)(years?|yrs?|y|yeras|months?|mos?|mo|m)?",
        compact,
        re.IGNORECASE,
    )
    if range_match:
        unit = _unit_from_token(range_match.group(3)) or _default_unit_for_number(
            range_match.group(2),
            context,
        )
        return _format_age_range(range_match.group(1), range_match.group(2), unit)

    prefixed_range = re.fullmatch(
        r"(years?|yrs?|y|yeras|months?|mos?|mo|m)(\d+(?:[.,]\d+)?)[-–](\d+(?:[.,]\d+)?)",
        compact,
        re.IGNORECASE,
    )
    if prefixed_range:
        unit = _unit_from_token(prefixed_range.group(1)) or _default_unit_for_number(
            prefixed_range.group(3),
            context,
        )
        return _format_age_range(prefixed_range.group(2), prefixed_range.group(3), unit)

    single_match = re.fullmatch(
        r"(\d+(?:[.,]\d+)?)(years?|yrs?|yr|y|yeras|months?|month|mos?|mo|m)?",
        compact,
        re.IGNORECASE,
    )
    if single_match:
        unit = _unit_from_token(single_match.group(2)) or _default_unit_for_number(
            single_match.group(1),
            context,
        )
        return _format_age_size(single_match.group(1), unit)

    return _normalize_freeform_size(raw)


def normalize_size_values(values: Iterable[str], context: str = "") -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    context_text = " ".join([context, " ".join(str(v or "") for v in values)])
    for value in values:
        label = normalize_size_label(value, context_text)
        key = size_key(label)
        if label and key not in seen:
            seen.add(key)
            normalized.append(label)
    return normalized


def normalize_size_stock_list(stocks: Iterable[dict[str, Any]], context: str = "") -> list[dict[str, int | str]]:
    normalized: list[dict[str, int | str]] = []
    by_key: dict[str, dict[str, int | str]] = {}
    raw_sizes = [str((stock or {}).get("size") or "") for stock in stocks]
    context_text = " ".join([context, " ".join(raw_sizes)])

    for stock in stocks:
        label = normalize_size_label(str((stock or {}).get("size") or ""), context_text)
        if not label:
            continue
        try:
            qty = max(0, int((stock or {}).get("qty", 0)))
        except Exception:
            qty = 0
        key = size_key(label)
        if key in by_key:
            by_key[key]["qty"] = int(by_key[key].get("qty") or 0) + qty
            continue
        item = {"size": label, "qty": qty}
        by_key[key] = item
        normalized.append(item)

    return normalized


def size_key(size: str | None) -> str:
    label = normalize_size_label(size)
    cleaned = _clean_size_text(label or size or "")
    if not cleaned:
        return "onesize"
    cleaned = re.sub(r"\b(years?|yrs?|yr|yas|yaş|yil|yeras)\b", "y", cleaned)
    cleaned = re.sub(r"\b(months?|month|mos?|mo|ay)\b", "m", cleaned)
    cleaned = re.sub(r"\b(one size|onesize|tek beden|standard|default title)\b", "onesize", cleaned)
    cleaned = re.sub(r"(\d+)\s*-\s*(\d+)\s*y\b", r"\1-\2y", cleaned)
    cleaned = re.sub(r"(\d+)\s*-\s*(\d+)\s*m\b", r"\1-\2m", cleaned)
    cleaned = re.sub(r"(\d+)\s*y\b", r"\1y", cleaned)
    cleaned = re.sub(r"(\d+)\s*m\b", r"\1m", cleaned)
    return re.sub(r"[^a-z0-9]+", "", cleaned) or "onesize"


def _clean_size_text(size: str) -> str:
    value = (size or "").strip().lower()
    value = value.replace("ı", "i").replace("İ", "i")
    value = value.replace("ş", "s").replace("Ş", "s")
    value = value.replace("ğ", "g").replace("Ğ", "g")
    value = value.replace("ü", "u").replace("Ü", "u")
    value = value.replace("ö", "o").replace("Ö", "o")
    value = value.replace("ç", "c").replace("Ç", "c")
    value = re.sub(r"\s+", " ", value)
    return value


def _fix_unit_typos(value: str) -> str:
    return (
        value.replace("yeras", "years")
        .replace("yaers", "years")
        .replace("yaer", "year")
        .replace("yers", "years")
    )


def _unit_from_token(token: str | None) -> str:
    if not token:
        return ""
    token = _fix_unit_typos(token.lower())
    if token.startswith(("m", "mo", "month")):
        return "M"
    if token.startswith(("y", "yr", "year")):
        return "Y"
    return ""


def _default_unit_for_number(number: str, context: str) -> str:
    context_key = _clean_size_text(context)
    if _MONTH_HINT_RE.search(context_key):
        return "M"
    try:
        value = float(str(number).replace(",", "."))
    except ValueError:
        return "Y"
    return "M" if value > 13 else "Y"


def _format_age_size(number: str, unit: str) -> str:
    display_number = _display_number(number)
    singular = display_number in {"1", "1.0"}
    if unit == "M":
        suffix = "Month" if singular else "Months"
    else:
        suffix = "Year" if singular else "Years"
    return f"{display_number} {suffix}"


def _format_age_range(start: str, end: str, unit: str) -> str:
    start_display = _display_number(start)
    end_display = _display_number(end)
    try:
        if float(start_display) > float(end_display):
            start_display, end_display = end_display, start_display
    except ValueError:
        pass
    suffix = "Months" if unit == "M" else "Years"
    return f"{start_display}-{end_display} {suffix}"


def _display_number(number: str) -> str:
    value = str(number).replace(",", ".")
    return value[:-2] if value.endswith(".0") else value


def _normalize_freeform_size(value: str) -> str:
    compact = " ".join(value.strip().split())
    if not compact:
        return ""
    if compact.upper() in {"XS", "S", "M", "L", "XL", "XXL"}:
        return compact.upper()
    return compact[:1].upper() + compact[1:]
