from __future__ import annotations

from typing import cast

from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse

from app.auth import issue_api_token, issue_session_token, resolve_principal, verify_password
from app.db import DataStore
from app.models import Error, LoginRequest, TokenResponse, User, UserDocument


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=Error(code=code, message=message, details=details).model_dump(mode="json"),
    )


def data_store(application: FastAPI) -> DataStore:
    return cast(DataStore, application.state.data_store)


def public_user(user: UserDocument) -> User:
    return User.model_validate(user.model_dump(exclude={"passwordHash"}))


def register_auth_routes(application: FastAPI) -> None:
    @application.post(
        "/auth/login",
        response_model=User,
        responses={401: {"model": Error}},
        tags=["auth"],
        openapi_extra={"security": []},
    )
    async def login_endpoint(payload: LoginRequest, response: Response) -> User | JSONResponse:
        user = data_store(application).find_user_by_email(str(payload.email))
        if user is None or not user.isActive or not verify_password(payload.password, user.passwordHash):
            return error_response(
                status_code=401,
                code="unauthorized",
                message="Invalid email or password.",
            )

        settings = application.state.settings
        response.set_cookie(
            key=settings.session_cookie_name,
            value=issue_session_token(user, settings),
            max_age=settings.jwt_expiry_minutes * 60,
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite=settings.session_cookie_samesite,
        )
        return public_user(user)

    @application.post(
        "/auth/logout",
        status_code=204,
        tags=["auth"],
        openapi_extra={"security": []},
    )
    async def logout_endpoint(response: Response) -> Response:
        settings = application.state.settings
        response.delete_cookie(
            key=settings.session_cookie_name,
            httponly=True,
            secure=settings.session_cookie_secure,
            samesite=settings.session_cookie_samesite,
        )
        response.status_code = 204
        return response

    @application.post(
        "/auth/token",
        response_model=TokenResponse,
        responses={401: {"model": Error}},
        tags=["auth"],
        openapi_extra={"security": []},
    )
    async def issue_token_endpoint(payload: LoginRequest) -> TokenResponse | JSONResponse:
        """Mints a short-lived `Authorization: Bearer` token for scripts and
        ad-hoc testing. Unlike `/auth/login`, this sets no cookie — the token
        is returned directly in the response body, since it is meant to be
        copied into a non-browser client. The token carries the caller's own
        role, so it can never exceed what that user could already do.
        """

        user = data_store(application).find_user_by_email(str(payload.email))
        if user is None or not user.isActive or not verify_password(payload.password, user.passwordHash):
            return error_response(
                status_code=401,
                code="unauthorized",
                message="Invalid email or password.",
            )

        settings = application.state.settings
        access_token, expires_in = issue_api_token(user, settings)
        return TokenResponse(accessToken=access_token, expiresIn=expires_in)

    @application.get(
        "/auth/me",
        response_model=User,
        responses={401: {"model": Error}},
        tags=["auth"],
    )
    async def me_endpoint(request: Request) -> User | JSONResponse:
        settings = application.state.settings
        principal = resolve_principal(request, settings, data_store(application))
        if principal is None or principal.user is None:
            return error_response(
                status_code=401,
                code="unauthorized",
                message="Authentication is required.",
            )
        return public_user(principal.user)
