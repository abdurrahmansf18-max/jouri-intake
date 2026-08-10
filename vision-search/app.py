import json
import os
from io import BytesIO
from pathlib import Path
from typing import Any

import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps
from transformers import AutoModel, AutoProcessor


MODEL_NAME = os.getenv("VISION_MODEL", "Marqo/marqo-fashionSigLIP")
MAX_IMAGES_PER_PRODUCT = int(os.getenv("MAX_IMAGES_PER_PRODUCT", "3"))

app = FastAPI(title="Jouri Vision Search")
_model = None
_processor = None
_cache: dict[str, tuple[float, torch.Tensor]] = {}


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model": MODEL_NAME, "loaded": _model is not None}


@app.post("/search")
async def search(
    image: UploadFile = File(),
    catalogJson: str = Form(),
    limit: int = Form(8),
) -> dict[str, Any]:
    try:
        catalog = json.loads(catalogJson)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Invalid catalogJson") from exc

    query = _embed_image_bytes(await image.read())
    scored: list[dict[str, Any]] = []
    for item in catalog:
        product_id = str(item.get("id") or "")
        image_paths = [str(path) for path in item.get("imagePaths") or [] if path]
        if not product_id or not image_paths:
            continue
        embedding = _product_embedding(image_paths[:MAX_IMAGES_PER_PRODUCT])
        if embedding is None:
            continue
        score = float(torch.matmul(query, embedding).item())
        scored.append({"id": product_id, "score": max(0, min(100, round(score * 100)))})

    scored.sort(key=lambda row: row["score"], reverse=True)
    return {"results": scored[: max(1, min(20, int(limit)))]}


def _load_model() -> tuple[Any, Any]:
    global _model, _processor
    if _model is None or _processor is None:
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        _processor = AutoProcessor.from_pretrained(MODEL_NAME, trust_remote_code=True)
        _model = AutoModel.from_pretrained(MODEL_NAME, trust_remote_code=True)
        _model.eval()
    return _model, _processor


def _product_embedding(paths: list[str]) -> torch.Tensor | None:
    vectors: list[torch.Tensor] = []
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists() or not path.is_file():
            continue
        stat = path.stat()
        cached = _cache.get(str(path))
        if cached and cached[0] == stat.st_mtime:
            vectors.append(cached[1])
            continue
        try:
            vector = _embed_image_bytes(path.read_bytes())
        except Exception:
            continue
        _cache[str(path)] = (stat.st_mtime, vector)
        vectors.append(vector)
    if not vectors:
        return None
    return F.normalize(torch.stack(vectors).mean(dim=0), dim=-1)


def _embed_image_bytes(raw: bytes) -> torch.Tensor:
    model, processor = _load_model()
    image = Image.open(BytesIO(raw)).convert("RGB")
    image = ImageOps.exif_transpose(image)
    processed = processor(images=[image], padding="max_length", return_tensors="pt")
    with torch.inference_mode():
        features = model.get_image_features(processed["pixel_values"], normalize=True)
    return F.normalize(features[0].detach().cpu().float(), dim=-1)
