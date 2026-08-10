import re


def product_code(product_id: str) -> str:
    """Return a short, stable code that staff can read from a screenshot."""
    compact = re.sub(r"[^A-Za-z0-9]", "", product_id or "").upper()
    suffix = compact[-8:] if compact else "00000000"
    return f"JR-{suffix.rjust(8, '0')}"


def size_code(product_id: str, size: str) -> str:
    """Return a stable per-size code under the product code."""
    compact_size = re.sub(r"[^A-Za-z0-9]", "", size or "").upper()
    return f"{product_code(product_id)}-{compact_size or 'SIZE'}"
