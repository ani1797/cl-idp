from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError
from fastapi import Request

from app.config import Settings
from app.db import DataStore, DocumentNotFoundError
from app.models import UserDocument

AUTHORIZATION_HEADER = "Authorization"
BEARER_SCHEME_PREFIX = "Bearer "
_password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _password_hasher.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


def _issue_jwt(user: UserDocument, settings: Settings, *, expiry_minutes: int) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": user.id,
        "email": str(user.email),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expiry_minutes)).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def issue_session_token(user: UserDocument, settings: Settings) -> str:
    """Long-lived token set in the `httpOnly` session cookie by `/auth/login`."""

    return _issue_jwt(user, settings, expiry_minutes=settings.jwt_expiry_minutes)


def issue_api_token(user: UserDocument, settings: Settings) -> tuple[str, int]:
    """Short-lived bearer token minted by `POST /auth/token` for scripts/testing.

    Returns `(token, expires_in_seconds)`. It is the same JWT shape as the
    session cookie token (`read_session_user` validates either), just with a
    shorter expiry intended for `Authorization: Bearer` use rather than a
    browser cookie.
    """

    expiry_minutes = settings.api_token_expiry_minutes
    token = _issue_jwt(user, settings, expiry_minutes=expiry_minutes)
    return token, expiry_minutes * 60


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


def parse_bearer_token(header_value: str | None) -> str | None:
    """Extracts the token from an `Authorization: Bearer <token>` header.

    Returns `None` when the header is absent, doesn't use the `Bearer` scheme,
    or the token is blank.
    """

    if header_value is None or not header_value.startswith(BEARER_SCHEME_PREFIX):
        return None
    token = header_value[len(BEARER_SCHEME_PREFIX) :].strip()
    return token or None


@dataclass(frozen=True)
class Principal:
    """The authenticated caller for a request.

    `user` is `None` for trusted service callers (a bearer token matching
    `SERVICE_API_TOKEN`) — they are automation (worker, seed, pipelines), not
    role-bound end users, so there is no `UserDocument` to attach.
    """

    user: UserDocument | None


def resolve_principal(request: Request, settings: Settings, data_store: DataStore) -> Principal | None:
    """Resolves the caller's identity for a request, or `None` if unauthenticated.

    Resolution order:
      1. `Authorization: Bearer <token>` matching `SERVICE_API_TOKEN` — trusted
         service caller, `Principal.user` is `None`.
      2. `Authorization: Bearer <token>` as a user-issued session/API JWT
         (from `/auth/login` or `/auth/token`) — RBAC applies to `user`.
      3. The `httpOnly` session cookie, for browser callers. A bearer header
         that fails both checks above still falls through to the cookie
         instead of failing immediately, since a stale/garbled bearer header
         alongside a valid cookie session is not necessarily a hostile
         request.
    """

    bearer_token = parse_bearer_token(request.headers.get(AUTHORIZATION_HEADER))
    if bearer_token is not None:
        if service_token_matches(bearer_token, settings):
            return Principal(user=None)
        user = read_session_user(bearer_token, settings, data_store)
        if user is not None:
            return Principal(user=user)

    session_token = request.cookies.get(settings.session_cookie_name)
    if session_token is not None:
        user = read_session_user(session_token, settings, data_store)
        if user is not None:
            return Principal(user=user)

    return None
