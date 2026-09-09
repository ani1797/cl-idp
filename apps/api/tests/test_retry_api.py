from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.db import CosmosService
from app.models import JobDocument, JobQueueMessage, JobStatus
from app.storage import BlobService, QueueService
from app.worker.main import process_next_message
from tests.test_trigger_api import create_process, pdf_bytes
from tests.test_worker_pipeline import FakeCuClient, load_fixture, make_dependencies


def test_retry_failed_job_creates_new_job_and_reuses_original_blob(api_client: TestClient) -> None:
    cosmos, blob, queue = backend_services(api_client)
    process = create_process(cosmos)
    original_content = pdf_bytes(1)
    failed_job = seed_failed_job(cosmos, blob, process.id, content=original_content)
    before_blob_names = blob.list_blob_names(prefix=f"{process.id}/")

    response = api_client.post(f"/processes/{process.id}/jobs/{failed_job.id}/retry")

    assert response.status_code == 202
    retry_job_id = response.json()["jobId"]
    retried_job = cosmos.read_job(process.id, retry_job_id)
    original_job = cosmos.read_job(process.id, failed_job.id)

    assert retried_job.id != failed_job.id
    assert retried_job.correlationId != failed_job.correlationId
    assert retried_job.status == JobStatus.QUEUED
    assert retried_job.retryOfJobId == failed_job.id
    assert retried_job.blobPath == failed_job.blobPath
    assert retried_job.fileName == failed_job.fileName
    assert retried_job.contentType == failed_job.contentType
    assert retried_job.fields is None
    assert retried_job.confidenceViolations is None
    assert retried_job.reviewedAt is None
    assert retried_job.error is None

    assert original_job.status == JobStatus.FAILED
    assert original_job.retryOfJobId is None
    assert original_job.error == "Content Understanding timed out."

    after_blob_names = blob.list_blob_names(prefix=f"{process.id}/")
    assert after_blob_names == before_blob_names == [failed_job.blobPath]
    assert blob.download_bytes(failed_job.blobPath) == original_content

    queue_messages = queue.receive_messages(max_messages=1)
    try:
        assert len(queue_messages) == 1
        payload = JobQueueMessage.model_validate_json(queue_messages[0].content)
    finally:
        for message in queue_messages:
            queue.delete_message(message)

    assert payload.jobId == retry_job_id
    assert payload.processId == process.id
    assert payload.correlationId == retried_job.correlationId
    assert payload.blobPath == failed_job.blobPath
    assert payload.routingAnalyzerId == cast(str, process.routingAnalyzerId)
    assert payload.confidenceThreshold == process.confidenceThreshold
    assert payload.ownerEmail == process.ownerEmail


def test_retry_job_flows_through_worker_using_original_blob(api_client: TestClient) -> None:
    cosmos, blob, _queue = backend_services(api_client)
    process = create_process(cosmos)
    failed_job = seed_failed_job(cosmos, blob, process.id, content=pdf_bytes(1))

    retry_response = api_client.post(f"/processes/{process.id}/jobs/{failed_job.id}/retry")
    assert retry_response.status_code == 202
    retry_job_id = retry_response.json()["jobId"]

    dependencies = make_dependencies(
        api_client,
        cu_client=FakeCuClient(result_body=load_fixture("routed_direct_prebuilt_invoice.json")),
    )
    assert process_next_message(dependencies) is True

    original_job = cosmos.read_job(process.id, failed_job.id)
    retried_job = cosmos.read_job(process.id, retry_job_id)
    assert original_job.status == JobStatus.FAILED
    assert retried_job.status == JobStatus.SUCCEEDED
    assert retried_job.retryOfJobId == failed_job.id
    assert retried_job.blobPath == failed_job.blobPath
    assert retried_job.detectedForm == "prebuilt-invoice"
    assert retried_job.fields is not None
    assert retried_job.confidenceViolations is not None
    assert retried_job.attempts == 1


def test_retry_rejects_non_failed_job(api_client: TestClient) -> None:
    cosmos, blob, _queue = backend_services(api_client)
    process = create_process(cosmos)
    succeeded_job = seed_failed_job(
        cosmos,
        blob,
        process.id,
        content=pdf_bytes(1),
        status=JobStatus.SUCCEEDED,
        error=None,
    )

    response = api_client.post(f"/processes/{process.id}/jobs/{succeeded_job.id}/retry")

    assert response.status_code == 409
    assert response.json()["code"] == "job_not_failed"


def backend_services(api_client: TestClient) -> tuple[CosmosService, BlobService, QueueService]:
    app = api_client.app
    assert isinstance(app, FastAPI)
    return (
        cast(CosmosService, app.state.cosmos_service),
        cast(BlobService, app.state.blob_service),
        cast(QueueService, app.state.queue_service),
    )


def seed_failed_job(
    cosmos: CosmosService,
    blob: BlobService,
    process_id: str,
    *,
    content: bytes,
    status: JobStatus = JobStatus.FAILED,
    error: str | None = "Content Understanding timed out.",
) -> JobDocument:
    now = datetime(2026, 2, 1, 12, 0, 0, tzinfo=UTC)
    job_id = str(uuid4())
    blob_path = f"{process_id}/{job_id}/invoice.pdf"
    blob.upload_bytes(blob_path, content, "application/pdf")
    return cosmos.upsert_job(
        JobDocument(
            id=job_id,
            processId=process_id,
            correlationId=str(uuid4()),
            fileName="invoice.pdf",
            contentType="application/pdf",
            blobPath=blob_path,
            status=status,
            submittedAt=now,
            completedAt=now + timedelta(seconds=5),
            detectedForm="prebuilt-invoice" if status == JobStatus.SUCCEEDED else None,
            detectedFormName="Invoice" if status == JobStatus.SUCCEEDED else None,
            unclassified=False if status == JobStatus.SUCCEEDED else None,
            retryOfJobId=None,
            attempts=1,
            pages=None,
            fields=None,
            fieldCount=None,
            confidenceViolations=None,
            notificationSent=False,
            reviewedAt=None,
            error=error,
        )
    )
