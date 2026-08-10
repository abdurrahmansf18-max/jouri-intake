import re


def product_code(product_id: str) -> str:
    """Return a short, stable code that staff can read from a screenshot."""
    compact = re.sub(r"[^A-Za-z0-9]", "", product_id or "").upper()
    suffix = compact[-8:] if compact else "00000000"
    return f"JR-{suffix.rjust(8, '0')}"
