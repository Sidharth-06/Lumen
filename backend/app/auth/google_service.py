"""Google OAuth token verification and user upsert."""
from __future__ import annotations

import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")


def verify_google_token(credential: str) -> Optional[dict]:
    """Verify the Google ID token and return user info dict, or None on failure."""
    if not GOOGLE_CLIENT_ID:
        # No client ID configured — decode without verification for local dev
        log.warning("GOOGLE_CLIENT_ID not set; skipping signature verification (dev only)")
        return _decode_without_verify(credential)

    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests

        idinfo = id_token.verify_oauth2_token(
            credential,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
        return {
            "email": idinfo.get("email", ""),
            "name": idinfo.get("name", idinfo.get("email", "").split("@")[0]),
            "avatar_url": idinfo.get("picture"),
            "google_sub": idinfo.get("sub", ""),
        }
    except Exception as exc:
        log.warning("Google token verification failed: %s", exc)
        return None


def _decode_without_verify(credential: str) -> Optional[dict]:
    """Decode JWT payload without signature check — DEV ONLY."""
    import base64
    import json

    try:
        parts = credential.split(".")
        if len(parts) < 2:
            return None
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        return {
            "email": payload.get("email", ""),
            "name": payload.get("name", payload.get("email", "").split("@")[0]),
            "avatar_url": payload.get("picture"),
            "google_sub": payload.get("sub", ""),
        }
    except Exception as exc:
        log.warning("Could not decode Google JWT: %s", exc)
        return None


def upsert_google_user(google_info: dict):
    """Create or fetch a user record for a Google-authenticated user."""
    from .service import upsert_google_user as service_upsert

    email = google_info.get("email", "").lower()
    name = google_info.get("name") or email.split("@")[0]
    avatar_url = google_info.get("avatar_url")

    if not email:
        return None

    return service_upsert(email, name, avatar_url)
