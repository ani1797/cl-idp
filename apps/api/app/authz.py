from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse

from app.models import Error, UserDocument, UserRole


def current_user(request: Request) -> UserDocument | None:
    """The interactive session user for this request, or `None`.

    `None` covers both unauthenticated requests (rejected earlier by the auth
    middleware, so unreachable here) and requests authenticated via the
    `SERVICE_API_TOKEN` header — the trusted internal caller used by the
    worker and the seed script, which never carries a role-bound session.
    """

    return getattr(request.state, "user", None)


def require_roles(request: Request, *allowed_roles: UserRole) -> JSONResponse | None:
    """Enforce that the current session user holds one of `allowed_roles`.

    Returns a 403 `JSONResponse` to short-circuit the endpoint when the
    signed-in user's role is not permitted, or `None` to let the request
    proceed. Service-token callers (no session user) are always allowed —
    they are trusted automation (worker, seed), not role-bound end users.
    """

    user = current_user(request)
    if user is None:
        return None
    if user.roleLabel not in allowed_roles:
        return JSONResponse(
            status_code=403,
            content=Error(
                code="forbidden",
                message="Your role does not have permission to perform this action.",
                details={"requiredRoles": [role.value for role in allowed_roles]},
            ).model_dump(mode="json"),
        )
    return None
