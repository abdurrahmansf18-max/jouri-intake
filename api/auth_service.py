import os
import secrets
import time
from collections import defaultdict

import pyotp
from fastapi import HTTPException

import activity_logger
from database import SessionLocal


TOTP_SECRET = os.environ.get("TOTP_SECRET", "").strip()
USER_PASSWORD = os.environ.get("USER_PASSWORD", "").strip()
USER_PASSWORD_2 = os.environ.get("USER_PASSWORD_2", "").strip()
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").strip().lower() == "true"
AUTH_COOKIE_NAME = "jouri_session"
SESSION_TTL = 60 * 60 * 24  # 24 saat
EDIT_LOCK_CODE = os.environ.get("EDIT_LOCK_CODE", "").strip()

_sessions: dict[str, float] = {}

_auth_attempts: dict[str, list[float]] = defaultdict(list)
_AUTH_MAX = 10
_AUTH_WINDOW = 60


def verify_access_token(token: str | None) -> None:
    if not TOTP_SECRET:
        return
    if not is_valid_session(token):
        raise HTTPException(status_code=401, detail={"code": "ERR_UNAUTHORIZED"})


def is_auth_required() -> bool:
    return bool(TOTP_SECRET)


def is_valid_session(token: str | None) -> bool:
    if not token:
        return False
    ts = _sessions.get(token)
    if ts is None:
        return False
    if time.time() - ts > SESSION_TTL:
        _sessions.pop(token, None)
        return False
    return True


def verify_login(code: str, client_ip: str) -> str | None:
    if not TOTP_SECRET and not USER_PASSWORD:
        return None

    if not _auth_rate_ok(client_ip):
        raise HTTPException(status_code=429, detail={"code": "ERR_RATE_LIMITED"})

    clean_code = code.strip()

    totp_ok = False
    if TOTP_SECRET and clean_code.isdigit() and len(clean_code) == 6:
        totp_ok = pyotp.TOTP(TOTP_SECRET).verify(clean_code, valid_window=1)

    pw1_ok = bool(USER_PASSWORD and clean_code == USER_PASSWORD)
    pw2_ok = bool(USER_PASSWORD_2 and clean_code == USER_PASSWORD_2)
    password_ok = pw1_ok or pw2_ok

    if not totp_ok and not password_ok:
        raise HTTPException(status_code=401, detail={"code": "ERR_WRONG_CODE"})

    if totp_ok:
        login_user = "TOTP"
    elif pw1_ok:
        login_user = "Kullanıcı 1"
    else:
        login_user = "Kullanıcı 2"

    _log_login(login_user)
    return _create_session()


def verify_edit_lock_code(code: str) -> None:
    if not EDIT_LOCK_CODE:
        return
    if code.strip() != EDIT_LOCK_CODE:
        raise HTTPException(status_code=401, detail={"code": "ERR_WRONG_CODE"})


def _create_session() -> str:
    token = secrets.token_urlsafe(32)
    _sessions[token] = time.time()
    expired = [t for t, ts in list(_sessions.items()) if time.time() - ts > SESSION_TTL]
    for t in expired:
        _sessions.pop(t, None)
    return token


def _auth_rate_ok(ip: str) -> bool:
    now = time.time()
    attempts = [t for t in _auth_attempts[ip] if now - t < _AUTH_WINDOW]
    _auth_attempts[ip] = attempts
    if len(attempts) >= _AUTH_MAX:
        return False
    attempts.append(now)
    return True


def _log_login(login_user: str) -> None:
    try:
        log_db = SessionLocal()
        activity_logger.log(log_db, "login", product_id=None, product_title=None, details={"user": login_user})
        log_db.commit()
        log_db.close()
    except Exception:
        pass
