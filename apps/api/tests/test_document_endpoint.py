from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfReader

from app.db import DataStore, DocumentNotFoundError
from app.models import JobDocument, JobStatus
from app.storage import BlobService
from tests.test_trigger_api import create_process, pdf_bytes


def test_document_endpoint_serves_pdf_verbatim(api_client: TestClient) -> None:
    cosmos, blob = backend_services(api_client)
    process = create_process(cosmos)
    pdf_content = pdf_bytes(2)
    job = create_document_job(
        cosmos,
        blob,
        process_id=process.id,
        file_name="invoice.pdf",
        content_type="application/pdf",
        content=pdf_content,
    )

    response = api_client.get(f"/processes/{process.id}/jobs/{job.id}/document")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content == pdf_content


def test_document_endpoint_converts_tiff_to_pdf_preserving_page_order(api_client: TestClient) -> None:
    cosmos, blob = backend_services(api_client)
    process = create_process(cosmos)
    frame_sizes = [(90, 120), (140, 60), (200, 150)]
    tiff_content = tiff_bytes(frame_sizes)
    job = create_document_job(
        cosmos,
        blob,
        process_id=process.id,
        file_name="scan.tiff",
        content_type="image/tiff",
        content=tiff_content,
    )

    response = api_client.get(f"/processes/{process.id}/jobs/{job.id}/document")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert response.content != tiff_content

    pages = PdfReader(BytesIO(response.content)).pages
    observed_sizes = [
        (round(float(page.mediabox.width)), round(float(page.mediabox.height))) for page in pages
    ]
    assert observed_sizes == frame_sizes


def test_document_endpoint_returns_404_for_missing_blob_or_job(api_client: TestClient) -> None:
    cosmos, blob = backend_services(api_client)
    process = create_process(cosmos)
    job = create_document_job(
        cosmos,
        blob,
        process_id=process.id,
        file_name="orphan.pdf",
        content_type="application/pdf",
        content=pdf_bytes(1),
    )
    blob.delete_blob(job.blobPath)

    missing_blob_response = api_client.get(f"/processes/{process.id}/jobs/{job.id}/document")
    missing_job_response = api_client.get(f"/processes/{process.id}/jobs/{uuid4()}/document")

    assert missing_blob_response.status_code == 404
    assert missing_blob_response.json()["code"] == "job_document_not_found"
    assert missing_job_response.status_code == 404
    assert missing_job_response.json()["code"] == "job_not_found"


def backend_services(api_client: TestClient) -> tuple[DataStore, BlobService]:
    application = api_client.app
    assert isinstance(application, FastAPI)
    return application.state.data_store, application.state.blob_service


def create_document_job(
    cosmos: DataStore,
    blob: BlobService,
    *,
    process_id: str,
    file_name: str,
    content_type: str,
    content: bytes,
) -> JobDocument:
    now = datetime(2026, 3, 1, 10, 0, 0, tzinfo=UTC)
    job_id = str(uuid4())
    blob_path = f"{process_id}/{job_id}/{file_name}"
    blob.upload_bytes(blob_path, content, content_type)
    return cosmos.upsert_job(
        JobDocument(
            id=job_id,
            processId=process_id,
            correlationId=str(uuid4()),
            fileName=file_name,
            contentType=content_type,
            blobPath=blob_path,
            status=JobStatus.SUCCEEDED,
            submittedAt=now,
            completedAt=now,
            detectedForm="prebuilt-invoice",
            detectedFormName="Invoice",
            unclassified=False,
            retryOfJobId=None,
            attempts=1,
            pages=None,
            fields=[],
            fieldCount=None,
            confidenceViolations=[],
            notificationSent=False,
            reviewedAt=None,
            error=None,
        )
    )


def tiff_bytes(frame_sizes: list[tuple[int, int]]) -> bytes:
    frames = [
        Image.new("RGB", size, color=(30 * index, 20 * index, 10 * index))
        for index, size in enumerate(frame_sizes, start=1)
    ]
    try:
        output = BytesIO()
        frames[0].save(output, format="TIFF", save_all=True, append_images=frames[1:])
        return output.getvalue()
    finally:
        for frame in frames:
            frame.close()
