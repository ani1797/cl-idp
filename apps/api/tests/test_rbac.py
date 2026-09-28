from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.auth import hash_password
from app.models import JobDocument, JobStatus, NumberField, UserDocument, UserRole
from tests.test_review_api import backend_cosmos
from tests.test_trigger_api import create_process


def make_user(*, role_label: UserRole, email: str, password: str = "correct-password") -> UserDocument:
    now = datetime.now(UTC).replace(microsecond=0)
    return UserDocument(
        id=str(uuid4()),
        email=email,
        displayName=role_label.value,
        roleLabel=role_label,
        passwordHash=hash_password(password),
        isActive=True,
        createdAt=now,
        updatedAt=now,
    )


def login_as(api_client: TestClient, *, role_label: UserRole) -> None:
    """Create a fresh user with `role_label` and switch `api_client`'s cookie
    jar to their session. Also strips the service-token header for the
    duration of the caller's requests, since the auth middleware treats a
    matching service token as a trusted-automation bypass that would
    otherwise short-circuit role enforcement entirely."""

    app = cast(FastAPI, api_client.app)
    slug = role_label.value.lower().replace(" ", ".")
    email = f"{slug}-{uuid4().hex[:8]}@example.com"
    user = make_user(role_label=role_label, email=email)
    app.state.data_store.create_user(user)

    api_client.headers.pop("X-Service-Token", None)
    response = api_client.post("/auth/login", json={"email": email, "password": "correct-password"})
    assert response.status_code == 200


def make_reviewable_job(process_id: str) -> JobDocument:
    now = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)
    return JobDocument(
        id=f"job-{uuid4().hex[:8]}",
        processId=process_id,
        correlationId="rbac-correlation",
        fileName="invoice.pdf",
        contentType="application/pdf",
        blobPath=f"{process_id}/rbac-job/invoice.pdf",
        status=JobStatus.SUCCEEDED,
        submittedAt=now,
        completedAt=now + timedelta(seconds=10),
        detectedForm="prebuilt-invoice",
        detectedFormName="Invoice",
        unclassified=False,
        retryOfJobId=None,
        attempts=1,
        pages=None,
        fields=[
            NumberField(
                name="invoiceTotal",
                path="/invoiceTotal",
                type="number",
                value=100.0,
                confidence=0.62,
                boundingBox=None,
                page=1,
                reviewedValue=None,
            )
        ],
        fieldCount=None,
        confidenceViolations=["/invoiceTotal"],
        notificationSent=True,
        reviewedAt=None,
        error=None,
    )


def process_payload(**overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "name": f"RBAC Process {uuid4()}",
        "description": "Synthetic process for RBAC tests",
        "allowedAnalyzerIds": ["prebuilt-invoice"],
        "confidenceThreshold": 0.8,
        "ownerEmail": "owner@example.com",
    }
    payload.update(overrides)
    return payload


def test_end_user_cannot_create_process(api_client: TestClient) -> None:
    login_as(api_client, role_label=UserRole.END_USER)

    response = api_client.post("/processes", json=process_payload())

    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_reviewer_cannot_create_process(api_client: TestClient) -> None:
    login_as(api_client, role_label=UserRole.REVIEWER)

    response = api_client.post("/processes", json=process_payload())

    assert response.status_code == 403


def test_it_admin_can_create_process(api_client: TestClient) -> None:
    login_as(api_client, role_label=UserRole.IT_ADMIN)

    response = api_client.post("/processes", json=process_payload())

    # The test environment's CU client isn't live, so full success (201)
    # requires `@pytest.mark.live`; here we only assert the request passed
    # the RBAC gate (i.e. it was not rejected with 403) and proceeded to
    # attempt analyzer resolution, which is exercised by the existing
    # `test_create_list_and_get_process` live test.
    assert response.status_code != 403


def test_end_user_cannot_delete_process(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    login_as(api_client, role_label=UserRole.END_USER)

    response = api_client.delete(f"/processes/{process.id}")

    assert response.status_code == 403


def test_end_user_cannot_manage_users(api_client: TestClient) -> None:
    login_as(api_client, role_label=UserRole.END_USER)

    list_response = api_client.get("/users")
    create_response = api_client.post(
        "/users",
        json={
            "email": "new.user@example.com",
            "displayName": "New User",
            "roleLabel": "End User",
            "password": "correct-password",
        },
    )

    assert list_response.status_code == 403
    assert create_response.status_code == 403


def test_it_admin_can_manage_users(api_client: TestClient) -> None:
    login_as(api_client, role_label=UserRole.IT_ADMIN)

    response = api_client.get("/users")

    assert response.status_code == 200


def test_end_user_cannot_review_job(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_reviewable_job(process.id))
    login_as(api_client, role_label=UserRole.END_USER)

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "500.00"}]},
    )

    assert response.status_code == 403


def test_reviewer_can_review_job(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_reviewable_job(process.id))
    login_as(api_client, role_label=UserRole.REVIEWER)

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "500.00"}]},
    )

    assert response.status_code == 200


def test_end_user_cannot_retry_job(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_reviewable_job(process.id))
    login_as(api_client, role_label=UserRole.END_USER)

    response = api_client.post(f"/processes/{process.id}/jobs/{job.id}/retry")

    assert response.status_code == 403


def test_unknown_role_label_is_rejected_at_the_api_boundary(api_client: TestClient) -> None:
    response = api_client.post(
        "/users",
        json={
            "email": "custom.role@example.com",
            "displayName": "Custom Role",
            "roleLabel": "Operations Lead",
            "password": "correct-password",
        },
    )

    # Unknown role values are rejected as a validation error before the
    # handler runs; this app maps `RequestValidationError` to 400 rather
    # than FastAPI's default 422 (see `request_validation_exception_handler`).
    assert response.status_code == 400
    assert response.json()["code"] == "bad_request"
