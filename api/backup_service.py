import json
import os
import re
import shutil
import subprocess
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import SessionLocal
from db_models import ActivityLog, Product


BACKUP_ROOT = Path("/backups")
RUNNING_FILE = BACKUP_ROOT / "running.json"
DRIVE_ROOT = os.getenv("BACKUP_DRIVE_ROOT", "gdrive:jouri-backups").rstrip("/")
DRIVE_LAYOUT_VERSION = "db-daily-photo-blobs-v1"
DRIVE_STAGE_ROOT = BACKUP_ROOT / ".drive_stage"
RCLONE_COPY_TIMEOUT_SECONDS = int(os.getenv("BACKUP_RCLONE_COPY_TIMEOUT_SECONDS", "3600"))
RCLONE_CHECK_TIMEOUT_SECONDS = int(os.getenv("BACKUP_RCLONE_CHECK_TIMEOUT_SECONDS", "1200"))
RCLONE_VERIFY_AFTER_COPY = os.getenv("BACKUP_RCLONE_VERIFY", "").lower() in {"1", "true", "yes"}
try:
    BACKUP_TIMEZONE = ZoneInfo(os.getenv("BACKUP_TIMEZONE", "Europe/Istanbul"))
except ZoneInfoNotFoundError:
    BACKUP_TIMEZONE = timezone.utc


def get_backup_overview() -> dict:
    status_file = BACKUP_ROOT / "status.json"
    status = {}
    if status_file.exists():
        try:
            status = json.loads(status_file.read_text())
        except Exception:
            pass
    running_status = _read_running_status()
    status["running"] = bool(running_status)
    if running_status:
        status["running_started_at"] = running_status.get("started_at")
        status["running_step"] = running_status.get("step")
        status["running_updated_at"] = running_status.get("updated_at")

    backups = []
    if BACKUP_ROOT.exists():
        for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
            if not entry.is_dir() or not entry.name.startswith("20"):
                continue
            backups.append(_backup_entry(entry))
    drive_backups = _list_drive_backups()

    db = SessionLocal()
    try:
        status["database"] = _database_overview(db)
    finally:
        db.close()
    status["storage"] = _storage_overview(status, len(backups), len(drive_backups))

    return {
        "status": status,
        "backups": backups,
        "drive_backups": drive_backups,
    }


def start_manual_backup(background_tasks: BackgroundTasks) -> dict:
    """Manuel yedeklemeyi arka planda başlatır ve mevcut durumu hemen döner."""
    if not BACKUP_ROOT.exists():
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})

    running_status = _read_running_status()
    if running_status:
        return get_backup_overview()

    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    _write_running_status({"started_at": started_at, "step": "queued"})
    background_tasks.add_task(_run_manual_backup_background)
    return get_backup_overview()


def run_scheduled_backup() -> dict:
    """Cron gibi senkron çalışan otomatik işler için tek yedekleme giriş noktası."""
    if not BACKUP_ROOT.exists():
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})

    running_status = _read_running_status()
    if running_status:
        return get_backup_overview()

    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    _write_running_status({"started_at": started_at, "step": "queued"})

    db = SessionLocal()
    try:
        return run_manual_backup(db)
    finally:
        db.close()
        RUNNING_FILE.unlink(missing_ok=True)


def run_manual_backup(db: Session) -> dict:
    """Manuel yedekleme: pg_dump db.sql + JSON export + artımlı fotoğraf kopyalama."""
    if not BACKUP_ROOT.exists():
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})

    now = datetime.now(BACKUP_TIMEZONE)
    date_str = now.strftime("%Y-%m-%d")
    started_str = now.strftime("%Y-%m-%dT%H:%M:%S")

    today_dir = BACKUP_ROOT / date_str
    today_dir.mkdir(parents=True, exist_ok=True)

    try:
        db_sql_file = today_dir / "db.sql"
        _mark_running_step("database_dump")
        db_sql_error = _write_pg_dump(db_sql_file)

        _mark_running_step("json_export")
        products = db.query(Product).all()
        db_data = {
            "exported_at": started_str,
            "products": [
                {
                    "id": p.id,
                    "created_at": p.created_at.isoformat() if p.created_at else None,
                    "folder_name": p.folder_name,
                    "folder_path": p.folder_path,
                    "description": p.description,
                    "status": p.status,
                    "notes": p.notes,
                    "stock_quantity": p.stock_quantity,
                    "sold_quantity": p.sold_quantity,
                    "last_sold_at": p.last_sold_at.isoformat() if p.last_sold_at else None,
                    "title_raw": p.title_raw,
                    "category": p.category,
                    "product_type": p.product_type,
                    "price_amount": p.price_amount,
                    "currency": p.currency,
                    "color_raw": p.color_raw,
                    "color_german": p.color_german,
                    "sizes_raw": p.sizes_raw,
                    "tags": p.tags,
                    "images": p.images,
                    "sale_history": p.sale_history,
                    "size_stocks": p.size_stocks,
                    "sold_sizes": p.sold_sizes,
                    "related_products": p.related_products,
                    "shopify": {
                        "productId": p.shopify_product_id,
                        "handle": p.shopify_product_handle,
                        "syncedAt": p.shopify_synced_at.isoformat() if p.shopify_synced_at else None,
                        "lastError": p.shopify_last_error,
                    },
                }
                for p in products
            ]
        }
        db_json_file = today_dir / "db.json"
        db_json_tmp = today_dir / "db.json.tmp"
        db_json_tmp.write_text(json.dumps(db_data, ensure_ascii=False, indent=2), encoding="utf-8")
        db_json_tmp.replace(db_json_file)

        photos_src = Path("/products_photo")
        photos_dst = today_dir / "products_photo"
        _mark_running_step("local_snapshot")
        if photos_src.exists():
            _copy_photos_incremental(photos_src, photos_dst, date_str)

        _mark_running_step("manifest")
        db_sql_size = _dir_size(db_sql_file)
        db_json_size = _dir_size(db_json_file)
        img_size = _dir_size(photos_dst) if photos_dst.exists() else "-"
        photo_manifest = _write_photo_manifest(photos_dst, today_dir / "photos_manifest.json", date_str)
        backup_manifest_file = today_dir / "backup_manifest.json"
        _write_backup_manifest(
            backup_manifest_file,
            date_str=date_str,
            started_str=started_str,
            db_sql_size=db_sql_size,
            db_json_size=db_json_size,
            db_sql_error=db_sql_error,
            img_size=img_size,
            photo_manifest=photo_manifest,
        )

        _mark_running_step("drive_sync")
        drive_ok, drive_error, drive_summary = _copy_backup_to_drive(today_dir, date_str)

        backups_list = []
        for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
            if not entry.is_dir() or not entry.name.startswith("20"):
                continue
            backups_list.append(_backup_entry(entry))

        status_data: dict = {
            "last_run": started_str,
            "last_date": date_str,
            "last_db_size": db_sql_size,
            "last_db_sql_size": db_sql_size,
            "last_db_json_size": db_json_size,
            "last_db_sql_error": db_sql_error,
            "last_img_size": img_size,
            "last_photo_files": photo_manifest["file_count"],
            "last_photo_unique_blobs": photo_manifest["unique_blob_count"],
            "last_photo_bytes": photo_manifest["total_bytes"],
            "drive_ok": drive_ok,
            "drive_error": drive_error,
            "drive_layout": DRIVE_LAYOUT_VERSION,
            "database": _database_overview(db),
            **drive_summary,
            "running": False,
            "running_started_at": None,
            "backups": backups_list,
        }
        status_data["storage"] = _storage_overview(
            status_data,
            local_backup_count=len(backups_list),
            drive_backup_count=len(_list_drive_backups()),
        )
        (BACKUP_ROOT / "status.json").write_text(
            json.dumps(status_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

        return {
            "status": status_data,
            "backups": backups_list,
            "drive_backups": _list_drive_backups(),
        }

    except Exception as exc:
        print(f"[backup] Manuel yedekleme hatası: {exc}")
        _write_backup_error(started_str, str(exc))
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})


def _database_overview(db: Session) -> dict:
    status_rows = (
        db.query(Product.status, func.count(Product.id))
        .group_by(Product.status)
        .all()
    )
    by_status = {status or "unknown": int(count or 0) for status, count in status_rows}
    total_products = int(sum(by_status.values()))
    total_stock = int(db.query(func.coalesce(func.sum(Product.stock_quantity), 0)).scalar() or 0)
    total_sold = int(db.query(func.coalesce(func.sum(Product.sold_quantity), 0)).scalar() or 0)
    shopify_synced = int(
        db.query(func.count(Product.id))
        .filter(Product.shopify_product_id.isnot(None))
        .scalar()
        or 0
    )
    shopify_errors = int(
        db.query(func.count(Product.id))
        .filter(Product.shopify_last_error.isnot(None), Product.shopify_last_error != "")
        .scalar()
        or 0
    )
    activity_logs = int(db.query(func.count(ActivityLog.id)).scalar() or 0)
    latest_product = db.query(func.max(Product.created_at)).scalar()
    latest_activity = db.query(func.max(ActivityLog.created_at)).scalar()

    return {
        "products_total": total_products,
        "products_by_status": by_status,
        "stock_total": total_stock,
        "sold_total": total_sold,
        "shopify_synced": shopify_synced,
        "shopify_errors": shopify_errors,
        "activity_logs": activity_logs,
        "latest_product_at": latest_product.isoformat() if latest_product else None,
        "latest_activity_at": latest_activity.isoformat() if latest_activity else None,
    }


def _storage_overview(status: dict, local_backup_count: int, drive_backup_count: int) -> dict:
    database = status.get("database") or {}
    return {
        "database": {
            "engine": "PostgreSQL",
            "tables": ["products", "activity_logs"],
            "stores": [
                "product_content",
                "stock_sales",
                "image_metadata",
                "shopify_sync",
                "activity_logs",
            ],
            "backup_formats": ["db.sql", "db.json"],
            "last_sql_size": status.get("last_db_sql_size") or status.get("last_db_size"),
            "last_json_size": status.get("last_db_json_size"),
            "products_total": database.get("products_total"),
            "activity_logs": database.get("activity_logs"),
        },
        "vps": {
            "root": "/backups/YYYY-MM-DD",
            "snapshot_count": local_backup_count,
            "files": [
                "db.sql",
                "db.json",
                "products_photo/",
                "photos_manifest.json",
                "backup_manifest.json",
            ],
            "last_photo_size": status.get("last_img_size"),
            "last_photo_files": status.get("last_photo_files"),
            "last_photo_unique_blobs": status.get("last_photo_unique_blobs"),
        },
        "drive": {
            "root": DRIVE_ROOT,
            "layout": status.get("drive_layout") or DRIVE_LAYOUT_VERSION,
            "restore_point_count": drive_backup_count,
            "db_path": status.get("drive_db_path"),
            "manifest_path": status.get("drive_manifest_path"),
            "photos_path": status.get("drive_photos_path"),
            "dedupe": "sha256_photo_blobs",
            "ok": status.get("drive_ok"),
            "error": status.get("drive_error"),
        },
        "workflow": [
            "database_dump",
            "local_snapshot",
            "photo_manifest",
            "drive_sync",
        ],
    }


def _run_manual_backup_background() -> None:
    db = SessionLocal()
    try:
        run_manual_backup(db)
    except Exception as exc:
        print(f"[backup] Arka plan yedekleme hatası: {exc}")
    finally:
        db.close()
        RUNNING_FILE.unlink(missing_ok=True)


def delete_local_backup(date: str) -> dict:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise HTTPException(status_code=400, detail={"code": "ERR_GENERAL"})

    backup_dir = BACKUP_ROOT / date
    if not backup_dir.exists():
        raise HTTPException(status_code=404, detail={"code": "ERR_PRODUCT_NOT_FOUND"})

    # Local sil (Drive'a dokunma — Drive'da tüm yedekler korunur)
    shutil.rmtree(str(backup_dir))
    return {"ok": True}


def delete_drive_backup(date: str) -> dict:
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        raise HTTPException(status_code=400, detail={"code": "ERR_GENERAL"})

    targets = [
        f"{DRIVE_ROOT}/{date}",  # Eski tarih klasoru yapisi.
        f"{DRIVE_ROOT}/db/{date}",
        f"{DRIVE_ROOT}/manifests/{date}",
    ]
    for target in targets:
        try:
            subprocess.run(
                ["rclone", "purge", target, "--quiet"],
                capture_output=True, text=True, timeout=60,
            )
        except Exception:
            raise HTTPException(status_code=500, detail={"code": "ERR_GENERAL"})

    return {"ok": True}


def _read_running_status() -> dict | None:
    if not RUNNING_FILE.exists():
        return None
    try:
        data = json.loads(RUNNING_FILE.read_text(encoding="utf-8"))
    except Exception:
        RUNNING_FILE.unlink(missing_ok=True)
        return None

    started_raw = data.get("started_at")
    try:
        started = datetime.fromisoformat(str(started_raw).replace("Z", "+00:00"))
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        age_seconds = (datetime.now(timezone.utc) - started).total_seconds()
        if age_seconds > 6 * 60 * 60:
            RUNNING_FILE.unlink(missing_ok=True)
            return None
    except Exception:
        pass
    return data


def _write_running_status(data: dict) -> None:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    data = {
        **data,
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
    }
    tmp_file = RUNNING_FILE.with_suffix(".json.tmp")
    tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_file.replace(RUNNING_FILE)


def _mark_running_step(step: str) -> None:
    current = _read_running_status() or {}
    current["step"] = step
    if "started_at" not in current:
        current["started_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    _write_running_status(current)


def _write_backup_error(started_at: str, error: str) -> None:
    status_file = BACKUP_ROOT / "status.json"
    status = {}
    if status_file.exists():
        try:
            status = json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            status = {}

    running_status = _read_running_status() or {}
    status.update({
        "last_run": started_at,
        "drive_ok": False,
        "drive_error": _summarize_rclone_error(error) if error else "Yedekleme başarısız oldu.",
        "failed_step": running_status.get("step"),
        "running": False,
        "running_started_at": None,
    })
    status_file.write_text(json.dumps(status, ensure_ascii=False, indent=2), encoding="utf-8")


def _copy_photos_incremental(photos_src: Path, photos_dst: Path, date_str: str) -> None:
    photos_dst.mkdir(exist_ok=True)
    previous_photos = _previous_photos_backup(date_str)

    for item in photos_src.rglob("*"):
        if not item.is_file():
            continue
        rel = item.relative_to(photos_src)
        dst_file = photos_dst / rel
        dst_file.parent.mkdir(parents=True, exist_ok=True)

        if dst_file.exists() and _same_file_snapshot(item, dst_file):
            continue

        dst_file.unlink(missing_ok=True)
        previous_file = previous_photos / rel if previous_photos else None
        if previous_file and previous_file.exists() and _same_file_snapshot(item, previous_file):
            try:
                os.link(previous_file, dst_file)
                continue
            except OSError:
                pass

        shutil.copy2(item, dst_file)


def _previous_photos_backup(date_str: str) -> Path | None:
    if not BACKUP_ROOT.exists():
        return None
    for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
        if not entry.is_dir() or not entry.name.startswith("20") or entry.name >= date_str:
            continue
        photos_dir = entry / "products_photo"
        if photos_dir.exists():
            return photos_dir
    return None


def _same_file_snapshot(source: Path, candidate: Path) -> bool:
    try:
        source_stat = source.stat()
        candidate_stat = candidate.stat()
    except FileNotFoundError:
        return False
    return (
        source_stat.st_size == candidate_stat.st_size
        and abs(source_stat.st_mtime_ns - candidate_stat.st_mtime_ns) < 1_000_000_000
    )


def _write_photo_manifest(photos_dir: Path, target: Path, date_str: str) -> dict:
    files = []
    total_bytes = 0
    unique_hashes: set[str] = set()
    stage_blobs_root = _photo_blob_stage_root(date_str)
    if stage_blobs_root.exists():
        shutil.rmtree(stage_blobs_root)
    stage_blobs_root.mkdir(parents=True, exist_ok=True)

    if photos_dir.exists():
        for file_path in sorted(p for p in photos_dir.rglob("*") if p.is_file()):
            rel = file_path.relative_to(photos_dir).as_posix()
            file_hash = _sha256_file(file_path)
            blob_rel = _photo_blob_rel(file_hash, file_path.suffix)
            blob_stage = stage_blobs_root / blob_rel
            blob_stage.parent.mkdir(parents=True, exist_ok=True)
            if not blob_stage.exists():
                try:
                    os.link(file_path, blob_stage)
                except OSError:
                    shutil.copy2(file_path, blob_stage)

            stat = file_path.stat()
            total_bytes += stat.st_size
            unique_hashes.add(file_hash)
            files.append({
                "path": rel,
                "size": stat.st_size,
                "mtime_ns": stat.st_mtime_ns,
                "sha256": file_hash,
                "blob": blob_rel.as_posix(),
            })

    manifest = {
        "schema": "binbonkids-photo-manifest-v1",
        "date": date_str,
        "layout": DRIVE_LAYOUT_VERSION,
        "file_count": len(files),
        "unique_blob_count": len(unique_hashes),
        "total_bytes": total_bytes,
        "files": files,
    }
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def _write_backup_manifest(
    target: Path,
    *,
    date_str: str,
    started_str: str,
    db_sql_size: str,
    db_json_size: str,
    db_sql_error: str | None,
    img_size: str,
    photo_manifest: dict,
) -> None:
    manifest = {
        "schema": "binbonkids-backup-manifest-v1",
        "layout": DRIVE_LAYOUT_VERSION,
        "date": date_str,
        "started_at": started_str,
        "local": {
            "db_sql": "db.sql",
            "db_json": "db.json",
            "photos_snapshot": "products_photo/",
            "photo_manifest": "photos_manifest.json",
        },
        "drive": {
            "db": f"{DRIVE_ROOT}/db/{date_str}/",
            "manifest": f"{DRIVE_ROOT}/manifests/{date_str}/",
            "photo_blobs": f"{DRIVE_ROOT}/photos-blobs/",
        },
        "sizes": {
            "db_sql": db_sql_size,
            "db_json": db_json_size,
            "photos": img_size,
        },
        "db_sql_error": db_sql_error,
        "photos": {
            "file_count": photo_manifest["file_count"],
            "unique_blob_count": photo_manifest["unique_blob_count"],
            "total_bytes": photo_manifest["total_bytes"],
        },
    }
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


def _photo_blob_stage_root(date_str: str) -> Path:
    return DRIVE_STAGE_ROOT / date_str / "photos-blobs"


def _photo_blob_rel(file_hash: str, suffix: str) -> Path:
    safe_suffix = suffix.lower() if re.fullmatch(r"\.[A-Za-z0-9]{1,10}", suffix or "") else ""
    return Path(file_hash[:2]) / f"{file_hash}{safe_suffix}"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _list_drive_backups() -> list[str]:
    dates: set[str] = set()
    dates.update(_list_remote_date_dirs(f"{DRIVE_ROOT}/manifests/"))
    dates.update(_list_remote_date_dirs(f"{DRIVE_ROOT}/"))
    return sorted(dates, reverse=True)


def _list_remote_date_dirs(remote: str) -> set[str]:
    try:
        result = subprocess.run(
            ["rclone", "lsf", remote, "--dirs-only"],
            capture_output=True, text=True, timeout=15,
        )
    except Exception:
        return set()
    if result.returncode != 0:
        return set()
    return {
        d.rstrip("/")
        for d in result.stdout.strip().split("\n")
        if re.match(r"^\d{4}-\d{2}-\d{2}/?$", d.strip())
    }


def _dir_size(path) -> str:
    p = Path(path)
    if not p.exists():
        return "-"
    if p.is_file():
        size = p.stat().st_size
    else:
        size = sum(f.stat().st_size for f in p.rglob("*") if f.is_file())
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _backup_entry(entry: Path) -> dict:
    db_sql = entry / "db.sql"
    db_json = entry / "db.json"
    photo_manifest = entry / "photos_manifest.json"
    primary = db_sql if db_sql.exists() else db_json
    data = {
        "date": entry.name,
        "db_size": _dir_size(primary),
        "db_sql_size": _dir_size(db_sql),
        "db_json_size": _dir_size(db_json),
        "img_size": _dir_size(entry / "products_photo"),
        "db_primary": "db.sql" if db_sql.exists() else "db.json",
    }
    if photo_manifest.exists():
        try:
            manifest = json.loads(photo_manifest.read_text(encoding="utf-8"))
            data["photo_files"] = manifest.get("file_count")
            data["photo_unique_blobs"] = manifest.get("unique_blob_count")
        except Exception:
            pass
    return data


def _write_pg_dump(target: Path) -> str | None:
    from urllib.parse import unquote, urlparse

    database_url = os.environ.get(
        "DATABASE_URL",
        "postgresql://jouri:jouri@db:5432/jouri",
    )
    parsed = urlparse(database_url)
    db_name = unquote((parsed.path or "").lstrip("/") or "jouri")
    db_user = unquote(parsed.username or "jouri")
    db_password = unquote(parsed.password or "")
    db_host = parsed.hostname or "db"
    db_port = str(parsed.port or 5432)

    tmp_target = target.with_suffix(target.suffix + ".tmp")
    tmp_target.unlink(missing_ok=True)
    env = os.environ.copy()
    if db_password:
        env["PGPASSWORD"] = db_password

    try:
        result = subprocess.run(
            [
                "pg_dump",
                "-h", db_host,
                "-p", db_port,
                "-U", db_user,
                "-d", db_name,
                "-T", "activity_logs",
                "-f", str(tmp_target),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
    except FileNotFoundError:
        tmp_target.unlink(missing_ok=True)
        return "pg_dump komutu bulunamadı; SQL yedeği üretilemedi."
    except subprocess.TimeoutExpired:
        tmp_target.unlink(missing_ok=True)
        return "pg_dump zaman aşımına uğradı; SQL yedeği üretilemedi."

    if result.returncode != 0:
        tmp_target.unlink(missing_ok=True)
        compact = " ".join((result.stderr or result.stdout or "").split())
        return (compact[:240] if compact else f"pg_dump çıkış kodu {result.returncode}; SQL yedeği üretilemedi.")

    tmp_target.replace(target)
    return None


def _copy_backup_to_drive(source_dir: Path, date_str: str) -> tuple[bool, str | None, dict]:
    db_stage = DRIVE_STAGE_ROOT / date_str / "db"
    manifest_stage = DRIVE_STAGE_ROOT / date_str / "manifests"
    blob_stage = _photo_blob_stage_root(date_str)
    db_remote = f"{DRIVE_ROOT}/db/{date_str}"
    manifest_remote = f"{DRIVE_ROOT}/manifests/{date_str}"
    blobs_remote = f"{DRIVE_ROOT}/photos-blobs"
    summary = {
        "drive_db_path": db_remote,
        "drive_manifest_path": manifest_remote,
        "drive_photos_path": blobs_remote,
    }

    try:
        _stage_daily_drive_files(source_dir, db_stage, manifest_stage)
        steps = [
            ("database", db_stage, db_remote, True),
            ("manifests", manifest_stage, manifest_remote, True),
            ("photo blobs", blob_stage, blobs_remote, False),
        ]
        for label, local_dir, remote, exact_match in steps:
            ok, error = _rclone_copy_dir(local_dir, remote, exact_match=exact_match)
            if not ok:
                return False, f"{label}: {error}", summary
        return True, None, summary
    finally:
        shutil.rmtree(DRIVE_STAGE_ROOT / date_str, ignore_errors=True)


def _stage_daily_drive_files(source_dir: Path, db_stage: Path, manifest_stage: Path) -> None:
    shutil.rmtree(db_stage, ignore_errors=True)
    shutil.rmtree(manifest_stage, ignore_errors=True)
    db_stage.mkdir(parents=True, exist_ok=True)
    manifest_stage.mkdir(parents=True, exist_ok=True)

    for name in ("db.sql", "db.json"):
        source = source_dir / name
        if source.exists():
            shutil.copy2(source, db_stage / name)

    for name in ("backup_manifest.json", "photos_manifest.json"):
        source = source_dir / name
        if source.exists():
            shutil.copy2(source, manifest_stage / name)


def _rclone_copy_dir(source_dir: Path, remote: str, *, exact_match: bool) -> tuple[bool, str | None]:
    common_flags = [
        "--timeout", "5m",
        "--contimeout", "30s",
        "--retries", "3",
        "--retries-sleep", "20s",
        "--low-level-retries", "10",
        "--tpslimit", "8",
        "--tpslimit-burst", "8",
    ]

    try:
        copy_result = subprocess.run(
            [
                "rclone", "copy", str(source_dir), remote,
                "--create-empty-src-dirs",
                "--fast-list",
                "--transfers", "4",
                "--checkers", "8",
                "--stats", "30s",
                *common_flags,
            ],
            capture_output=True,
            text=True,
            timeout=RCLONE_COPY_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        return False, "rclone komutu bulunamadı."
    except subprocess.TimeoutExpired as exc:
        if _remote_matches_or_contains_source(source_dir, remote, exact_match=exact_match):
            return True, None
        return False, _summarize_rclone_error(_timeout_output(exc) or "rclone copy zaman aşımına uğradı.")

    if copy_result.returncode != 0:
        if _remote_matches_or_contains_source(source_dir, remote, exact_match=exact_match):
            return True, None
        return False, _summarize_rclone_error(
            copy_result.stderr or copy_result.stdout or f"rclone copy exit code {copy_result.returncode}"
        )

    if not RCLONE_VERIFY_AFTER_COPY:
        return True, None

    try:
        check_result = subprocess.run(
            [
                "rclone", "check", str(source_dir), remote,
                "--one-way",
                "--size-only",
                *common_flags,
            ],
            capture_output=True,
            text=True,
            timeout=RCLONE_CHECK_TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired as exc:
        return False, _summarize_rclone_error(_timeout_output(exc) or "rclone check zaman aşımına uğradı.")

    if check_result.returncode != 0:
        message = _summarize_rclone_error(
            check_result.stderr or check_result.stdout or f"rclone check exit code {check_result.returncode}"
        )
        return False, f"Drive doğrulaması başarısız: {message}"

    return True, None


def _remote_matches_or_contains_source(source_dir: Path, remote: str, *, exact_match: bool) -> bool:
    if exact_match:
        return _remote_tree_matches_source(source_dir, remote)
    return _remote_contains_source(source_dir, remote)


def _remote_contains_source(source_dir: Path, remote: str) -> bool:
    local_count, _ = _tree_count_and_size(source_dir)
    if local_count <= 0:
        return True

    try:
        result = subprocess.run(
            ["rclone", "check", str(source_dir), remote, "--one-way", "--size-only"],
            capture_output=True,
            text=True,
            timeout=RCLONE_CHECK_TIMEOUT_SECONDS,
        )
    except Exception:
        return False

    return result.returncode == 0


def _remote_tree_matches_source(source_dir: Path, remote: str) -> bool:
    local_count, local_size = _tree_count_and_size(source_dir)
    if local_count <= 0:
        return False

    try:
        result = subprocess.run(
            ["rclone", "size", remote],
            capture_output=True,
            text=True,
            timeout=120,
        )
    except Exception:
        return False

    if result.returncode != 0:
        return False

    output = result.stdout or result.stderr or ""
    objects_match = re.search(r"Total objects:\s+(\d+)", output)
    size_match = re.search(r"Total size:.*\((\d+)\s+Byte\)", output)
    if not objects_match or not size_match:
        return False

    return int(objects_match.group(1)) == local_count and int(size_match.group(1)) == local_size


def _tree_count_and_size(path: Path) -> tuple[int, int]:
    count = 0
    size = 0
    for file_path in path.rglob("*"):
        if not file_path.is_file():
            continue
        count += 1
        size += file_path.stat().st_size
    return count, size


def _timeout_output(exc) -> str:
    output = ""
    for part in (getattr(exc, "stderr", None), getattr(exc, "stdout", None)):
        if isinstance(part, bytes):
            output += part.decode("utf-8", errors="ignore")
        elif isinstance(part, str):
            output += part
    return output


def _summarize_rclone_error(output: str) -> str:
    text = (output or "").strip()
    compact = " ".join(text.split())
    lower = compact.lower()

    if "rate_limit_exceeded" in lower or "ratelimitexceeded" in lower or "quota exceeded" in lower:
        return "Google Drive API kota limiti aşıldı (RATE_LIMIT_EXCEEDED)."
    if "read-only file system" in lower or "failed to save config" in lower:
        return "rclone yapılandırma klasörü yazılabilir değil."
    if "invalid_grant" in lower or "token" in lower and "expired" in lower:
        return "Google Drive yetki anahtarı yenilenmeli."
    if "couldn't find root directory" in lower or "directory not found" in lower:
        return "Google Drive hedef klasörü bulunamadı."
    if "config file" in lower or "failed to create file system" in lower:
        return "rclone yapılandırması okunamadı."
    if "zaman aşımına" in lower or "timeout" in lower or "timed out" in lower:
        return "Google Drive senkronu zaman aşımına uğradı."

    return compact[:240] if compact else "Google Drive senkronu başarısız oldu."
