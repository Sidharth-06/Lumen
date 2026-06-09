"""MongoDB (Atlas) connection and helpers.

Set MONGODB_URI in .env, e.g.:
  MONGODB_URI=mongodb+srv://<user>:<pass>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
  MONGODB_DB=lumen
"""
from __future__ import annotations

import os
from functools import lru_cache

from pymongo import MongoClient
from pymongo.collection import Collection
from pymongo.database import Database


class DBError(RuntimeError):
    pass


@lru_cache(maxsize=1)
def _client() -> MongoClient:
    uri = (os.getenv("MONGODB_URI") or "").strip()
    if not uri:
        raise DBError(
            "MONGODB_URI is not set. Add your MongoDB Atlas connection string to backend/.env"
        )
    return MongoClient(uri, serverSelectionTimeoutMS=8000)


def get_db() -> Database:
    name = (os.getenv("MONGODB_DB") or "lumen").strip()
    return _client()[name]


def next_id(sequence: str) -> int:
    """Atomic auto-increment counter, so the app keeps integer IDs."""
    doc = get_db()["counters"].find_one_and_update(
        {"_id": sequence},
        {"$inc": {"value": 1}},
        upsert=True,
        return_document=True,
    )
    return int(doc["value"])


def users_col() -> Collection:
    return get_db()["users"]


def otps_col() -> Collection:
    return get_db()["password_reset_otps"]


def track_items_col() -> Collection:
    return get_db()["track_items"]


_indexes_done = False


def ensure_indexes() -> None:
    global _indexes_done
    if _indexes_done:
        return
    users_col().create_index("email", unique=True)
    users_col().create_index("id", unique=True)
    otps_col().create_index("email", unique=True)
    track_items_col().create_index("id", unique=True)
    track_items_col().create_index([("user_id", 1), ("user_email", 1)])
    track_items_col().create_index([("notified", 1), ("last_checked_at", 1), ("created_at", 1)])
    _indexes_done = True
