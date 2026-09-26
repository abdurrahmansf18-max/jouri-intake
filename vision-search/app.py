import asyncio
import json
import os
import threading
from io import BytesIO
from pathlib import Path
from typing import Any
from contextlib import asynccontextmanager

import torch
import torch.nn.functional as F
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image, ImageOps
from transformers import AutoModel, AutoProcessor

MODEL_NAME = os.getenv("VISION_MODEL", "Marqo/marqo-fashionSigLIP")
MODEL_REVISION = os.getenv("VISION_MODEL_REVISION", "c56244cc94f92419e8369fa71efdaf403b124ce8")
MAX_IMAGES_PER_PRODUCT = int(os.getenv("MAX_IMAGES_PER_PRODUCT", "3"))
CACHE_PATH = Path("/models/embeddings_cache.pt")

_model = None
_processor = None
_cache: dict[str, tuple[float, torch.Tensor]] = {}
_cache_lock = threading.Lock()

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _cache
    if CACHE_PATH.exists():
        try:
            _cache = torch.load(CACHE_PATH, map_location="cpu", weights_only=False)
            print(f"Loaded {len(_cache)} cached embeddings")
        except Exception as e:
            print(f"Cache load error: {e}")
            _cache = {}
    yield

app = FastAPI(title="Jouri Vision Search", lifespan=lifespan)

@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "model": MODEL_NAME, "revision": MODEL_REVISION, "loaded": _model is not None}

def _save_cache_sync():
    with _cache_lock:
        try:
            torch.save(_cache, CACHE_PATH)
            print(f"Saved {len(_cache)} embeddings to cache")
        except Exception as e:
            print(f"Failed to save cache: {e}")

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
    
    dirty = False
    for item in catalog:
        product_id = str(item.get("id") or "")
        image_paths = [str(path) for path in item.get("imagePaths") or [] if path]
        if not product_id or not image_paths:
            continue
            
        embedding, changed = _product_embedding(image_paths[:MAX_IMAGES_PER_PRODUCT])
        if changed:
            dirty = True
            
        if embedding is None:
            continue
            
        score = float(torch.matmul(query, embedding).item())
        scored.append({"id": product_id, "score": max(0, min(100, round(score * 100)))})

    scored.sort(key=lambda row: row["score"], reverse=True)
    
    if dirty:
        asyncio.get_running_loop().run_in_executor(None, _save_cache_sync)

    return {"results": scored[: max(1, min(20, int(limit)))]}

def _load_model() -> tuple[Any, Any]:
    global _model, _processor
    if _model is None or _processor is None:
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        _processor = AutoProcessor.from_pretrained(MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=True)
        _model = AutoModel.from_pretrained(MODEL_NAME, revision=MODEL_REVISION, trust_remote_code=True)
        _model.eval()
    return _model, _processor

def _product_embedding(paths: list[str]) -> tuple[torch.Tensor | None, bool]:
    vectors: list[torch.Tensor] = []
    changed = False
    for raw_path in paths:
        path = Path(raw_path)
        if not path.exists() or not path.is_file():
            continue
        stat = path.stat()
        
        with _cache_lock:
            cached = _cache.get(str(path))
            
        if cached and cached[0] == stat.st_mtime:
            vectors.append(cached[1])
            continue
            
        try:
            vector = _embed_image_bytes(path.read_bytes())
        except Exception:
            continue
            
        with _cache_lock:
            _cache[str(path)] = (stat.st_mtime, vector)
        vectors.append(vector)
        changed = True
        
    if not vectors:
        return None, changed
    return F.normalize(torch.stack(vectors).mean(dim=0), dim=-1), changed

def _embed_image_bytes(raw: bytes) -> torch.Tensor:
    model, processor = _load_model()
    image = Image.open(BytesIO(raw)).convert("RGB")
    image = ImageOps.exif_transpose(image)
    processed = processor(images=[image], padding="max_length", return_tensors="pt")
    with torch.inference_mode():
        features = model.get_image_features(processed["pixel_values"], normalize=True)
    return F.normalize(features[0].detach().cpu().float(), dim=-1)
