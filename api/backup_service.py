import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import BackgroundTasks, HTTPException
from sqlalchemy.orm import Session

from database import SessionLocal
from db_models import ActivityLog, Product


BACKUP_ROOT = Path("/backups")
RUNNING_FILE = BACKUP_ROOT / "running.json"
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

    backups = []
    if BACKUP_ROOT.exists():
        for entry in sorted(BACKUP_ROOT.iterdir(), reverse=True):
            if not entry.is_dir() or not entry.name.startswith("20"):
                continue
            backups.append(_backup_entry(entry))

    return {
        "status": status,
        "backups": backups,
        "drive_backups": _list_drive_backups(),
    }


def start_manual_backup(background_tasks: BackgroundTasks) -> dict:
    """Manuel yedeklemeyi arka planda başlatır ve mevcut durumu hemen döner."""
    if not BACKUP_ROOT.exists():
        raise HTTPException(status_code=500, detail={"code": "ERR_BACKUP_FAILED"})

    running_status = _read_running_status()
    if running_status:
        return get_backup_overview()

    started_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    _write_running_status({"started_at": started_at})
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
    _write_running_status({"started_at": started_at})

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
        db_sql_error = _write_pg_dump(db_sql_file)

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
        if photos_src.exists():
            _copy_photos_incremental(photos_src, photos_dst, date_str)

        drive_ok, drive_error = _copy_backup_to_drive(today_dir, date_str)

        db_sql_size = _dir_size(db_sql_file)
        db_json_size = _dir_size(db_json_file)
        img_size = _dir_size(photos_dst) if photos_dst.exists() else "-"

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
            "drive_ok": drive_ok,
            "drive_error": drive_error,
            "running": False,
            "running_started_at": None,
            "backups": backups_list,
        }
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

    try:
        subprocess.run(
            ["rclone", "purge", f"gdrive:jouri-backups/{date}", "--quiet"],
            capture_output=True, timeout=30,
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
    tmp_file = RUNNING_FILE.with_suffix(".json.tmp")
    tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_file.replace(RUNNING_FILE)


def _write_backup_error(started_at: str, error: str) -> None:
    status_file = BACKUP_ROOT / "status.json"
    status = {}
    if status_file.exists():
        try:
            status = json.loads(status_file.read_text(encoding="utf-8"))
        except Exception:
            status = {}

    status.update({
        "last_run": started_at,
        "drive_ok": False,
        "drive_error": _summarize_rclone_error(error) if error else "Yedekleme başarısız oldu.",
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


def _list_drive_backups() -> list[str]:
    try:
        result = subprocess.run(
            ["rclone", "lsf", "gdrive:jouri-backups/", "--dirs-only"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode == 0:
            return sorted(
                [d.rstrip("/") for d in result.stdout.strip().split("\n") if d.strip()],
                reverse=True,
            )
    except Exception:
        pass
    return []


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
    primary = db_sql if db_sql.exists() else db_json
    return {
        "date": entry.name,
        "db_size": _dir_size(primary),
        "db_sql_size": _dir_size(db_sql),
        "db_json_size": _dir_size(db_json),
        "img_size": _dir_size(entry / "products_photo"),
        "db_primary": "db.sql" if db_sql.exists() else "db.json",
    }


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


def _copy_backup_to_drive(source_dir: Path, date_str: str) -> tuple[bool, str | None]:
    remote = f"gdrive:jouri-backups/{date_str}"
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
        return False, _summarize_rclone_error(_timeout_output(exc) or "rclone copy zaman aşımına uğradı.")

    if copy_result.returncode != 0:
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
