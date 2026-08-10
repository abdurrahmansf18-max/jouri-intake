from io import BytesIO
from math import sqrt

from PIL import Image, ImageOps

import file_manager
from db_models import Product


def image_signature(raw: bytes) -> list[float]:
    image = Image.open(BytesIO(raw)).convert("RGB")
    image = ImageOps.exif_transpose(image)
    thumb = ImageOps.fit(image, (64, 64), method=Image.Resampling.LANCZOS)
    small = ImageOps.grayscale(ImageOps.fit(image, (8, 8), method=Image.Resampling.LANCZOS))

    hist = thumb.histogram()
    total = max(1, sum(hist[:256]))
    color_features = [value / total for channel in range(3) for value in _bucket(hist[channel * 256:(channel + 1) * 256], 16)]

    pixels = list(small.getdata())
    avg = sum(pixels) / len(pixels)
    hash_features = [1.0 if pixel >= avg else 0.0 for pixel in pixels]
    return color_features + hash_features


def product_signature(product: Product) -> list[float] | None:
    signatures: list[list[float]] = []
    for image in product.images or []:
        try:
            path = file_manager.resolve_image_path(
                product.folder_path,
                str(image.get("folder") or "originals"),
                str(image.get("fileName") or ""),
            )
            signatures.append(image_signature(path.read_bytes()))
        except Exception:
            continue
    if not signatures:
        return None
    return [sum(values) / len(values) for values in zip(*signatures)]


def similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    distance = sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))
    return max(0.0, min(1.0, 1.0 - distance / 8.0))


def _bucket(values: list[int], buckets: int) -> list[int]:
    step = max(1, len(values) // buckets)
    return [sum(values[i:i + step]) for i in range(0, len(values), step)][:buckets]
