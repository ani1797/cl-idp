from __future__ import annotations

import logging
from collections.abc import Iterable
from io import BytesIO
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter

from app.models import ArrayField, Field, JobStatus, ObjectField, RoutingAnalyzerStatus
from app.worker.main import WorkerDependencies, process_next_message
from tests.test_cu_provisioning import cleanup_process_analyzers, wait_for_process_status

SAMPLES_DIR = Path(__file__).resolve().parents[1] / "samples"
DEFAULT_DISTINCTIVE_VALUE = "Zzyzx Distinctive Vendor Corp"


class CollectingLogHandler(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.records: list[logging.LogRecord] = []
        self.setFormatter(
            logging.Formatter(
                "%(levelname)s %(name)s correlation_id=%(correlation_id)s %(message)s"
            )
        )

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.mark.live
def test_pipeline_logs_are_pii_safe_and_keep_correlation_ids(
    live_api_client: TestClient,
) -> None:
    app = cast(FastAPI, live_api_client.app)
    cosmos = app.state.data_store
    process_id: str | None = None
    handler = CollectingLogHandler()
    root_logger = logging.getLogger()
    previous_level = root_logger.level
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(handler)

    try:
        create_response = live_api_client.post(
            "/processes",
            json={
                "name": "Observability PII Test",
                "description": "Live observability regression test",
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
                    "observability-invoice.pdf",
                    invoice_pdf_with_marker(DEFAULT_DISTINCTIVE_VALUE),
                    "application/pdf",
                )
            },
        )
        assert trigger_response.status_code == 202
        job_id = trigger_response.json()["jobId"]
        queued_job = cosmos.read_job(process.id, job_id)

        dependencies = WorkerDependencies(
            settings=app.state.settings,
            data_store=app.state.data_store,
            blob=app.state.blob_service,
            queue=app.state.queue_service,
            cu_client=app.state.cu_client,
        )
        assert process_next_message(dependencies) is True

        completed_job = cosmos.read_job(process.id, job_id)
        assert completed_job.status == JobStatus.SUCCEEDED
        assert completed_job.fields
        assert completed_job.confidenceViolations
        reviewed_path = leaf_field_paths(completed_job.fields or [])[0]

        review_response = live_api_client.put(
            f"/processes/{process.id}/jobs/{job_id}/review",
            json={"fields": [{"path": reviewed_path, "value": "manually-approved"}]},
        )
        assert review_response.status_code == 200

        rendered_logs = [render_record(handler, record) for record in handler.records]
        combined_logs = "\n".join(rendered_logs)
        related_logs = [
            entry
            for record, entry in zip(handler.records, rendered_logs, strict=True)
            if record.name.startswith("app.") and (job_id in entry or process.id in entry)
        ]
        related_records = [
            record
            for record in handler.records
            if record.name.startswith("app.")
            and (job_id in render_record(handler, record) or process.id in render_record(handler, record))
        ]

        assert related_logs, "Expected pipeline logs for the triggered live job."
        assert DEFAULT_DISTINCTIVE_VALUE not in combined_logs
        assert queued_job.correlationId in combined_logs
        assert job_id in combined_logs
        assert process.id in combined_logs
        assert "status=queued" in combined_logs
        assert "status_transition=queued->running" in combined_logs
        assert "status=succeeded" in combined_logs
        assert "field_summaries=" in combined_logs
        assert "confidence" in combined_logs
        assert "reviewed_paths=" in combined_logs
        assert any(path in combined_logs for path in leaf_field_paths(completed_job.fields or []))
        assert {
            getattr(record, "correlation_id", None) for record in related_records
        } == {queued_job.correlationId}
    finally:
        root_logger.removeHandler(handler)
        root_logger.setLevel(previous_level)
        if process_id is not None:
            process = cosmos.read_process(process_id)
            cleanup_process_analyzers(process)


def invoice_pdf_with_marker(distinctive_value: str) -> bytes:
    writer = PdfWriter()
    source_reader = PdfReader(BytesIO((SAMPLES_DIR / "invoice.pdf").read_bytes()))
    for page in source_reader.pages:
        writer.add_page(page)

    marker_image = Image.new("RGB", (1600, 400), "white")
    draw = ImageDraw.Draw(marker_image)
    draw.text((40, 40), distinctive_value, fill="black")
    marker_pdf = BytesIO()
    marker_image.save(marker_pdf, format="PDF")
    marker_image.close()

    marker_reader = PdfReader(BytesIO(marker_pdf.getvalue()))
    for page in marker_reader.pages:
        writer.add_page(page)

    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def leaf_field_paths(fields: Iterable[Field]) -> list[str]:
    paths: list[str] = []
    for field in fields:
        if isinstance(field, ArrayField):
            paths.extend(leaf_field_paths(field.items or []))
            continue
        if isinstance(field, ObjectField):
            paths.extend(leaf_field_paths((field.properties or {}).values()))
            continue
        paths.append(field.path)
    return paths


def render_record(handler: CollectingLogHandler, record: logging.LogRecord) -> str:
    return handler.format(record)
