from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import CosmosService
from app.models import (
    ArrayField,
    Field,
    JobDocument,
    JobStatus,
    NumberField,
    ObjectField,
    PageInfo,
    PageUnit,
    StringField,
)
from tests.test_trigger_api import create_process


def test_list_jobs_supports_all_filters_and_omits_fields(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    jobs = seed_query_jobs(cosmos, process.id)

    status_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params=[("status", "succeeded"), ("status", "failed")],
    )

    assert status_response.status_code == 200
    status_items = status_response.json()
    assert [item["id"] for item in status_items] == [
        jobs["unclassified"].id,
        jobs["nested"].id,
        jobs["failed"].id,
        jobs["aggregate_pass"].id,
        jobs["reviewed"].id,
        jobs["low_confidence"].id,
    ]
    assert {item["status"] for item in status_items} == {"succeeded", "failed"}
    assert all("fields" not in item for item in status_items)

    detected_form_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params=[("detectedForm", "prebuilt-invoice")],
    )
    assert detected_form_response.status_code == 200
    assert [item["id"] for item in detected_form_response.json()] == [
        jobs["aggregate_pass"].id,
        jobs["reviewed"].id,
        jobs["low_confidence"].id,
    ]

    has_violations_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"hasViolations": "true"},
    )
    assert has_violations_response.status_code == 200
    assert [item["id"] for item in has_violations_response.json()] == [jobs["low_confidence"].id]

    reviewed_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"reviewed": "true"},
    )
    assert reviewed_response.status_code == 200
    assert [item["id"] for item in reviewed_response.json()] == [jobs["reviewed"].id]

    unclassified_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"unclassified": "true"},
    )
    assert unclassified_response.status_code == 200
    assert [item["id"] for item in unclassified_response.json()] == [jobs["unclassified"].id]

    file_name_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"fileName": "INVOICE"},
    )
    assert file_name_response.status_code == 200
    assert [item["id"] for item in file_name_response.json()] == [
        jobs["aggregate_pass"].id,
        jobs["reviewed"].id,
        jobs["low_confidence"].id,
    ]

    submitted_from = isoformat(jobs["reviewed"].submittedAt)
    submitted_to = isoformat(jobs["nested"].submittedAt)
    submitted_range_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"submittedFrom": submitted_from, "submittedTo": submitted_to},
    )
    assert submitted_range_response.status_code == 200
    assert [item["id"] for item in submitted_range_response.json()] == [
        jobs["nested"].id,
        jobs["failed"].id,
        jobs["aggregate_pass"].id,
        jobs["reviewed"].id,
    ]

    combination_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params=[
            ("status", "succeeded"),
            ("detectedForm", "prebuilt-invoice"),
            ("hasViolations", "true"),
            ("reviewed", "false"),
            ("unclassified", "false"),
            ("fileName", "lowconfidence"),
            ("submittedFrom", isoformat(jobs["queued"].submittedAt)),
            ("submittedTo", isoformat(jobs["unclassified"].submittedAt)),
            ("limit", "10"),
        ],
    )
    assert combination_response.status_code == 200
    assert [item["id"] for item in combination_response.json()] == [jobs["low_confidence"].id]

    nested_item = next(item for item in status_items if item["id"] == jobs["nested"].id)
    assert nested_item["fieldCount"] == 50
    assert nested_item["averageConfidence"] == pytest.approx(0.955)

    aggregate_pass_item = next(item for item in status_items if item["id"] == jobs["aggregate_pass"].id)
    assert aggregate_pass_item["confidenceViolations"] == []
    assert aggregate_pass_item["averageConfidence"] == pytest.approx(0.75)


def test_jobs_summary_uses_same_filters(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    jobs = seed_query_jobs(cosmos, process.id)

    response = api_client.get(
        f"/processes/{process.id}/jobs/summary",
        params=[
            ("status", "succeeded"),
            ("submittedFrom", isoformat(jobs["low_confidence"].submittedAt)),
            ("submittedTo", isoformat(jobs["unclassified"].submittedAt)),
        ],
    )

    assert response.status_code == 200
    assert response.json() == {
        "total": 5,
        "needsReview": 1,
        "failed": 0,
        "unclassified": 1,
        "totalEstimatedCostUsd": 0.0,
    }


def test_jobs_summary_counts_exceed_list_limit(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    base_time = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)

    for index in range(120):
        submitted_at = base_time + timedelta(minutes=index)
        cosmos.upsert_job(
            make_job(
                process_id=process.id,
                file_name=f"needs-review-{index:03d}.pdf",
                status=JobStatus.SUCCEEDED,
                submitted_at=submitted_at,
                completed_at=submitted_at + timedelta(seconds=5),
                detected_form="prebuilt-invoice",
                detected_form_name="Invoice",
                unclassified=False,
                fields=[scalar_field(f"/total{index}", 0.4)],
                confidence_violations=[f"/total{index}"],
            )
        )

    list_response = api_client.get(
        f"/processes/{process.id}/jobs",
        params={"hasViolations": "true", "limit": "10"},
    )
    summary_response = api_client.get(
        f"/processes/{process.id}/jobs/summary",
        params={"hasViolations": "true"},
    )

    assert list_response.status_code == 200
    assert len(list_response.json()) == 10
    assert summary_response.status_code == 200
    assert summary_response.json() == {
        "total": 120,
        "needsReview": 120,
        "failed": 0,
        "unclassified": 0,
        "totalEstimatedCostUsd": 0.0,
    }


def test_get_job_returns_full_document(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    jobs = seed_query_jobs(cosmos, process.id)

    response = api_client.get(f"/processes/{process.id}/jobs/{jobs['nested'].id}")

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == jobs["nested"].id
    assert "fields" in body
    assert body["fieldCount"] == 50
    assert body["averageConfidence"] == pytest.approx(0.955)
    assert body["fields"][0]["path"] == "/LineItems"
    assert len(body["fields"][0]["items"]) == 25


def test_get_job_returns_estimated_cost_based_on_page_count(api_client: TestClient) -> None:
    from app.pricing import estimate_document_cost_usd

    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    submitted_at = datetime(2024, 1, 1, tzinfo=UTC)
    job = make_job(
        process_id=process.id,
        file_name="three-pages.pdf",
        status=JobStatus.SUCCEEDED,
        submitted_at=submitted_at,
        completed_at=submitted_at,
        detected_form="prebuilt-invoice",
        detected_form_name="Invoice",
        unclassified=False,
        pages=[page_info(page) for page in range(1, 4)],
    )
    cosmos.upsert_job(job)

    response = api_client.get(f"/processes/{process.id}/jobs/{job.id}")

    assert response.status_code == 200
    assert response.json()["estimatedCostUsd"] == pytest.approx(estimate_document_cost_usd(3))


def test_jobs_summary_totals_estimated_cost_across_matching_jobs(api_client: TestClient) -> None:
    from app.pricing import estimate_document_cost_usd

    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    submitted_at = datetime(2024, 1, 1, tzinfo=UTC)
    cosmos.upsert_job(
        make_job(
            process_id=process.id,
            file_name="two-pages.pdf",
            status=JobStatus.SUCCEEDED,
            submitted_at=submitted_at,
            completed_at=submitted_at,
            detected_form="prebuilt-invoice",
            detected_form_name="Invoice",
            unclassified=False,
            pages=[page_info(page) for page in range(1, 3)],
        )
    )
    cosmos.upsert_job(
        make_job(
            process_id=process.id,
            file_name="five-pages.pdf",
            status=JobStatus.SUCCEEDED,
            submitted_at=submitted_at,
            completed_at=submitted_at,
            detected_form="prebuilt-invoice",
            detected_form_name="Invoice",
            unclassified=False,
            pages=[page_info(page) for page in range(1, 6)],
        )
    )

    response = api_client.get(f"/processes/{process.id}/jobs/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 2
    assert body["totalEstimatedCostUsd"] == pytest.approx(estimate_document_cost_usd(7))


def test_job_endpoints_return_404_for_missing_or_wrong_process(api_client: TestClient) -> None:
    cosmos = backend_cosmos(api_client)
    process = create_process(cosmos)
    other_process = create_process(cosmos)
    jobs = seed_query_jobs(cosmos, process.id)

    missing_process_response = api_client.get(f"/processes/{uuid4()}/jobs")
    wrong_process_response = api_client.get(f"/processes/{other_process.id}/jobs/{jobs['nested'].id}")

    assert missing_process_response.status_code == 404
    assert missing_process_response.json()["code"] == "process_not_found"
    assert wrong_process_response.status_code == 404
    assert wrong_process_response.json()["code"] == "job_not_found"


def backend_cosmos(api_client: TestClient) -> CosmosService:
    application = api_client.app
    assert isinstance(application, FastAPI)
    return cast(CosmosService, application.state.cosmos_service)


def seed_query_jobs(cosmos: CosmosService, process_id: str) -> dict[str, JobDocument]:
    base_time = datetime(2026, 1, 15, 9, 0, 0, tzinfo=UTC)
    jobs = {
        "queued": make_job(
            process_id=process_id,
            file_name="queued-upload.pdf",
            status=JobStatus.QUEUED,
            submitted_at=base_time + timedelta(minutes=1),
        ),
        "running": make_job(
            process_id=process_id,
            file_name="running-receipt.pdf",
            status=JobStatus.RUNNING,
            submitted_at=base_time + timedelta(minutes=2),
        ),
        "low_confidence": make_job(
            process_id=process_id,
            file_name="Invoice-LowConfidence.PDF",
            status=JobStatus.SUCCEEDED,
            submitted_at=base_time + timedelta(minutes=3),
            completed_at=base_time + timedelta(minutes=3, seconds=6),
            detected_form="prebuilt-invoice",
            detected_form_name="Invoice",
            unclassified=False,
            fields=[scalar_field("/invoiceTotal", 0.62)],
            confidence_violations=["/invoiceTotal"],
        ),
        "reviewed": make_job(
            process_id=process_id,
            file_name="reviewed-invoice.pdf",
            status=JobStatus.SUCCEEDED,
            submitted_at=base_time + timedelta(minutes=4),
            completed_at=base_time + timedelta(minutes=4, seconds=5),
            detected_form="prebuilt-invoice",
            detected_form_name="Invoice",
            unclassified=False,
            fields=[
                scalar_field("/invoiceNumber", 0.94),
                scalar_field("/invoiceDate", 0.91),
            ],
            confidence_violations=[],
            reviewed_at=base_time + timedelta(minutes=5),
        ),
        "aggregate_pass": make_job(
            process_id=process_id,
            file_name="invoice-aggregate-pass.pdf",
            status=JobStatus.SUCCEEDED,
            submitted_at=base_time + timedelta(minutes=5),
            completed_at=base_time + timedelta(minutes=5, seconds=2),
            detected_form="prebuilt-invoice",
            detected_form_name="Invoice",
            unclassified=False,
            fields=[
                scalar_field("/invoiceTotal", 0.5),
                scalar_field("/invoiceDate", 1.0),
            ],
            confidence_violations=[],
        ),
        "failed": make_job(
            process_id=process_id,
            file_name="expense-report.pdf",
            status=JobStatus.FAILED,
            submitted_at=base_time + timedelta(minutes=6),
            completed_at=base_time + timedelta(minutes=6, seconds=4),
            error="Content Understanding timed out.",
        ),
        "nested": make_job(
            process_id=process_id,
            file_name="line-items.pdf",
            status=JobStatus.SUCCEEDED,
            submitted_at=base_time + timedelta(minutes=7),
            completed_at=base_time + timedelta(minutes=7, seconds=7),
            detected_form="custom-line-items",
            detected_form_name="Line Items",
            unclassified=False,
            fields=[nested_line_items_field(25)],
            confidence_violations=[],
        ),
        "unclassified": make_job(
            process_id=process_id,
            file_name="mystery-document.png",
            status=JobStatus.SUCCEEDED,
            submitted_at=base_time + timedelta(minutes=8),
            completed_at=base_time + timedelta(minutes=8, seconds=3),
            unclassified=True,
            fields=[],
            confidence_violations=[],
        ),
    }
    return {name: cosmos.upsert_job(job) for name, job in jobs.items()}


def make_job(
    *,
    process_id: str,
    file_name: str,
    status: JobStatus,
    submitted_at: datetime,
    completed_at: datetime | None = None,
    detected_form: str | None = None,
    detected_form_name: str | None = None,
    unclassified: bool | None = None,
    fields: list[Field] | None = None,
    confidence_violations: list[str] | None = None,
    reviewed_at: datetime | None = None,
    error: str | None = None,
    pages: list[PageInfo] | None = None,
) -> JobDocument:
    return JobDocument(
        id=str(uuid4()),
        processId=process_id,
        correlationId=str(uuid4()),
        fileName=file_name,
        contentType="application/pdf" if file_name.lower().endswith(".pdf") else "image/png",
        blobPath=f"{process_id}/{uuid4()}/{file_name}",
        status=status,
        submittedAt=submitted_at,
        completedAt=completed_at,
        detectedForm=detected_form,
        detectedFormName=detected_form_name,
        unclassified=unclassified,
        retryOfJobId=None,
        attempts=1 if status in {JobStatus.SUCCEEDED, JobStatus.FAILED} else 0,
        pages=pages,
        fields=fields,
        fieldCount=None,
        confidenceViolations=confidence_violations,
        notificationSent=False,
        reviewedAt=reviewed_at,
        error=error,
    )


def page_info(page: int) -> PageInfo:
    return PageInfo(page=page, width=8.5, height=11.0, unit=PageUnit.INCH, angle=0.0)


def scalar_field(path: str, confidence: float) -> NumberField:
    name = path.removeprefix("/")
    return NumberField(
        name=name,
        path=path,
        type="number",
        value=100.0,
        confidence=confidence,
        boundingBox=None,
        page=1,
        reviewedValue=None,
    )


def nested_line_items_field(item_count: int) -> ArrayField:
    return ArrayField(
        name="LineItems",
        path="/LineItems",
        type="array",
        items=[
            ObjectField(
                name=str(index),
                path=f"/LineItems/{index}",
                type="object",
                properties={
                    "description": StringField(
                        name="description",
                        path=f"/LineItems/{index}/description",
                        type="string",
                        value=f"Item {index}",
                        confidence=0.95,
                        boundingBox=None,
                        page=1,
                        reviewedValue=None,
                    ),
                    "quantity": NumberField(
                        name="quantity",
                        path=f"/LineItems/{index}/quantity",
                        type="number",
                        value=float(index + 1),
                        confidence=0.96,
                        boundingBox=None,
                        page=1,
                        reviewedValue=None,
                    ),
                },
            )
            for index in range(item_count)
        ],
    )


def isoformat(value: datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def test_compute_average_confidence_excludes_missing_and_averages_nested_leaves() -> None:
    from app.routers.jobs import compute_average_confidence

    assert compute_average_confidence(None) is None
    assert compute_average_confidence([]) is None

    no_confidence_field = StringField(
        name="note",
        path="/note",
        type="string",
        value="unscored",
        confidence=None,
        boundingBox=None,
        page=None,
        reviewedValue=None,
    )
    assert compute_average_confidence([no_confidence_field]) is None

    assert compute_average_confidence(
        [scalar_field("/a", 0.5), scalar_field("/b", 1.0)]
    ) == pytest.approx(0.75)

    mixed_missing = [scalar_field("/a", 0.4), no_confidence_field]
    assert compute_average_confidence(mixed_missing) == pytest.approx(0.4)

    assert compute_average_confidence([nested_line_items_field(2)]) == pytest.approx(0.955)
