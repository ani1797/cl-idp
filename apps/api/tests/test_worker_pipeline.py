from __future__ import annotations

import json
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.cu import ContentUnderstandingError
from app.models import BusinessProcessDocument, JobDocument, JobQueueMessage, JobStatus
from app.worker.main import (
    WorkerConfig,
    WorkerDependencies,
    poll_for_result,
    process_next_message,
    reconcile_running_jobs,
)
from tests.test_trigger_api import create_process, pdf_bytes

FIXTURES = Path(__file__).parent / "fixtures"


class FakeCuClient:
    def __init__(self, *, result_body: dict[str, Any] | None = None, error: Exception | None = None) -> None:
        self.result_body = result_body
        self.error = error
        self.operation_ids: list[str] = []

    def analyze_binary(
        self,
        analyzer_id: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
    ) -> str:
        _ = analyzer_id, content, content_type
        if self.error is not None:
            raise self.error
        operation_id = f"op-{len(self.operation_ids) + 1}"
        self.operation_ids.append(operation_id)
        return operation_id

    def get_analyzer_result(self, operation_id: str) -> dict[str, Any]:
        _ = operation_id
        if self.result_body is None:
            return {"status": "Running"}
        return self.result_body

    def close(self) -> None:
        return None


def load_fixture(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((FIXTURES / name).read_text()))


def make_dependencies(
    api_client: TestClient,
    *,
    cu_client: FakeCuClient,
    smtp_port: int | None = None,
) -> WorkerDependencies:
    app = cast(FastAPI, api_client.app)
    settings = app.state.settings
    if smtp_port is not None:
        settings = settings.model_copy(update={"smtp_port": smtp_port})
    return WorkerDependencies(
        settings=settings,
        cosmos=app.state.cosmos_service,
        blob=app.state.blob_service,
        queue=app.state.queue_service,
        cu_client=cu_client,
    )


def enqueue_job(
    api_client: TestClient,
    *,
    process: BusinessProcessDocument,
    file_name: str = "invoice.pdf",
) -> JobDocument:
    response = api_client.post(
        f"/processes/{process.id}/trigger",
        files={"file": (file_name, pdf_bytes(1), "application/pdf")},
    )
    assert response.status_code == 202
    app = cast(FastAPI, api_client.app)
    return cast(JobDocument, app.state.cosmos_service.read_job(process.id, response.json()["jobId"]))


def test_worker_retries_then_fails_after_third_dequeue(api_client: TestClient) -> None:
    process = create_process(cast(FastAPI, api_client.app).state.cosmos_service)
    job = enqueue_job(api_client, process=process)
    dependencies = make_dependencies(
        api_client,
        cu_client=FakeCuClient(error=ContentUnderstandingError("simulated worker failure")),
    )
    config = WorkerConfig(visibility_timeout_seconds=1)

    assert process_next_message(dependencies, config=config) is True
    first_attempt = dependencies.cosmos.read_job(process.id, job.id)
    assert first_attempt.status == JobStatus.QUEUED
    assert first_attempt.attempts == 1
    assert "simulated worker failure" in cast(str, first_attempt.error)

    time.sleep(1.1)
    assert process_next_message(dependencies, config=config) is True
    second_attempt = dependencies.cosmos.read_job(process.id, job.id)
    assert second_attempt.status == JobStatus.QUEUED
    assert second_attempt.attempts == 2

    time.sleep(1.1)
    assert process_next_message(dependencies, config=config) is True
    final_job = dependencies.cosmos.read_job(process.id, job.id)
    assert final_job.status == JobStatus.FAILED
    assert final_job.attempts == 3
    assert final_job.completedAt is not None
    assert "simulated worker failure" in cast(str, final_job.error)

    assert dependencies.queue.receive_messages(max_messages=1) == []


def test_reconciliation_requeues_once_then_fails_on_recurrence(api_client: TestClient) -> None:
    app = cast(FastAPI, api_client.app)
    cosmos = app.state.cosmos_service
    process = create_process(cosmos)
    now = datetime.now(UTC)
    message = JobQueueMessage(
        jobId=str(uuid4()),
        processId=process.id,
        correlationId=str(uuid4()),
        blobPath=f"{process.id}/job/retry.pdf",
        routingAnalyzerId=cast(str, process.routingAnalyzerId),
        confidenceThreshold=process.confidenceThreshold,
        ownerEmail=process.ownerEmail,
    )
    app.state.queue_service.send_message(message.model_dump_json())

    running_job = cosmos.upsert_job(
        JobDocument(
            id=message.jobId,
            processId=process.id,
            correlationId=message.correlationId,
            fileName="retry.pdf",
            contentType="application/pdf",
            blobPath=message.blobPath,
            status=JobStatus.RUNNING,
            submittedAt=now - timedelta(minutes=20),
            completedAt=None,
            detectedForm=None,
            detectedFormName=None,
            unclassified=None,
            retryOfJobId=None,
            attempts=1,
            pages=None,
            fields=None,
            fieldCount=None,
            confidenceViolations=None,
            notificationSent=False,
            reviewedAt=None,
            error=None,
        )
    )
    dependencies = make_dependencies(api_client, cu_client=FakeCuClient())

    reconcile_running_jobs(dependencies)
    reconciled = cosmos.read_job(process.id, running_job.id)
    assert reconciled.status == JobStatus.QUEUED
    assert reconciled.error is None

    cosmos.upsert_job(
        reconciled.model_copy(
            update={
                "status": JobStatus.RUNNING,
                "attempts": 2,
                "submittedAt": now - timedelta(minutes=20),
            }
        )
    )
    reconcile_running_jobs(dependencies)
    failed = cosmos.read_job(process.id, running_job.id)
    assert failed.status == JobStatus.FAILED
    assert failed.completedAt is not None
    assert failed.error == "Job remained stuck in running after reconciliation retry."


def test_worker_succeeds_even_when_smtp_notification_fails(api_client: TestClient) -> None:
    process = create_process(cast(FastAPI, api_client.app).state.cosmos_service)
    job = enqueue_job(api_client, process=process)
    dependencies = make_dependencies(
        api_client,
        cu_client=FakeCuClient(result_body=load_fixture("routed_direct_prebuilt_invoice.json")),
        smtp_port=9,
    )

    assert process_next_message(dependencies) is True
    completed = dependencies.cosmos.read_job(process.id, job.id)
    assert completed.status == JobStatus.SUCCEEDED
    assert completed.detectedForm == "prebuilt-invoice"
    assert completed.notificationSent is False
    assert completed.confidenceViolations == [
        "/InvoiceDate",
        "/AmountDue/Amount",
        "/LineItems/0/Description",
    ]


def test_worker_persists_empty_violations_and_skips_notification_when_aggregate_meets_threshold(
    api_client: TestClient,
) -> None:
    app = cast(FastAPI, api_client.app)
    process = create_process(app.state.cosmos_service)
    process = app.state.cosmos_service.upsert_process(
        process.model_copy(update={"confidenceThreshold": 0.75})
    )
    job = enqueue_job(api_client, process=process)
    dependencies = make_dependencies(
        api_client,
        cu_client=FakeCuClient(result_body=aggregate_passing_result_fixture()),
        smtp_port=9,
    )

    assert process_next_message(dependencies) is True
    completed = dependencies.cosmos.read_job(process.id, job.id)

    assert completed.status == JobStatus.SUCCEEDED
    assert completed.detectedForm == "prebuilt-invoice"
    assert completed.confidenceViolations == []
    assert completed.notificationSent is False


def test_poll_for_result_times_out_with_short_override(monkeypatch: pytest.MonkeyPatch) -> None:
    cu_client = FakeCuClient()
    clock = {"now": 0.0}

    def fake_monotonic() -> float:
        return clock["now"]

    def fake_sleep(seconds: float) -> None:
        clock["now"] += seconds

    monkeypatch.setattr("app.worker.main.time.monotonic", fake_monotonic)
    monkeypatch.setattr("app.worker.main.time.sleep", fake_sleep)

    with pytest.raises(RuntimeError, match="timed out"):
        poll_for_result(cu_client, operation_id="op-1", job_timeout_seconds=0.1)


def aggregate_passing_result_fixture() -> dict[str, Any]:
    return {
        "status": "Succeeded",
        "result": {
            "contents": [
                {
                    "unit": "inch",
                    "pages": [{"pageNumber": 1, "width": 8.5, "height": 11.0, "angle": 0}],
                    "segments": [{"category": "prebuilt-invoice"}],
                },
                {
                    "unit": "inch",
                    "pages": [{"pageNumber": 1, "width": 8.5, "height": 11.0, "angle": 0}],
                    "fields": {
                        "InvoiceTotal": {
                            "type": "number",
                            "valueNumber": 100.0,
                            "confidence": 0.5,
                        },
                        "InvoiceId": {
                            "type": "string",
                            "valueString": "INV-001",
                            "confidence": 1.0,
                        },
                    },
                },
            ]
        }
    }
