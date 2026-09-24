from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import DataStore, DocumentNotFoundError
from app.models import (
    ArrayField,
    Field,
    JobDocument,
    JobStatus,
    NumberField,
    ObjectField,
    StringField,
)
from tests.test_trigger_api import create_process


def test_review_single_path_sets_reviewed_value_and_clears_violation(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "1024.50"}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["fieldCount"] == 3
    assert body["fields"][0]["value"] == 100.0
    assert body["fields"][0]["reviewedValue"] == "1024.50"
    assert body["confidenceViolations"] == ["/LineItems/0/description"]
    assert body["reviewedAt"] is not None

    stored = cosmos.read_job(process.id, job.id)
    assert stored.fields is not None
    assert cast(NumberField, stored.fields[0]).reviewedValue == "1024.50"
    assert stored.reviewedAt is not None


def test_review_updates_multiple_paths_in_one_call(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={
            "fields": [
                {"path": "/invoiceTotal", "value": "1024.50"},
                {"path": "/LineItems/0/description", "value": "Approved description"},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["confidenceViolations"] == []
    assert body["fields"][0]["reviewedValue"] == "1024.50"
    assert body["fields"][1]["items"][0]["properties"]["description"]["reviewedValue"] == "Approved description"


def test_review_supports_multiple_passes_without_moving_reviewed_at(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))

    first_response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "1024.50"}]},
    )
    assert first_response.status_code == 200
    first_reviewed_at = first_response.json()["reviewedAt"]

    second_response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/LineItems/0/description", "value": "Approved description"}]},
    )

    assert second_response.status_code == 200
    body = second_response.json()
    assert body["reviewedAt"] == first_reviewed_at
    assert body["confidenceViolations"] == []
    assert body["fields"][0]["reviewedValue"] == "1024.50"
    assert body["fields"][1]["items"][0]["properties"]["description"]["reviewedValue"] == "Approved description"


def test_review_rejects_unknown_path_without_modifying_job(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))
    before = cosmos.read_job(process.id, job.id).model_dump(mode="json")

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/doesNotExist", "value": "1024.50"}]},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "unknown_field_path"
    after = cosmos.read_job(process.id, job.id).model_dump(mode="json")
    assert after == before


def test_review_rejects_container_path(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))

    response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/LineItems", "value": "not allowed"}]},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "unknown_field_path"
    stored = cosmos.read_job(process.id, job.id)
    assert stored.reviewedAt is None
    assert stored.confidenceViolations == ["/invoiceTotal", "/LineItems/0/description"]


def test_review_allows_re_reviewing_same_path_without_moving_reviewed_at(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    job = cosmos.upsert_job(make_review_job(process.id))

    first_response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "1024.50"}]},
    )
    assert first_response.status_code == 200
    first_reviewed_at = first_response.json()["reviewedAt"]

    second_response = api_client.put(
        f"/processes/{process.id}/jobs/{job.id}/review",
        json={"fields": [{"path": "/invoiceTotal", "value": "2048.00"}]},
    )

    assert second_response.status_code == 200
    body = second_response.json()
    assert body["reviewedAt"] == first_reviewed_at
    assert body["fields"][0]["reviewedValue"] == "2048.00"
    assert body["confidenceViolations"] == ["/LineItems/0/description"]


def backend_cosmos(api_client: TestClient) -> DataStore:
    app = api_client.app
    assert isinstance(app, FastAPI)
    return cast(DataStore, app.state.data_store)


def make_review_job(process_id: str) -> JobDocument:
    now = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)
    return JobDocument(
        id="review-job",
        processId=process_id,
        correlationId="review-correlation",
        fileName="invoice.pdf",
        contentType="application/pdf",
        blobPath=f"{process_id}/review-job/invoice.pdf",
        status=JobStatus.SUCCEEDED,
        submittedAt=now,
        completedAt=now + timedelta(seconds=10),
        detectedForm="prebuilt-invoice",
        detectedFormName="Invoice",
        unclassified=False,
        retryOfJobId=None,
        attempts=1,
        pages=None,
        fields=review_fields(),
        fieldCount=None,
        confidenceViolations=["/invoiceTotal", "/LineItems/0/description"],
        notificationSent=True,
        reviewedAt=None,
        error=None,
    )


def review_fields() -> list[Field]:
    return [
        NumberField(
            name="invoiceTotal",
            path="/invoiceTotal",
            type="number",
            value=100.0,
            confidence=0.62,
            boundingBox=None,
            page=1,
            reviewedValue=None,
        ),
        ArrayField(
            name="LineItems",
            path="/LineItems",
            type="array",
            items=[
                ObjectField(
                    name="0",
                    path="/LineItems/0",
                    type="object",
                    properties={
                        "description": StringField(
                            name="description",
                            path="/LineItems/0/description",
                            type="string",
                            value="Original description",
                            confidence=0.55,
                            boundingBox=None,
                            page=1,
                            reviewedValue=None,
                        ),
                        "quantity": NumberField(
                            name="quantity",
                            path="/LineItems/0/quantity",
                            type="number",
                            value=2.0,
                            confidence=0.95,
                            boundingBox=None,
                            page=1,
                            reviewedValue=None,
                        ),
                    },
                )
            ],
        ),
    ]
