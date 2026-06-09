"""SQLite-backed auth helpers."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from typing import Optional

import bcrypt

from ..trackify.email_service import send_password_reset_otp
from ..trackify.service import _connect
from .models import AuthUser

TOKEN_TTL_SECONDS = 60 * 60 * 24 * 14
OTP_TTL_SECONDS = 60 * 5
OTP_MAX_ATTEMPTS = 5


def _secret() -> str:
    return os.getenv("AUTH_SECRET") or os.getenv("GROQ_API_KEY") or "lumen-local-dev-secret"


def init_auth_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                password_hash TEXT,
                avatar_url TEXT,
                provider TEXT NOT NULL DEFAULT 'local',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_reset_otps (
                email TEXT PRIMARY KEY,
                otp_hash TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                attempts INTEGER NOT NULL DEFAULT 0,
                verified INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            )
            """
        )


def _hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 150000)
    return f"{salt}${base64.b64encode(digest).decode()}"


def _hash_password_bcrypt(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    return f"bcrypt${hashed}"


def _verify_password(password: str, stored: str | None) -> bool:
    if not stored or "$" not in stored:
        return False
    if stored.startswith("bcrypt$"):
        hashed = stored.removeprefix("bcrypt$").encode()
        try:
            return bcrypt.checkpw(password.encode(), hashed)
        except ValueError:
            return False
    salt, _ = stored.split("$", 1)
    return hmac.compare_digest(_hash_password(password, salt), stored)


def _hash_otp(otp_code: str) -> str:
    return bcrypt.hashpw(otp_code.encode(), bcrypt.gensalt()).decode()


def _verify_otp_hash(otp_code: str, otp_hash: str) -> bool:
    try:
        return bcrypt.checkpw(otp_code.encode(), otp_hash.encode())
    except ValueError:
        return False


def _row_to_user(row: sqlite3.Row) -> AuthUser:
    return AuthUser(
        id=int(row["id"]),
        email=row["email"],
        name=row["name"],
        avatar_url=row["avatar_url"],
        provider=row["provider"],
    )


def get_user_by_id(user_id: int) -> Optional[AuthUser]:
    init_auth_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None


def get_user_by_email(email: str) -> Optional[AuthUser]:
    init_auth_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    return _row_to_user(row) if row else None


def create_user(email: str, password: str, name: str) -> AuthUser:
    init_auth_db()
    with _connect() as conn:
        cursor = conn.execute(
            """
            INSERT INTO users (email, name, password_hash, provider)
            VALUES (?, ?, ?, 'local')
            """,
            (email.lower(), name.strip(), _hash_password(password)),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return _row_to_user(row)


def authenticate_user(email: str, password: str) -> Optional[AuthUser]:
    init_auth_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
    if not row or not _verify_password(password, row["password_hash"]):
        return None
    return _row_to_user(row)


def update_user_name(user_id: int, name: str) -> Optional[AuthUser]:
    init_auth_db()
    with _connect() as conn:
        conn.execute(
            "UPDATE users SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (name.strip(), user_id),
        )
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return _row_to_user(row) if row else None


def request_password_reset(email: str) -> bool:
    init_auth_db()
    normalized = email.lower()
    user = get_user_by_email(normalized)
    if not user:
        return True
    otp_code = f"{secrets.randbelow(10000):04d}"
    now = int(time.time())
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO password_reset_otps (email, otp_hash, expires_at, attempts, verified, created_at)
            VALUES (?, ?, ?, 0, 0, ?)
            ON CONFLICT(email) DO UPDATE SET
                otp_hash = excluded.otp_hash,
                expires_at = excluded.expires_at,
                attempts = 0,
                verified = 0,
                created_at = excluded.created_at
            """,
            (normalized, _hash_otp(otp_code), now + OTP_TTL_SECONDS, now),
        )
    return send_password_reset_otp(normalized, otp_code)


def verify_password_reset_otp(email: str, otp_code: str) -> bool:
    init_auth_db()
    normalized = email.lower()
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM password_reset_otps WHERE email = ?",
            (normalized,),
        ).fetchone()
        if not row or row["expires_at"] < now or row["attempts"] >= OTP_MAX_ATTEMPTS:
            return False
        if not _verify_otp_hash(otp_code, row["otp_hash"]):
            conn.execute(
                "UPDATE password_reset_otps SET attempts = attempts + 1 WHERE email = ?",
                (normalized,),
            )
            return False
        conn.execute(
            "UPDATE password_reset_otps SET verified = 1 WHERE email = ?",
            (normalized,),
        )
    return True


def reset_password(email: str, otp_code: str, new_password: str) -> bool:
    init_auth_db()
    normalized = email.lower()
    now = int(time.time())
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM password_reset_otps WHERE email = ?",
            (normalized,),
        ).fetchone()
        if not row or row["expires_at"] < now or row["attempts"] >= OTP_MAX_ATTEMPTS:
            return False
        if not row["verified"] and not _verify_otp_hash(otp_code, row["otp_hash"]):
            conn.execute(
                "UPDATE password_reset_otps SET attempts = attempts + 1 WHERE email = ?",
                (normalized,),
            )
            return False
        updated = conn.execute(
            "UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?",
            (_hash_password_bcrypt(new_password), normalized),
        )
        conn.execute("DELETE FROM password_reset_otps WHERE email = ?", (normalized,))
    return updated.rowcount > 0


def create_token(user: AuthUser) -> str:
    payload = {
        "sub": user.id,
        "email": user.email,
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    raw = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    sig = hmac.new(_secret().encode(), raw.encode(), hashlib.sha256).hexdigest()
    return f"{raw}.{sig}"


def verify_token(token: str) -> Optional[AuthUser]:
    if "." not in token:
        return None
    raw, sig = token.rsplit(".", 1)
    expected = hmac.new(_secret().encode(), raw.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        padded = raw + "=" * (-len(raw) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()).decode())
    except Exception:
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    return get_user_by_id(int(payload.get("sub")))
