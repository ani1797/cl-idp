from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi import Request
from fastapi.responses import JSONResponse

from app.auth import hash_password
from app.authz import require_roles
from app.db import DataStore, DocumentNotFoundError, DuplicateDocumentError
from app.models import (
    Error,
    User,
    UserCreateRequest,
    UserDocument,
    UserResetPasswordRequest,
    UserRole,
    UserUpdateRequest,
)
from app.routers.auth import public_user


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


def register_user_routes(application: FastAPI) -> None:
    @application.get("/users", response_model=list[User], tags=["users"])
    async def list_users_endpoint(request: Request) -> list[User] | JSONResponse:
        if (forbidden := require_roles(request, UserRole.IT_ADMIN)) is not None:
            return forbidden
        return [public_user(user) for user in data_store(application).list_users()]

    @application.post(
        "/users",
        response_model=User,
        status_code=201,
        responses={403: {"model": Error}, 409: {"model": Error}},
        tags=["users"],
    )
    async def create_user_endpoint(
        payload: UserCreateRequest, request: Request
    ) -> User | JSONResponse:
        if (forbidden := require_roles(request, UserRole.IT_ADMIN)) is not None:
            return forbidden
        now = datetime.now(UTC)
        user = UserDocument(
            id=str(uuid4()),
            email=str(payload.email).lower(),
            displayName=payload.displayName,
            roleLabel=payload.roleLabel,
            passwordHash=hash_password(payload.password),
            isActive=payload.isActive,
            createdAt=now,
            updatedAt=now,
        )
        try:
            created = data_store(application).create_user(user)
        except DuplicateDocumentError:
            return duplicate_email_response()
        return public_user(created)

    @application.patch(
        "/users/{userId}",
        response_model=User,
        responses={403: {"model": Error}, 404: {"model": Error}, 409: {"model": Error}},
        tags=["users"],
    )
    async def update_user_endpoint(
        userId: str, payload: UserUpdateRequest, request: Request
    ) -> User | JSONResponse:
        if (forbidden := require_roles(request, UserRole.IT_ADMIN)) is not None:
            return forbidden
        store = data_store(application)
        try:
            user = store.read_user(userId)
        except DocumentNotFoundError:
            return user_not_found_response()

        updates = payload.model_dump(exclude_unset=True)
        if "email" in updates:
            updates["email"] = str(updates["email"]).lower()
        updates["updatedAt"] = datetime.now(UTC)
        try:
            updated = store.update_user(user.model_copy(update=updates))
        except DuplicateDocumentError:
            return duplicate_email_response()
        return public_user(updated)

    @application.post(
        "/users/{userId}/reset-password",
        response_model=User,
        responses={403: {"model": Error}, 404: {"model": Error}},
        tags=["users"],
    )
    async def reset_user_password_endpoint(
        userId: str,
        payload: UserResetPasswordRequest,
        request: Request,
    ) -> User | JSONResponse:
        if (forbidden := require_roles(request, UserRole.IT_ADMIN)) is not None:
            return forbidden
        store = data_store(application)
        try:
            user = store.read_user(userId)
        except DocumentNotFoundError:
            return user_not_found_response()

        updated = store.update_user(
            user.model_copy(
                update={
                    "passwordHash": hash_password(payload.password),
                    "updatedAt": datetime.now(UTC),
                }
            )
        )
        return public_user(updated)


def user_not_found_response() -> JSONResponse:
    return error_response(
        status_code=404,
        code="user_not_found",
        message="The requested user was not found.",
    )


def duplicate_email_response() -> JSONResponse:
    return error_response(
        status_code=409,
        code="duplicate_user_email",
        message="A user with this email already exists.",
    )
