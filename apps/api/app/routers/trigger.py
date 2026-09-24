from __future__ import annotations

import logging
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import cast
from uuid import uuid4

from azure.core.exceptions import AzureError
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry import metrics, trace
from opentelemetry.metrics import Counter
from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader
from starlette.datastructures import UploadFile

from app.db import DataStore, DataStoreError, DocumentNotFoundError
from app.models import (
    BusinessProcessDocument,
    Error,
    JobDocument,
    JobQueueMessage,
    JobRef,
    JobStatus,
    RoutingAnalyzerStatus,
)
from app.observability import correlation_scope, set_span_attributes
from app.storage import BlobService, QueueService

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024
MAX_PAGE_COUNT = 20
SUPPORTED_FILE_MESSAGE = "The uploaded file must be a PDF, PNG, JPG, or TIFF."
SUPPORTED_CONTENT_TYPES_BY_EXTENSION = {
    ".pdf": {"application/pdf"},
    ".png": {"image/png"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".tif": {"image/tiff"},
    ".tiff": {"image/tiff"},
}
PDF_EXTENSIONS = {".pdf"}
TIFF_EXTENSIONS = {".tif", ".tiff"}
logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)
_meter = metrics.get_meter(__name__)
_jobs_triggered_counter: Counter = _meter.create_counter(
    "idp.jobs_triggered",
    description="Number of jobs accepted and enqueued into the pipeline, by business process.",
)


class InvalidDocumentError(ValueError):
    pass


@dataclass(frozen=True)
class ValidatedUpload:
    file_name: str
    content_type: str
    content: bytes
    page_count: int


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=Error(code=code, message=message, details=details).model_dump(mode="json"),
    )


def data_store(application: FastAPI) -> DataStore:
    return cast(DataStore, application.state.data_store)


def blob_service(application: FastAPI) -> BlobService:
    return cast(BlobService, application.state.blob_service)


def queue_service(application: FastAPI) -> QueueService:
    return cast(QueueService, application.state.queue_service)


def count_pages(file_extension: str, content: bytes) -> int:
    try:
        if file_extension in PDF_EXTENSIONS:
            return len(PdfReader(BytesIO(content)).pages)
        if file_extension in TIFF_EXTENSIONS:
            with Image.open(BytesIO(content)) as image:
                return int(getattr(image, "n_frames", 1))
        return 1
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise InvalidDocumentError("The uploaded document could not be read.") from exc


def validate_process(process: BusinessProcessDocument) -> JSONResponse | None:
    if (
        process.routingAnalyzerStatus == RoutingAnalyzerStatus.READY
        and process.routingAnalyzerId is not None
    ):
        return None

    return error_response(
        status_code=409,
        code="routing_analyzer_not_ready",
        message="The process routing analyzer is not ready for uploads.",
        details={
            "routingAnalyzerStatus": process.routingAnalyzerStatus,
            "routingAnalyzerId": process.routingAnalyzerId,
        },
    )


async def validate_upload(request: Request) -> ValidatedUpload | JSONResponse:
    form = await request.form()
    files = [value for _, value in form.multi_items() if isinstance(value, UploadFile)]
    if len(files) != 1:
        for upload in files:
            await upload.close()
        return error_response(
            status_code=400,
            code="invalid_file_upload",
            message="Exactly one file must be uploaded.",
            details={"fileCount": len(files)},
        )

    upload = files[0]
    file_name = Path(upload.filename or "").name
    file_extension = Path(file_name).suffix.lower()
    content_type = upload.content_type or ""

    if content_type not in SUPPORTED_CONTENT_TYPES_BY_EXTENSION.get(file_extension, set()):
        await upload.close()
        return error_response(
            status_code=400,
            code="unsupported_file_type",
            message=SUPPORTED_FILE_MESSAGE,
            details={"fileName": file_name or None, "contentType": content_type or None},
        )

    content = await upload.read()
    await upload.close()
    if len(content) > MAX_FILE_SIZE_BYTES:
        return error_response(
            status_code=400,
            code="file_too_large",
            message="The uploaded file must be 20 MB or smaller.",
            details={"sizeBytes": len(content), "maxSizeBytes": MAX_FILE_SIZE_BYTES},
        )

    try:
        page_count = count_pages(file_extension, content)
    except InvalidDocumentError as exc:
        return error_response(
            status_code=400,
            code="invalid_document",
            message=str(exc),
        )

    if page_count > MAX_PAGE_COUNT:
        return error_response(
            status_code=400,
            code="too_many_pages",
            message="The uploaded file must have 20 pages or fewer.",
            details={"pageCount": page_count, "maxPageCount": MAX_PAGE_COUNT},
        )

    return ValidatedUpload(
        file_name=file_name,
        content_type=content_type,
        content=content,
        page_count=page_count,
    )


def register_trigger_routes(application: FastAPI) -> None:
    @application.post(
        "/processes/{processId}/trigger",
        response_model=JobRef,
        status_code=202,
        responses={400: {"model": Error}, 404: {"model": Error}, 409: {"model": Error}},
        tags=["jobs"],
    )
    async def trigger_job_endpoint(processId: str, request: Request) -> JobRef | JSONResponse:
        try:
            process = data_store(application).read_process(processId)
        except DocumentNotFoundError:
            return error_response(
                status_code=404,
                code="process_not_found",
                message="The requested business process was not found.",
            )

        process_validation_error = validate_process(process)
        if process_validation_error is not None:
            return process_validation_error

        validated_upload = await validate_upload(request)
        if isinstance(validated_upload, JSONResponse):
            return validated_upload

        now = datetime.now(UTC)
        job_id = str(uuid4())
        correlation_id = str(uuid4())
        blob_path = f"{processId}/{job_id}/{validated_upload.file_name}"
        job = JobDocument(
            id=job_id,
            processId=processId,
            correlationId=correlation_id,
            fileName=validated_upload.file_name,
            contentType=validated_upload.content_type,
            blobPath=blob_path,
            status=JobStatus.QUEUED,
            submittedAt=now,
            completedAt=None,
            detectedForm=None,
            detectedFormName=None,
            unclassified=None,
            retryOfJobId=None,
            attempts=0,
            pages=None,
            fields=None,
            fieldCount=None,
            averageConfidence=None,
            confidenceViolations=None,
            notificationSent=False,
            reviewedAt=None,
            error=None,
        )
        queue_message = JobQueueMessage(
            jobId=job_id,
            processId=processId,
            correlationId=correlation_id,
            blobPath=blob_path,
            routingAnalyzerId=cast(str, process.routingAnalyzerId),
            confidenceThreshold=process.confidenceThreshold,
            ownerEmail=process.ownerEmail,
        )

        blob_created = False
        job_created = False
        with correlation_scope(correlation_id), tracer.start_as_current_span(
            "trigger.request"
        ) as span:
            set_span_attributes(
                span,
                correlation_id=correlation_id,
                job_id=job_id,
                process_id=processId,
            )
            logger.info(
                "Accepted trigger request for job %s process %s file=%s pages=%s status=%s",
                job_id,
                processId,
                validated_upload.file_name,
                validated_upload.page_count,
                job.status.value,
            )
            try:
                with tracer.start_as_current_span("blob.write") as blob_span:
                    set_span_attributes(
                        blob_span,
                        correlation_id=correlation_id,
                        job_id=job_id,
                        process_id=processId,
                    )
                    blob_service(application).upload_bytes(
                        blob_path,
                        validated_upload.content,
                        validated_upload.content_type,
                    )
                    blob_created = True
                    logger.info(
                        "Stored source document for job %s process %s blob_path=%s file=%s",
                        job_id,
                        processId,
                        blob_path,
                        validated_upload.file_name,
                    )

                with tracer.start_as_current_span("job.persist") as job_span:
                    set_span_attributes(
                        job_span,
                        correlation_id=correlation_id,
                        job_id=job_id,
                        process_id=processId,
                    )
                    data_store(application).upsert_job(job)
                    job_created = True
                    logger.info(
                        "Persisted job %s for process %s status=%s",
                        job_id,
                        processId,
                        job.status.value,
                    )

                with tracer.start_as_current_span("queue.enqueue") as queue_span:
                    set_span_attributes(
                        queue_span,
                        correlation_id=correlation_id,
                        job_id=job_id,
                        process_id=processId,
                    )
                    queue_service(application).send_message(queue_message.model_dump_json())
                    _jobs_triggered_counter.add(1, {"process_id": processId})
                    logger.info(
                        "Enqueued job %s for process %s routing_analyzer_id=%s",
                        job_id,
                        processId,
                        queue_message.routingAnalyzerId,
                    )
            except Exception:
                if job_created:
                    with suppress(DataStoreError):
                        data_store(application).delete_job(processId, job_id)
                if blob_created:
                    with suppress(AzureError):
                        blob_service(application).delete_blob(blob_path)
                raise

        return JobRef(jobId=job_id)
