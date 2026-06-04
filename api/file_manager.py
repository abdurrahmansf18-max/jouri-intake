import os
import re
import hashlib
import shutil
import io
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageOps

from models import SavedImage, ImageFolder, ImageFolders

PRODUCTS_BASE = Path(os.environ.get("PRODUCTS_BASE", "/products_photo"))
DRAFT_ROOT = PRODUCTS_BASE / "catalog-drafts"
AI_ROOT = PRODUCTS_BASE / "ai-enhanced"
PUBLISHED_ROOT = PRODUCTS_BASE / "published"
SOLD_ARCHIVE_ROOT = PRODUCTS_BASE / "sold-archive"

_STATUS_DIRS: dict[str, Path] = {
    "pending": DRAFT_ROOT,
    "ai_enhanced": AI_ROOT,
    "published": PUBLISHED_ROOT,
    "sold_archive": SOLD_ARCHIVE_ROOT,
}

_STATUS_DIR_NAMES: dict[str, str] = {
    "pending": "catalog-drafts",
    "ai_enhanced": "ai-enhanced",
    "published": "published",
    "sold_archive": "sold-archive",
}


def _ensure_roots() -> None:
    for d in _STATUS_DIRS.values():
        d.mkdir(parents=True, exist_ok=True)


def create_product_folder(title_raw: str, description: str) -> tuple[str, Path]:
    _ensure_roots()
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H-%M-%S")
    slug = _slugify(title_raw or "product")[:48]
    hash_val = hashlib.sha1(
        f"{description}{datetime.now().timestamp()}".encode()
    ).hexdigest()[:8]
    folder_name = f"{stamp}-{slug}-{hash_val}"
    folder_path = DRAFT_ROOT / folder_name
    (folder_path / "originals").mkdir(parents=True, exist_ok=True)
    (folder_path / "thumbnails").mkdir(parents=True, exist_ok=True)
    (folder_path / "enhanced").mkdir(parents=True, exist_ok=True)
    return folder_name, folder_path

def _process_image(content: bytes, max_size: tuple[int, int], quality: int = 85) -> bytes:
    try:
        with Image.open(io.BytesIO(content)) as img:
            img = ImageOps.exif_transpose(img)
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            img.thumbnail(max_size, Image.Resampling.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=quality, optimize=True)
            return out.getvalue()
    except Exception as e:
        print(f"[file_manager] Image processing failed: {e}")
        return content  # Fallback to original

def save_images(
    folder_path: Path,
    images: list[tuple[str, bytes, str]],
    start_index: int = 1,
) -> list[SavedImage]:
    originals_path = folder_path / "originals"
    thumbnails_path = folder_path / "thumbnails"
    originals_path.mkdir(parents=True, exist_ok=True)
    thumbnails_path.mkdir(parents=True, exist_ok=True)
    
    status_dir = _detect_status_dir(folder_path)
    saved: list[SavedImage] = []
    
    for offset, (original_name, content, mime_type) in enumerate(images):
        file_name = f"image-{str(start_index + offset).zfill(2)}.jpg"
        
        # Sıkıştırılmış orijinal kaydet
        compressed = _process_image(content, max_size=(1920, 1920), quality=85)
        (originals_path / file_name).write_bytes(compressed)
        
        # Küçük resim (thumbnail) kaydet
        thumbnail = _process_image(content, max_size=(400, 400), quality=80)
        (thumbnails_path / file_name).write_bytes(thumbnail)

        saved.append(SavedImage(
            fileName=file_name,
            originalName=original_name,
            mimeType="image/jpeg",
            size=len(compressed),
            relativePath=f"products_photo/{status_dir}/{folder_path.name}/originals/{file_name}",
        ))
    return saved


def move_product_folder(current_folder_path: str, folder_name: str, new_status: str) -> str:
    current_path = Path(current_folder_path)
    new_root = _STATUS_DIRS[new_status]
    new_root.mkdir(parents=True, exist_ok=True)
    new_path = new_root / folder_name
    if current_path.exists() and current_path != new_path:
        shutil.move(str(current_path), str(new_path))
    return str(new_path)


def delete_product_folder(folder_path: str) -> None:
    path = Path(folder_path)
    if path.exists() and path.is_dir():
        shutil.rmtree(str(path))


def resolve_image_path(folder_path: str, kind: str, file_name: str) -> Path:
    if kind not in {"originals", "enhanced", "thumbnails"}:
        raise FileNotFoundError("Invalid image kind")
    safe_name = Path(file_name).name
    if safe_name != file_name:
        raise FileNotFoundError("Invalid image name")
    image_path = Path(folder_path) / kind / safe_name
    
    # Geriye dönük uyumluluk: Eğer thumbnail istendiyse ve yoksa orijinali ver
    if not image_path.exists() and kind == "thumbnails":
        image_path = Path(folder_path) / "originals" / safe_name
        
    if not image_path.exists() or not image_path.is_file():
        raise FileNotFoundError("Image not found")
    return image_path


def build_image_folders(folder_path: Path, folder_name: str, status: str) -> ImageFolders:
    status_dir = _STATUS_DIR_NAMES.get(status, "catalog-drafts")
    return ImageFolders(
        originals=ImageFolder(
            path=str(folder_path / "originals"),
            relativePath=f"products_photo/{status_dir}/{folder_name}/originals",
        ),
        enhanced=ImageFolder(
            path=str(folder_path / "enhanced"),
            relativePath=f"products_photo/{status_dir}/{folder_name}/enhanced",
        ),
    )


def get_next_image_index(images: list[dict]) -> int:
    highest = 0
    for image in images:
        m = re.search(r"image-(\d+)", image.get("fileName", ""))
        if m:
            highest = max(highest, int(m.group(1)))
    return highest + 1


def _detect_status_dir(folder_path: Path) -> str:
    parent = folder_path.parent.name
    for dir_name in _STATUS_DIR_NAMES.values():
        if parent == dir_name:
            return dir_name
    return "catalog-drafts"


def _slugify(value: str) -> str:
    import unicodedata
    value = unicodedata.normalize("NFKD", value)
    value = value.encode("ascii", "ignore").decode("ascii")
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value)
    return value.strip("-").lower() or "product"


def _get_extension(filename: str, mime: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"}:
        return ext
    return {
        "image/jpeg": ".jpg", "image/png": ".png",
        "image/webp": ".webp", "image/gif": ".gif",
        "image/heic": ".heic", "image/heif": ".heif",
    }.get(mime, ".jpg")
