from __future__ import annotations

from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import hash_password, verify_password
from app.models import UserDocument
from tests.conftest import TEST_SERVICE_TOKEN


def make_user(**overrides: object) -> UserDocument:
    now = datetime.now(UTC).replace(microsecond=0)
    user_id = str(overrides.pop("id", uuid4()))
    defaults: dict[str, object] = {
        "id": user_id,
        "email": "reviewer@example.com",
        "displayName": "Reviewer",
        "roleLabel": "Reviewer",
        "passwordHash": hash_password("correct-password"),
        "isActive": True,
        "createdAt": now,
        "updatedAt": now,
    }
    defaults.update(overrides)
    return UserDocument.model_validate(defaults)


def test_password_hashing_round_trip() -> None:
    password_hash = hash_password("correct-password")

    assert password_hash != "correct-password"
    assert verify_password("correct-password", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_login_success_sets_cookie_and_returns_public_user(api_client: TestClient) -> None:
    app = cast(FastAPI, api_client.app)
    app.state.data_store.create_user(make_user())

    response = api_client.post(
        "/auth/login",
        json={"email": "reviewer@example.com", "password": "correct-password"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "reviewer@example.com"
    assert body["roleLabel"] == "Reviewer"
    assert "passwordHash" not in body
    assert app.state.settings.session_cookie_name in response.cookies
    assert "httponly" in response.headers["set-cookie"].lower()
    assert "samesite=lax" in response.headers["set-cookie"].lower()


def test_login_failure_does_not_set_cookie(api_client: TestClient) -> None:
    app = cast(FastAPI, api_client.app)
    app.state.data_store.create_user(make_user())

    response = api_client.post(
        "/auth/login",
        json={"email": "reviewer@example.com", "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["code"] == "unauthorized"
    assert app.state.settings.session_cookie_name not in response.cookies


def test_auth_me_with_and_without_cookie(api_client: TestClient) -> None:
    app = cast(FastAPI, api_client.app)
    app.state.data_store.create_user(make_user())

    missing = api_client.get("/auth/me")
    login = api_client.post(
        "/auth/login",
        json={"email": "reviewer@example.com", "password": "correct-password"},
    )
    present = api_client.get("/auth/me")

    assert missing.status_code == 401
    assert login.status_code == 200
    assert present.status_code == 200
    assert present.json()["email"] == "reviewer@example.com"
    assert "passwordHash" not in present.json()


def test_guard_rejects_protected_route_without_auth(api_client: TestClient) -> None:
    api_client.headers.pop("X-Service-Token", None)

    response = api_client.get("/processes")

    assert response.status_code == 401
    assert response.json() == {
        "code": "unauthorized",
        "message": "Authentication is required.",
        "details": None,
    }


def test_healthz_stays_open_without_auth(api_client: TestClient) -> None:
    api_client.headers.pop("X-Service-Token", None)

    response = api_client.get("/healthz")

    assert response.status_code in {200, 503}
    assert "status" in response.json()


def test_service_token_allows_protected_route(api_client: TestClient) -> None:
    response = api_client.get("/processes", headers={"X-Service-Token": TEST_SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json() == []


def test_user_crud_and_reset_password(api_client: TestClient) -> None:
    create = api_client.post(
        "/users",
        json={
            "email": "admin@example.com",
            "displayName": "Admin",
            "roleLabel": "IT Admin",
            "password": "initial-password",
        },
    )
    user_id = create.json()["id"]

    listed = api_client.get("/users")
    updated = api_client.patch(
        f"/users/{user_id}",
        json={"displayName": "Admin Updated", "roleLabel": "Reviewer", "isActive": False},
    )
    reset = api_client.post(
        f"/users/{user_id}/reset-password",
        json={"password": "updated-password"},
    )
    duplicate = api_client.post(
        "/users",
        json={
            "email": "ADMIN@example.com",
            "displayName": "Duplicate",
            "roleLabel": "Reviewer",
            "password": "initial-password",
        },
    )

    assert create.status_code == 201
    assert "passwordHash" not in create.json()
    assert listed.status_code == 200
    assert [user["id"] for user in listed.json()] == [user_id]
    assert updated.status_code == 200
    assert updated.json()["displayName"] == "Admin Updated"
    assert updated.json()["roleLabel"] == "Reviewer"
    assert updated.json()["isActive"] is False
    assert reset.status_code == 200
    assert "passwordHash" not in reset.json()
    stored = cast(FastAPI, api_client.app).state.data_store.read_user(user_id)
    assert verify_password("updated-password", stored.passwordHash)
    assert duplicate.status_code == 409
