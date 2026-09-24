from __future__ import annotations

import logging
from collections.abc import Sequence
from contextlib import suppress
from dataclasses import replace
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from statistics import fmean
from typing import Annotated, cast
from uuid import uuid4

from azure.core.exceptions import ResourceNotFoundError
from fastapi import FastAPI, Query, Response
from fastapi.responses import JSONResponse
from opentelemetry import metrics, trace
from opentelemetry.metrics import Counter
from PIL import Image, UnidentifiedImageError

from app.db import DataStore, DataStoreError, DocumentNotFoundError, JobFilters
from app.models import (
    ArrayField,
    BooleanField,
    BusinessProcessDocument,
    DateField,
    Error,
    Field,
    IntegerField,
    Job,
    JobDocument,
    JobQueueMessage,
    JobRef,
    JobsSummary,
    JobStatus,
    NumberField,
    ObjectField,
    ReviewJobRequest,
    RoutingAnalyzerStatus,
    StringField,
    TimeField,
)
from app.observability import correlation_scope, set_span_attributes
from app.pricing import estimate_document_cost_usd
from app.storage import BlobService, QueueService

TIFF_EXTENSIONS = {".tif", ".tiff"}
StatusQuery = Annotated[list[JobStatus] | None, Query()]
DetectedFormQuery = Annotated[list[str] | None, Query()]
LimitQuery = Annotated[int, Query(ge=1, le=500)]
type LeafField = StringField | DateField | TimeField | NumberField | IntegerField | BooleanField
logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)
_meter = metrics.get_meter(__name__)
_jobs_reviewed_counter: Counter = _meter.create_counter(
    "idp.jobs_reviewed",
    description=(
        "Number of review-save actions performed on jobs, by business process. "
        "status=complete means all confidence violations were resolved; "
        "status=partial means violations remain."
    ),
)


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


def _narrow_statuses(filters: JobFilters, required_status: JobStatus) -> JobFilters | None:
    """AND a required status onto the existing status filter.

    Mirrors the old raw-SQL `extra_clause` behavior, which ANDed the extra
    condition onto whatever the caller already requested. If the caller
    already narrowed to a set of statuses that excludes `required_status`,
    the combination is unsatisfiable, so this returns `None` (count is 0).
    """
    if filters.statuses and required_status not in filters.statuses:
        return None
    return replace(filters, statuses=[required_status])


def _narrow_bool_filter(filters: JobFilters, field_name: str, value: bool = True) -> JobFilters | None:
    """AND a required boolean filter onto the existing value for that field.

    If the caller already requested a contradictory value for the same
    field, the combination is unsatisfiable, so this returns `None`.
    """
    current = getattr(filters, field_name)
    if current is not None and current != value:
        return None
    return replace(filters, **{field_name: value})


def register_jobs_routes(application: FastAPI) -> None:
    @application.get(
        "/processes/{processId}/jobs",
        response_model=list[Job],
        response_model_exclude={"__all__": {"fields"}},
        responses={404: {"model": Error}},
        tags=["jobs"],
    )
    async def list_jobs_endpoint(
        processId: str,
        status: StatusQuery = None,
        detectedForm: DetectedFormQuery = None,
        hasViolations: bool | None = None,
        reviewed: bool | None = None,
        unclassified: bool | None = None,
        fileName: str | None = None,
        submittedFrom: datetime | None = None,
        submittedTo: datetime | None = None,
        limit: LimitQuery = 100,
    ) -> list[Job] | JSONResponse:
        if not process_exists(application, processId):
            return process_not_found_response()

        filters = JobFilters(
            statuses=status or [],
            detected_forms=detectedForm or [],
            has_violations=hasViolations,
            reviewed=reviewed,
            unclassified=unclassified,
            file_name=fileName,
            submitted_from=submittedFrom,
            submitted_to=submittedTo,
        )
        jobs = [
            with_computed_fields(job)
            for job in data_store(application).list_jobs(processId, filters=filters, limit=limit)
        ]
        return cast(list[Job], jobs)

    @application.get(
        "/processes/{processId}/jobs/summary",
        response_model=JobsSummary,
        responses={404: {"model": Error}},
        tags=["jobs"],
    )
    async def get_jobs_summary_endpoint(
        processId: str,
        status: StatusQuery = None,
        detectedForm: DetectedFormQuery = None,
        hasViolations: bool | None = None,
        reviewed: bool | None = None,
        unclassified: bool | None = None,
        fileName: str | None = None,
        submittedFrom: datetime | None = None,
        submittedTo: datetime | None = None,
    ) -> JobsSummary | JSONResponse:
        if not process_exists(application, processId):
            return process_not_found_response()

        filters = JobFilters(
            statuses=status or [],
            detected_forms=detectedForm or [],
            has_violations=hasViolations,
            reviewed=reviewed,
            unclassified=unclassified,
            file_name=fileName,
            submitted_from=submittedFrom,
            submitted_to=submittedTo,
        )
        store = data_store(application)
        total_pages = store.sum_pages(processId, filters=filters)

        def count_with_status(required_status: JobStatus) -> int:
            narrowed = _narrow_statuses(filters, required_status)
            return store.count_jobs(processId, filters=narrowed) if narrowed is not None else 0

        def count_with_bool(field_name: str) -> int:
            narrowed = _narrow_bool_filter(filters, field_name)
            return store.count_jobs(processId, filters=narrowed) if narrowed is not None else 0

        return JobsSummary(
            total=store.count_jobs(processId, filters=filters),
            needsReview=count_with_bool("has_violations"),
            failed=count_with_status(JobStatus.FAILED),
            unclassified=count_with_bool("unclassified"),
            totalEstimatedCostUsd=estimate_document_cost_usd(total_pages),
        )

    @application.get(
        "/processes/{processId}/jobs/{jobId}",
        response_model=Job,
        responses={404: {"model": Error}},
        tags=["jobs"],
    )
    async def get_job_endpoint(processId: str, jobId: str) -> Job | JSONResponse:
        try:
            job = data_store(application).read_job(processId, jobId)
        except DocumentNotFoundError:
            return error_response(
                status_code=404,
                code="job_not_found",
                message="The requested job was not found for this process.",
            )
        return with_computed_fields(job)

    @application.get(
        "/processes/{processId}/jobs/{jobId}/document",
        response_model=None,
        responses={404: {"model": Error}},
        tags=["jobs"],
    )
    async def get_job_document_endpoint(processId: str, jobId: str) -> Response | JSONResponse:
        try:
            job = data_store(application).read_job(processId, jobId)
        except DocumentNotFoundError:
            return error_response(
                status_code=404,
                code="job_not_found",
                message="The requested job was not found for this process.",
            )

        try:
            document_bytes = blob_service(application).download_bytes(job.blobPath)
        except ResourceNotFoundError:
            return error_response(
                status_code=404,
                code="job_document_not_found",
                message="The source document for this job was not found.",
            )

        if is_tiff_document(job):
            return Response(content=convert_tiff_to_pdf(document_bytes), media_type="application/pdf")

        return Response(content=document_bytes, media_type=job.contentType)

    @application.put(
        "/processes/{processId}/jobs/{jobId}/review",
        response_model=Job,
        responses={400: {"model": Error}, 404: {"model": Error}},
        tags=["jobs"],
    )
    async def review_job_endpoint(
        processId: str,
        jobId: str,
        payload: ReviewJobRequest,
    ) -> Job | JSONResponse:
        process_error = ensure_process_exists(application, processId)
        if process_error is not None:
            return process_error

        try:
            job = data_store(application).read_job(processId, jobId)
        except DocumentNotFoundError:
            return error_response(
                status_code=404,
                code="job_not_found",
                message="The requested job was not found for this process.",
            )

        if job.status != JobStatus.SUCCEEDED:
            return error_response(
                status_code=400,
                code="job_not_reviewable",
                message="Only succeeded jobs can be reviewed.",
                details={"status": job.status},
            )

        resolved_fields: list[tuple[str, LeafField, str]] = []
        for reviewed_field in payload.fields:
            resolved_field = resolve_reviewable_field(job.fields, reviewed_field.path)
            if resolved_field is None:
                return error_response(
                    status_code=400,
                    code="unknown_field_path",
                    message="The requested field path is invalid or not reviewable.",
                    details={"path": reviewed_field.path},
                )
            resolved_fields.append((reviewed_field.path, resolved_field, reviewed_field.value))

        reviewed_paths = {path for path, _, _ in resolved_fields}
        for _, field_node, reviewed_value in resolved_fields:
            field_node.reviewedValue = reviewed_value

        remaining_violations = [
            path for path in (job.confidenceViolations or []) if path not in reviewed_paths
        ]
        with correlation_scope(job.correlationId), tracer.start_as_current_span(
            "review.save"
        ) as span:
            set_span_attributes(
                span,
                correlation_id=job.correlationId,
                job_id=job.id,
                process_id=processId,
            )
            updated_job = data_store(application).upsert_job(
                job.model_copy(
                    update={
                        "fields": job.fields,
                        "confidenceViolations": remaining_violations,
                        "reviewedAt": job.reviewedAt or datetime.now(UTC),
                    }
                )
            )
            logger.info(
                "Saved review for job %s process %s reviewed_paths=%s remaining_violations=%s",
                job.id,
                processId,
                sorted(reviewed_paths),
                len(remaining_violations),
            )
            _jobs_reviewed_counter.add(
                1,
                {
                    "process_id": processId,
                    "status": "partial" if remaining_violations else "complete",
                },
            )
        return with_computed_fields(updated_job)

    @application.post(
        "/processes/{processId}/jobs/{jobId}/retry",
        response_model=JobRef,
        status_code=202,
        responses={404: {"model": Error}, 409: {"model": Error}},
        tags=["jobs"],
    )
    async def retry_job_endpoint(processId: str, jobId: str) -> JobRef | JSONResponse:
        try:
            process = data_store(application).read_process(processId)
        except DocumentNotFoundError:
            return process_not_found_response()

        try:
            job = data_store(application).read_job(processId, jobId)
        except DocumentNotFoundError:
            return error_response(
                status_code=404,
                code="job_not_found",
                message="The requested job was not found for this process.",
            )

        process_validation_error = validate_retryable_process(process)
        if process_validation_error is not None:
            return process_validation_error

        if job.status != JobStatus.FAILED:
            return error_response(
                status_code=409,
                code="job_not_failed",
                message="Only failed jobs can be retried.",
                details={"status": job.status},
            )

        now = datetime.now(UTC)
        retried_job_id = str(uuid4())
        correlation_id = str(uuid4())
        retry_job = JobDocument(
            id=retried_job_id,
            processId=processId,
            correlationId=correlation_id,
            fileName=job.fileName,
            contentType=job.contentType,
            blobPath=job.blobPath,
            status=JobStatus.QUEUED,
            submittedAt=now,
            completedAt=None,
            detectedForm=None,
            detectedFormName=None,
            unclassified=None,
            retryOfJobId=job.id,
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
            jobId=retried_job_id,
            processId=processId,
            correlationId=correlation_id,
            blobPath=job.blobPath,
            routingAnalyzerId=cast(str, process.routingAnalyzerId),
            confidenceThreshold=process.confidenceThreshold,
            ownerEmail=process.ownerEmail,
        )

        with correlation_scope(correlation_id):
            try:
                with tracer.start_as_current_span("job.persist") as span:
                    set_span_attributes(
                        span,
                        correlation_id=correlation_id,
                        job_id=retried_job_id,
                        process_id=processId,
                    )
                    data_store(application).upsert_job(retry_job)
                    logger.info(
                        "Persisted retry job %s for process %s status=%s retry_of=%s",
                        retried_job_id,
                        processId,
                        retry_job.status.value,
                        job.id,
                    )
                with tracer.start_as_current_span("queue.enqueue") as span:
                    set_span_attributes(
                        span,
                        correlation_id=correlation_id,
                        job_id=retried_job_id,
                        process_id=processId,
                    )
                    queue_service(application).send_message(queue_message.model_dump_json())
                    logger.info(
                        "Enqueued retry job %s for process %s routing_analyzer_id=%s",
                        retried_job_id,
                        processId,
                        queue_message.routingAnalyzerId,
                    )
            except Exception:
                with suppress(DataStoreError):
                    data_store(application).delete_job(processId, retried_job_id)
                raise

        return JobRef(jobId=retried_job_id)


def process_exists(application: FastAPI, process_id: str) -> bool:
    try:
        data_store(application).read_process(process_id)
    except DocumentNotFoundError:
        return False
    return True


def process_not_found_response() -> JSONResponse:
    return error_response(
        status_code=404,
        code="process_not_found",
        message="The requested business process was not found.",
    )


def ensure_process_exists(application: FastAPI, process_id: str) -> JSONResponse | None:
    if process_exists(application, process_id):
        return None
    return process_not_found_response()


def validate_retryable_process(process: BusinessProcessDocument) -> JSONResponse | None:
    if process.routingAnalyzerStatus == RoutingAnalyzerStatus.READY and process.routingAnalyzerId is not None:
        return None
    return error_response(
        status_code=409,
        code="routing_analyzer_not_ready",
        message="The process routing analyzer is not ready for retries.",
        details={
            "routingAnalyzerStatus": process.routingAnalyzerStatus,
            "routingAnalyzerId": process.routingAnalyzerId,
        },
    )


def resolve_reviewable_field(fields: Sequence[Field] | None, pointer: str) -> LeafField | None:
    if not pointer.startswith("/"):
        return None

    current: Sequence[Field] | Field | None = fields
    for token in decode_json_pointer(pointer):
        if current is None:
            return None
        if isinstance(current, Sequence) and not isinstance(current, (str, bytes)):
            current = next((field for field in current if field.name == token), None)
            continue
        if isinstance(current, ObjectField):
            current = (current.properties or {}).get(token)
            continue
        if isinstance(current, ArrayField):
            if not token.isdigit():
                return None
            index = int(token)
            items = current.items or []
            if index >= len(items):
                return None
            current = items[index]
            continue
        return None

    if current is None or isinstance(current, (Sequence, ArrayField, ObjectField)):
        return None
    return current


def decode_json_pointer(pointer: str) -> list[str]:
    return [token.replace("~1", "/").replace("~0", "~") for token in pointer.split("/")[1:]]


def with_computed_fields(job: JobDocument) -> JobDocument:
    return job.model_copy(
        update={
            "fieldCount": count_leaf_fields(job.fields),
            "averageConfidence": compute_average_confidence(job.fields),
            "estimatedCostUsd": estimate_document_cost_usd(len(job.pages or [])),
        }
    )


def count_leaf_fields(fields: list[Field] | None) -> int:
    if not fields:
        return 0
    return sum(count_leaf_nodes(field) for field in fields)


def count_leaf_nodes(field: Field) -> int:
    if isinstance(field, ArrayField):
        return sum(count_leaf_nodes(item) for item in field.items or [])
    if isinstance(field, ObjectField):
        return sum(count_leaf_nodes(item) for item in (field.properties or {}).values())
    return 1


def compute_average_confidence(fields: list[Field] | None) -> float | None:
    """Arithmetic mean of confidence-bearing leaf fields, excluding leaves with
    no confidence score. Mirrors the aggregate rule used to gate review in
    app.worker.result_mapping.compute_confidence_violations, but is derived at
    read time from persisted fields (like fieldCount) rather than persisted
    separately, so it reflects the full field tree regardless of whether the
    job needs review."""
    if not fields:
        return None
    confidences = [confidence for field in fields for confidence in _collect_leaf_confidences(field)]
    if not confidences:
        return None
    return fmean(confidences)


def _collect_leaf_confidences(field: Field) -> list[float]:
    if isinstance(field, ArrayField):
        return [confidence for item in field.items or [] for confidence in _collect_leaf_confidences(item)]
    if isinstance(field, ObjectField):
        return [
            confidence
            for child in (field.properties or {}).values()
            for confidence in _collect_leaf_confidences(child)
        ]
    return [field.confidence] if field.confidence is not None else []


def is_tiff_document(job: JobDocument) -> bool:
    return Path(job.fileName).suffix.lower() in TIFF_EXTENSIONS or job.contentType == "image/tiff"


def convert_tiff_to_pdf(content: bytes) -> bytes:
    frames: list[Image.Image] = []
    try:
        with Image.open(BytesIO(content)) as image:
            for frame_index in range(getattr(image, "n_frames", 1)):
                image.seek(frame_index)
                frames.append(image.convert("RGB"))

        if not frames:
            raise ValueError("TIFF document had no frames.")

        output = BytesIO()
        first_frame, *remaining_frames = frames
        first_frame.save(output, format="PDF", save_all=True, append_images=remaining_frames)
        return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise RuntimeError("Failed to convert TIFF document to PDF.") from exc
    finally:
        for frame in frames:
            frame.close()
