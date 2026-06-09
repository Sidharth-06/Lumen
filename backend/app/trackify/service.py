"""SQLite-backed storage and price extraction helpers for Trackify."""
from __future__ import annotations

import os
import re
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from .models import TrackItem, TrackItemCreate

DEFAULT_DB_PATH = Path(__file__).resolve().parents[3] / "trackify.sqlite3"
DB_PATH = Path(os.getenv("TRACKIFY_DB_PATH", str(DEFAULT_DB_PATH)))


@contextmanager
def _connect() -> Iterator[sqlite3.Connection]:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS track_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                product_name TEXT NOT NULL,
                product_url TEXT NOT NULL,
                last_checked_price REAL,
                target_price REAL NOT NULL,
                user_email TEXT NOT NULL,
                notified BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TEXT NOT NULL,
                last_checked_at TEXT
            )
            """
        )
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(track_items)").fetchall()}
        migrations = {
            "user_id": "ALTER TABLE track_items ADD COLUMN user_id INTEGER",
            "notification_count": "ALTER TABLE track_items ADD COLUMN notification_count INTEGER NOT NULL DEFAULT 0",
            "last_notified_at": "ALTER TABLE track_items ADD COLUMN last_notified_at TEXT",
            "image": "ALTER TABLE track_items ADD COLUMN image TEXT",
            "source": "ALTER TABLE track_items ADD COLUMN source TEXT NOT NULL DEFAULT 'Web'",
            "price_history": "ALTER TABLE track_items ADD COLUMN price_history TEXT NOT NULL DEFAULT '[]'",
        }
        for column, statement in migrations.items():
            if column not in existing:
                conn.execute(statement)
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_track_items_next_batch "
            "ON track_items(notified, last_checked_at, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_track_items_user_email "
            "ON track_items(user_id, user_email)"
        )


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_item(row: sqlite3.Row) -> TrackItem:
    data = dict(row)
    data["notified"] = bool(data["notified"])
    try:
        data["price_history"] = json.loads(data.get("price_history") or "[]")
    except Exception:
        data["price_history"] = []
    return TrackItem(**data)


def add_track_item(payload: TrackItemCreate, user_id: int | None = None, user_email: str | None = None) -> TrackItem:
    init_db()
    owner_email = (payload.user_email or user_email or "").strip().lower()
    history = []
    if payload.current_price:
        history.append({"price": payload.current_price, "checked_at": _now_iso()})
    with _connect() as conn:
        existing = conn.execute(
            "SELECT * FROM track_items WHERE user_id = ? AND product_url = ?",
            (user_id, str(payload.product_url)),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE track_items
                SET product_name = ?,
                    source = ?,
                    image = ?,
                    last_checked_price = ?,
                    target_price = ?,
                    user_email = ?,
                    notified = FALSE,
                    last_checked_at = ?,
                    price_history = ?
                WHERE id = ?
                """,
                (
                    (payload.product_name or str(payload.product_url)).strip(),
                    payload.source or existing["source"] or "Web",
                    payload.image or existing["image"],
                    payload.current_price,
                    float(payload.target_price),
                    owner_email,
                    _now_iso() if payload.current_price else existing["last_checked_at"],
                    json.dumps(history or json.loads(existing["price_history"] or "[]")),
                    existing["id"],
                ),
            )
            updated = conn.execute("SELECT * FROM track_items WHERE id = ?", (existing["id"],)).fetchone()
            return _row_to_item(updated)
        cursor = conn.execute(
            """
            INSERT INTO track_items (
                user_id, product_name, product_url, source, image, last_checked_price, target_price, user_email, created_at, last_checked_at, price_history
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                user_id,
                (payload.product_name or str(payload.product_url)).strip(),
                str(payload.product_url),
                payload.source or "Web",
                payload.image,
                payload.current_price,
                float(payload.target_price),
                owner_email,
                _now_iso(),
                _now_iso() if payload.current_price else None,
                json.dumps(history),
            ),
        )
        row = conn.execute(
            "SELECT * FROM track_items WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
    return _row_to_item(row)


def list_track_items(user_id: int | None = None, user_email: str | None = None) -> list[TrackItem]:
    init_db()
    with _connect() as conn:
        if user_id is not None:
            rows = conn.execute(
                "SELECT * FROM track_items WHERE user_id = ? OR user_email = ? ORDER BY created_at DESC",
                (user_id, (user_email or "").lower()),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM track_items ORDER BY created_at DESC"
            ).fetchall()
    return [_row_to_item(row) for row in rows]


def get_track_item(item_id: int) -> Optional[TrackItem]:
    init_db()
    with _connect() as conn:
        row = conn.execute("SELECT * FROM track_items WHERE id = ?", (item_id,)).fetchone()
    return _row_to_item(row) if row else None


def get_track_item_for_user(item_id: int, user_id: int, user_email: str) -> Optional[TrackItem]:
    init_db()
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM track_items WHERE id = ? AND (user_id = ? OR user_email = ?)",
            (item_id, user_id, user_email.lower()),
        ).fetchone()
    return _row_to_item(row) if row else None


def remove_track_item(item_id: int, user_id: int | None = None, user_email: str | None = None) -> bool:
    init_db()
    with _connect() as conn:
        if user_id is not None:
            cursor = conn.execute(
                "DELETE FROM track_items WHERE id = ? AND (user_id = ? OR user_email = ?)",
                (item_id, user_id, (user_email or "").lower()),
            )
        else:
            cursor = conn.execute("DELETE FROM track_items WHERE id = ?", (item_id,))
    return cursor.rowcount > 0


def get_batch(limit: int = 15) -> list[TrackItem]:
    init_db()
    safe_limit = max(1, min(limit, 20))
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT * FROM track_items
            ORDER BY
                CASE WHEN last_checked_at IS NULL THEN 0 ELSE 1 END,
                last_checked_at ASC,
                created_at ASC
            LIMIT ?
            """,
            (safe_limit,),
        ).fetchall()
    return [_row_to_item(row) for row in rows]


def update_checked_price(item_id: int, price: Optional[float]) -> None:
    with _connect() as conn:
        row = conn.execute("SELECT price_history FROM track_items WHERE id = ?", (item_id,)).fetchone()
        history = []
        if row:
            try:
                history = json.loads(row["price_history"] or "[]")
            except Exception:
                history = []
        if price is not None:
            history.append({"price": price, "checked_at": _now_iso()})
            history = history[-50:]
        conn.execute(
            """
            UPDATE track_items
            SET last_checked_price = ?, last_checked_at = ?, price_history = ?
            WHERE id = ?
            """,
            (price, _now_iso(), json.dumps(history), item_id),
        )


def mark_notified(item_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            """
            UPDATE track_items
            SET notified = TRUE,
                notification_count = notification_count + 1,
                last_notified_at = ?
            WHERE id = ?
            """,
            (_now_iso(), item_id),
        )


def attach_items_to_user(user_id: int, user_email: str) -> None:
    init_db()
    with _connect() as conn:
        conn.execute(
            "UPDATE track_items SET user_id = ? WHERE user_email = ? AND user_id IS NULL",
            (user_id, user_email.lower()),
        )


def reset_notification(item_id: int) -> None:
    with _connect() as conn:
        conn.execute(
            "UPDATE track_items SET notified = FALSE WHERE id = ?",
            (item_id,),
        )


def update_target_price(
    item_id: int,
    target_price: float,
    user_id: int | None = None,
    user_email: str | None = None,
) -> Optional[TrackItem]:
    init_db()
    with _connect() as conn:
        if user_id is not None:
            conn.execute(
                """
                UPDATE track_items
                SET target_price = ?, notified = FALSE
                WHERE id = ? AND (user_id = ? OR user_email = ?)
                """,
                (target_price, item_id, user_id, (user_email or "").lower()),
            )
        else:
            conn.execute(
                "UPDATE track_items SET target_price = ?, notified = FALSE WHERE id = ?",
                (target_price, item_id),
            )
        row = conn.execute("SELECT * FROM track_items WHERE id = ?", (item_id,)).fetchone()
    return _row_to_item(row) if row else None


PRICE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"(?:₹|Rs\.?|INR)\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE),
    re.compile(r"(?:\$|USD)\s*([0-9][0-9,]*(?:\.\d{1,2})?)", re.IGNORECASE),
    re.compile(r"([0-9][0-9,]*(?:\.\d{1,2})?)\s*(?:₹|INR|USD)", re.IGNORECASE),
)


def extract_price(text: str | None) -> Optional[float]:
    if not text:
        return None

    candidates: list[float] = []
    for pattern in PRICE_PATTERNS:
        for match in pattern.finditer(text[:12000]):
            raw = match.group(1).replace(",", "")
            try:
                value = float(raw)
            except ValueError:
                continue
            if value > 0:
                candidates.append(value)

    if not candidates:
        return None

    return min(candidates)
