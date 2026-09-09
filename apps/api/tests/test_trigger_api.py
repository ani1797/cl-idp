from __future__ import annotations

import json
from datetime import UTC, datetime
from io import BytesIO
from typing import Any, cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

from app.db import CosmosService
from app.models import AnalyzerRef, BusinessProcessDocument, JobStatus, RoutingAnalyzerStatus
from app.storage import BlobService, QueueService


def test_trigger_returns_404_for_missing_process(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    missing_process_id = str(uuid4())

    response = api_client.post(
        f"/processes/{missing_process_id}/trigger",
        files={"file": ("invoice.pdf", pdf_bytes(2), "application/pdf")},
    )

    assert response.status_code == 404
    assert response.json()["code"] == "process_not_found"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue)


def test_trigger_returns_409_when_routing_analyzer_not_ready(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos, routing_status=RoutingAnalyzerStatus.BUILDING)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("invoice.pdf", pdf_bytes(2), "application/pdf")},
    )

    assert response.status_code == 409
    assert response.json()["code"] == "routing_analyzer_not_ready"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_rejects_unsupported_file_type(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("notes.txt", b"plain text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "unsupported_file_type"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_rejects_oversized_file(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)
    oversized_content = b"%PDF-1.4\n" + (b"0" * (20 * 1024 * 1024 + 1))

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("large.pdf", oversized_content, "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "file_too_large"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_rejects_pdf_over_page_limit(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("many-pages.pdf", pdf_bytes(21), "application/pdf")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "too_many_pages"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_rejects_multiple_files(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files=[
            ("file", ("first.pdf", pdf_bytes(1), "application/pdf")),
            ("file", ("second.pdf", pdf_bytes(1), "application/pdf")),
        ],
    )

    assert response.status_code == 400
    assert response.json()["code"] == "invalid_file_upload"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_rejects_multiframe_tiff_over_page_limit(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("many-pages.tiff", tiff_bytes(22), "image/tiff")},
    )

    assert response.status_code == 400
    assert response.json()["code"] == "too_many_pages"
    assert_no_trigger_artifacts(cosmos=cosmos, blob=blob, queue=queue, process_id=process.id)


def test_trigger_happy_path_creates_blob_job_and_queue_message(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)
    file_bytes = pdf_bytes(2)

    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": ("invoice.pdf", file_bytes, "application/pdf")},
    )

    assert response.status_code == 202
    assert set(response.json()) == {"jobId"}

    job_id = response.json()["jobId"]
    job = cosmos.read_job(process.id, job_id)
    assert job.status == JobStatus.QUEUED
    assert job.fileName == "invoice.pdf"
    assert job.contentType == "application/pdf"
    assert job.blobPath == f"{process.id}/{job_id}/invoice.pdf"
    assert job.correlationId
    assert job.submittedAt.tzinfo == UTC
    assert job.attempts == 0
    assert job.notificationSent is False
    assert job.completedAt is None
    assert job.detectedForm is None
    assert job.retryOfJobId is None
    assert job.pages is None
    assert job.fields is None
    assert job.fieldCount is None
    assert job.confidenceViolations is None
    assert job.error is None
    assert job.reviewedAt is None

    assert blob.list_blob_names(prefix=f"{process.id}/") == [job.blobPath]
    assert blob.download_bytes(job.blobPath) == file_bytes

    queue_messages = queue.receive_messages(max_messages=5)
    try:
        assert len(queue_messages) == 1
        queue_payload = json.loads(queue_messages[0].content)
    finally:
        for message in queue_messages:
            queue.delete_message(message)

    assert queue_payload == {
        "jobId": job_id,
        "processId": process.id,
        "correlationId": job.correlationId,
        "blobPath": job.blobPath,
        "routingAnalyzerId": cast(str, process.routingAnalyzerId),
        "confidenceThreshold": process.confidenceThreshold,
        "ownerEmail": process.ownerEmail,
    }


def backend_services(api_client: TestClient) -> tuple[CosmosService, BlobService, QueueService]:
    app = cast(FastAPI, api_client.app)
    return app.state.cosmos_service, app.state.blob_service, app.state.queue_service


def create_process(
    cosmos: CosmosService,
    *,
    process_id: str | None = None,
    routing_status: RoutingAnalyzerStatus = RoutingAnalyzerStatus.READY,
    routing_analyzer_id: str | None = "idp_r_ready-demo",
) -> BusinessProcessDocument:
    now = datetime.now(UTC)
    return cosmos.upsert_process(
        BusinessProcessDocument(
            id=process_id or str(uuid4()),
            name=f"Process {uuid4()}",
            description="Synthetic process for trigger tests",
            allowedAnalyzerIds=["prebuilt-invoice"],
            allowedAnalyzers=[AnalyzerRef(id="prebuilt-invoice", name="Invoice")],
            confidenceThreshold=0.8,
            ownerEmail="owner@example.com",
            routingAnalyzerStatus=routing_status,
            routingAnalyzerError=None,
            routingAnalyzerId=routing_analyzer_id,
            derivedAnalyzerIds={},
            createdAt=now,
            updatedAt=now,
        )
    )


def assert_no_trigger_artifacts(
    *,
    cosmos: CosmosService,
    blob: BlobService,
    queue: QueueService,
    process_id: str | None = None,
) -> None:
    jobs: list[Any]
    if process_id is None:
        jobs = list(cosmos._jobs.query_items("SELECT c.id FROM c", enable_cross_partition_query=True))
        blob_names = blob.list_blob_names()
    else:
        jobs = cosmos.list_jobs_for_process(process_id)
        blob_names = blob.list_blob_names(prefix=f"{process_id}/")

    assert jobs == []
    assert blob_names == []

    queue_messages = queue.receive_messages(max_messages=5)
    try:
        assert queue_messages == []
    finally:
        for message in queue_messages:
            queue.delete_message(message)


def pdf_bytes(page_count: int) -> bytes:
    writer = PdfWriter()
    for _ in range(page_count):
        writer.add_blank_page(width=612, height=792)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def tiff_bytes(frame_count: int) -> bytes:
    frames = [Image.new("RGB", (8, 8), color=(index % 255, 0, 0)) for index in range(frame_count)]
    output = BytesIO()
    frames[0].save(output, format="TIFF", save_all=True, append_images=frames[1:])
    return output.getvalue()
