from __future__ import annotations

import time
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.models import JobStatus, RoutingAnalyzerStatus
from app.worker.main import WorkerDependencies, process_next_message
from tests.test_cu_provisioning import cleanup_process_analyzers, wait_for_process_status

SAMPLES_DIR = Path(__file__).resolve().parents[1] / "samples"
MAILPIT_API = "http://127.0.0.1:8025/api/v1/messages"


@pytest.mark.live
def test_worker_processes_live_invoice_end_to_end(live_api_client: TestClient) -> None:
    app = cast(FastAPI, live_api_client.app)
    cosmos = app.state.data_store
    process_id: str | None = None

    before_ids = {message["ID"] for message in list_mailpit_messages() if isinstance(message.get("ID"), str)}
    try:
        create_response = live_api_client.post(
            "/processes",
            json={
                "name": f"Worker E2E {time.time()}",
                "description": "Live worker E2E test",
                "allowedAnalyzerIds": ["prebuilt-invoice"],
                "confidenceThreshold": 1.0,
                "ownerEmail": "owner@example.com",
            },
        )
        assert create_response.status_code == 201
        process_id = create_response.json()["id"]

        process = wait_for_process_status(cosmos, process_id, RoutingAnalyzerStatus.READY)

        trigger_response = live_api_client.post(
            f"/processes/{process.id}/trigger",
            files={
                "file": (
                    "invoice.pdf",
                    (SAMPLES_DIR / "invoice.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        )
        assert trigger_response.status_code == 202
        job_id = trigger_response.json()["jobId"]

        dependencies = WorkerDependencies(
            settings=app.state.settings,
            data_store=app.state.data_store,
            blob=app.state.blob_service,
            queue=app.state.queue_service,
            cu_client=app.state.cu_client,
        )
        assert process_next_message(dependencies) is True

        job = cosmos.read_job(process.id, job_id)
        assert job.status == JobStatus.SUCCEEDED
        assert job.detectedForm == "prebuilt-invoice"
        assert job.detectedFormName == "Invoice"
        assert job.unclassified is False
        assert job.completedAt is not None
        assert job.fields is not None
        assert job.fields != []
        assert job.pages is not None
        assert job.pages != []
        assert job.confidenceViolations is not None
        assert job.confidenceViolations != []
        assert job.notificationSent is True
        assert job.error is None
        assert job.attempts == 1

        new_messages = wait_for_new_mailpit_messages(before_ids)
        subjects = [message.get("Subject") for message in new_messages]
        assert any(subject == "[Enterprise IDP] Review needed for invoice.pdf" for subject in subjects)
    finally:
        if process_id is not None:
            process = cosmos.read_process(process_id)
            cleanup_process_analyzers(process)


def list_mailpit_messages() -> list[dict[str, Any]]:
    response = httpx.get(MAILPIT_API, timeout=10)
    response.raise_for_status()
    body = response.json()
    if isinstance(body, list):
        return [item for item in body if isinstance(item, dict)]
    if isinstance(body, dict):
        messages = body.get("messages")
        if isinstance(messages, list):
            return [item for item in messages if isinstance(item, dict)]
    raise AssertionError(f"Unexpected Mailpit response shape: {body!r}")


def wait_for_new_mailpit_messages(before_ids: set[str], *, timeout_seconds: float = 15.0) -> list[dict[str, Any]]:
    deadline = time.monotonic() + timeout_seconds
    while True:
        messages = list_mailpit_messages()
        new_messages = [message for message in messages if message.get("ID") not in before_ids]
        if new_messages:
            return new_messages
        if time.monotonic() >= deadline:
            raise AssertionError("Timed out waiting for a Mailpit notification email.")
        time.sleep(1)
