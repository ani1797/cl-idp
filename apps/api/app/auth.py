from __future__ import annotations

import secrets
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

from app.config import Settings
from app.db import DataStore, DocumentNotFoundError
from app.models import UserDocument

SERVICE_TOKEN_HEADER = "X-Service-Token"
_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def issue_session_token(user: UserDocument, settings: Settings) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user.id,
        "email": str(user.email),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.jwt_expiry_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def read_session_user(token: str, settings: Settings, data_store: DataStore) -> UserDocument | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.PyJWTError:
        return None

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        return None

    try:
        user = data_store.read_user(subject)
    except DocumentNotFoundError:
        return None
    if not user.isActive:
        return None
    return user


def service_token_matches(presented_token: str | None, settings: Settings) -> bool:
    configured_token = settings.service_api_token
    if not configured_token or presented_token is None:
        return False
    return secrets.compare_digest(presented_token, configured_token)
