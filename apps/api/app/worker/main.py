from __future__ import annotations

import argparse
import logging
import smtplib
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from email.message import EmailMessage
from typing import Any, Protocol

from azure.core.exceptions import AzureError
from azure.cosmos.exceptions import CosmosResourceNotFoundError
from opentelemetry import metrics, trace
from opentelemetry.metrics import Counter, Histogram
from pydantic import ValidationError

from app.config import Settings, get_settings
from app.cu import ContentUnderstandingError, CuClient
from app.db import CosmosService
from app.models import (
    ArrayField,
    BusinessProcessDocument,
    Field,
    JobDocument,
    JobQueueMessage,
    JobStatus,
    ObjectField,
)
from app.observability import correlation_scope, init_observability, set_span_attributes
from app.pricing import estimate_document_cost_usd
from app.storage import BlobService, QueueService
from app.worker.result_mapping import MappedJobResult, ResultMappingError, map_analysis_result

logger = logging.getLogger(__name__)
tracer = trace.get_tracer(__name__)
_meter = metrics.get_meter(__name__)
_jobs_processed_counter: Counter = _meter.create_counter(
    "worker.jobs_processed",
    description="Number of queue messages the worker finished handling, by outcome.",
)
_job_duration_histogram: Histogram = _meter.create_histogram(
    "worker.job_duration_seconds",
    unit="s",
    description="Time spent handling a single queue message end to end.",
)
_job_cost_counter: Counter = _meter.create_counter(
    "worker.job_cost_usd",
    unit="usd",
    description=(
        "Estimated Azure AI Content Understanding cost incurred per successfully "
        "processed document (see app.pricing for the per-page rate assumptions)."
    ),
)

DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 300
DEFAULT_JOB_TIMEOUT_SECONDS = 600
MAX_DEQUEUE_ATTEMPTS = 3
IDLE_SLEEP_SECONDS = 2.0


class TerminalJobError(RuntimeError):
    pass


class AnalysisClient(Protocol):
    def analyze_binary(
        self,
        analyzer_id: str,
        content: bytes,
        *,
        content_type: str = "application/octet-stream",
    ) -> str: ...

    def get_analyzer_result(self, operation_id: str) -> dict[str, Any]: ...

    def close(self) -> None: ...


@dataclass(frozen=True)
class WorkerConfig:
    visibility_timeout_seconds: int = DEFAULT_VISIBILITY_TIMEOUT_SECONDS
    job_timeout_seconds: float = DEFAULT_JOB_TIMEOUT_SECONDS
    max_dequeue_attempts: int = MAX_DEQUEUE_ATTEMPTS
    idle_sleep_seconds: float = IDLE_SLEEP_SECONDS


@dataclass(frozen=True)
class WorkerDependencies:
    settings: Settings
    cosmos: CosmosService
    blob: BlobService
    queue: QueueService
    cu_client: AnalysisClient


def create_dependencies(settings: Settings | None = None) -> WorkerDependencies:
    resolved_settings = settings or get_settings()
    cosmos = CosmosService(resolved_settings)
    blob = BlobService(resolved_settings)
    queue = QueueService(resolved_settings)
    cu_client = CuClient(resolved_settings)
    cosmos.ensure_containers()
    blob.ensure_container()
    queue.ensure_queue()
    return WorkerDependencies(
        settings=resolved_settings,
        cosmos=cosmos,
        blob=blob,
        queue=queue,
        cu_client=cu_client,
    )


def close_dependencies(dependencies: WorkerDependencies) -> None:
    dependencies.cu_client.close()


def run_worker(*, once: bool = False, config: WorkerConfig | None = None) -> int:
    init_observability(service_name="enterprise-idp-worker", settings=get_settings())
    dependencies = create_dependencies()
    resolved_config = config or WorkerConfig()
    try:
        reconcile_running_jobs(dependencies, config=resolved_config)
        while True:
            processed = process_next_message(dependencies, config=resolved_config)
            if once:
                return 0
            if not processed:
                time.sleep(resolved_config.idle_sleep_seconds)
    finally:
        close_dependencies(dependencies)


def process_next_message(
    dependencies: WorkerDependencies,
    *,
    config: WorkerConfig | None = None,
) -> bool:
    resolved_config = config or WorkerConfig()
    messages = dependencies.queue.receive_messages(
        max_messages=1,
        visibility_timeout=resolved_config.visibility_timeout_seconds,
    )
    if not messages:
        return False

    queue_message = messages[0]
    try:
        payload = JobQueueMessage.model_validate_json(queue_message.content)
    except ValidationError:
        logger.exception("Discarding invalid queue message.")
        dependencies.queue.delete_message(queue_message)
        return True

    attempt = int(queue_message.dequeue_count or 1)
    started_at = time.perf_counter()
    with correlation_scope(payload.correlationId), tracer.start_as_current_span(
        "worker.dequeue"
    ) as span:
        set_span_attributes(
            span,
            correlation_id=payload.correlationId,
            job_id=payload.jobId,
            process_id=payload.processId,
        )
        logger.info(
            "Dequeued job %s for process %s attempt=%s",
            payload.jobId,
            payload.processId,
            attempt,
        )
        try:
            terminal = handle_queue_message(
                dependencies,
                payload=payload,
                attempt=attempt,
                config=resolved_config,
            )
            outcome = "success" if terminal else "retry"
        except Exception:
            logger.exception("Unexpected worker failure while handling job %s.", payload.jobId)
            terminal = False
            outcome = "error"

    _jobs_processed_counter.add(1, {"outcome": outcome})
    _job_duration_histogram.record(time.perf_counter() - started_at, {"outcome": outcome})

    if terminal:
        dependencies.queue.delete_message(queue_message)
    return True


def handle_queue_message(
    dependencies: WorkerDependencies,
    *,
    payload: JobQueueMessage,
    attempt: int,
    config: WorkerConfig,
) -> bool:
    if attempt > config.max_dequeue_attempts:
        mark_missing_or_failed_job(
            dependencies,
            process_id=payload.processId,
            job_id=payload.jobId,
            attempt=attempt,
            error=(
                "Job exceeded the maximum dequeue attempts before processing could begin."
            ),
        )
        return True

    job = try_read_job(dependencies, process_id=payload.processId, job_id=payload.jobId)
    if job is None:
        logger.info("Discarding orphaned queue message for missing job %s.", payload.jobId)
        return True

    process = try_read_process(dependencies, process_id=payload.processId)
    if process is None:
        logger.info("Discarding queue message for missing process %s.", payload.processId)
        return True

    if job.status == JobStatus.SUCCEEDED:
        logger.info("Discarding duplicate queue message for already-succeeded job %s.", payload.jobId)
        return True

    if attempt >= config.max_dequeue_attempts and job.status == JobStatus.FAILED:
        return True

    with tracer.start_as_current_span("job.persist") as span:
        set_span_attributes(
            span,
            correlation_id=payload.correlationId,
            job_id=job.id,
            process_id=job.processId,
        )
        running_job = dependencies.cosmos.upsert_job(
            job.model_copy(
                update={
                    "status": JobStatus.RUNNING,
                    "attempts": max(job.attempts, attempt),
                    "error": None,
                    "completedAt": None,
                }
            )
        )
    logger.info(
        "Persisted job %s for process %s status_transition=%s->%s",
        running_job.id,
        running_job.processId,
        job.status.value,
        running_job.status.value,
    )

    try:
        content = dependencies.blob.download_bytes(payload.blobPath)
    except AzureError as exc:
        mark_terminal_failure(
            dependencies,
            running_job,
            error=f"Failed to download the source document: {exc}",
        )
        return True

    try:
        with tracer.start_as_current_span("cu.analyze.submit") as span:
            set_span_attributes(
                span,
                correlation_id=payload.correlationId,
                job_id=running_job.id,
                process_id=running_job.processId,
            )
            operation_id = dependencies.cu_client.analyze_binary(
                payload.routingAnalyzerId,
                content,
                content_type=running_job.contentType,
            )
            logger.info(
                "Submitted CU analysis for job %s process %s analyzer_id=%s operation_id=%s",
                running_job.id,
                running_job.processId,
                payload.routingAnalyzerId,
                operation_id,
            )
        with tracer.start_as_current_span("cu.analyze.poll") as span:
            set_span_attributes(
                span,
                correlation_id=payload.correlationId,
                job_id=running_job.id,
                process_id=running_job.processId,
            )
            result_body = poll_for_result(
                dependencies.cu_client,
                operation_id=operation_id,
                job_timeout_seconds=config.job_timeout_seconds,
            )
            logger.info(
                "CU analysis completed for job %s process %s operation_id=%s status=%s",
                running_job.id,
                running_job.processId,
                operation_id,
                result_body.get("status"),
            )
        mapped_result = map_analysis_result(
            result_body,
            allowed_analyzers=process.allowedAnalyzers,
            confidence_threshold=payload.confidenceThreshold,
        )
    except TerminalJobError as exc:
        mark_terminal_failure(dependencies, running_job, error=str(exc))
        return True
    except (ContentUnderstandingError, ResultMappingError, AzureError) as exc:
        if attempt >= config.max_dequeue_attempts:
            mark_terminal_failure(
                dependencies,
                running_job.model_copy(update={"attempts": max(running_job.attempts, attempt)}),
                error=f"Job exhausted retries after worker failure: {exc}",
            )
            return True
        with tracer.start_as_current_span("job.persist") as span:
            set_span_attributes(
                span,
                correlation_id=payload.correlationId,
                job_id=running_job.id,
                process_id=running_job.processId,
            )
            dependencies.cosmos.upsert_job(
                running_job.model_copy(
                    update={
                        "status": JobStatus.QUEUED,
                        "attempts": max(running_job.attempts, attempt),
                        "error": str(exc),
                        "completedAt": None,
                    }
                )
            )
        logger.warning("Returning job %s to queued state after failure: %s", payload.jobId, exc)
        return False
    finalize_success(
        dependencies,
        job=running_job.model_copy(update={"attempts": max(running_job.attempts, attempt)}),
        process=process,
        payload=payload,
        mapped_result=mapped_result,
    )
    return True


def poll_for_result(
    cu_client: AnalysisClient,
    *,
    operation_id: str,
    job_timeout_seconds: float,
) -> dict[str, Any]:
    deadline = time.monotonic() + job_timeout_seconds
    started_at = time.monotonic()

    while True:
        result = cu_client.get_analyzer_result(operation_id)
        status = result.get("status")
        if status == "Succeeded":
            return result
        if status == "Failed":
            raise TerminalJobError(_operation_error_message(result))
        if time.monotonic() >= deadline:
            raise TerminalJobError("Content Understanding analysis timed out.")

        elapsed = time.monotonic() - started_at
        time.sleep(2 if elapsed < 30 else 5)


def reconcile_running_jobs(
    dependencies: WorkerDependencies,
    *,
    config: WorkerConfig | None = None,
) -> None:
    resolved_config = config or WorkerConfig()
    cutoff = datetime.now(UTC) - timedelta(seconds=resolved_config.job_timeout_seconds)
    stuck_jobs = dependencies.cosmos.list_running_jobs_before(cutoff)
    if not stuck_jobs:
        return

    logger.info("Reconciling %s stuck running job(s).", len(stuck_jobs))
    for job in stuck_jobs:
        if job.attempts >= max(1, resolved_config.max_dequeue_attempts - 1):
            mark_terminal_failure(
                dependencies,
                job,
                error="Job remained stuck in running after reconciliation retry.",
            )
            continue

        with tracer.start_as_current_span("job.persist") as span:
            set_span_attributes(
                span,
                correlation_id=job.correlationId,
                job_id=job.id,
                process_id=job.processId,
            )
            dependencies.cosmos.upsert_job(
                job.model_copy(
                    update={
                        "status": JobStatus.QUEUED,
                        "error": None,
                        "completedAt": None,
                    }
                )
            )
        logger.info(
            "Persisted reconciled job %s for process %s status_transition=%s->%s",
            job.id,
            job.processId,
            job.status.value,
            JobStatus.QUEUED.value,
        )


def finalize_success(
    dependencies: WorkerDependencies,
    *,
    job: JobDocument,
    process: BusinessProcessDocument,
    payload: JobQueueMessage,
    mapped_result: MappedJobResult,
) -> None:
    notification_sent = job.notificationSent
    if mapped_result.confidence_violations and not notification_sent:
        try:
            with tracer.start_as_current_span("notify.email") as span:
                set_span_attributes(
                    span,
                    correlation_id=payload.correlationId,
                    job_id=job.id,
                    process_id=job.processId,
                )
                logger.info(
                    "Sending notification email for job %s process %s violation_paths=%s",
                    job.id,
                    job.processId,
                    mapped_result.confidence_violations,
                )
                send_notification_email(
                    dependencies.settings,
                    process=process,
                    job=job,
                    violations=mapped_result.confidence_violations,
                )
            notification_sent = True
        except (OSError, smtplib.SMTPException):
            logger.exception("Failed to send notification email for job %s.", job.id)

    field_summaries = summarize_fields_for_logging(mapped_result.fields)
    with tracer.start_as_current_span("job.persist") as span:
        set_span_attributes(
            span,
            correlation_id=payload.correlationId,
            job_id=job.id,
            process_id=job.processId,
        )
        dependencies.cosmos.upsert_job(
            job.model_copy(
                update={
                    "status": JobStatus.SUCCEEDED,
                    "completedAt": datetime.now(UTC),
                    "detectedForm": mapped_result.detected_form,
                    "detectedFormName": mapped_result.detected_form_name,
                    "unclassified": mapped_result.unclassified,
                    "pages": mapped_result.pages,
                    "fields": mapped_result.fields,
                    "confidenceViolations": mapped_result.confidence_violations,
                    "notificationSent": notification_sent,
                    "error": None,
                    "attempts": max(job.attempts, 1),
                }
            )
        )
    logger.info(
        "Persisted job %s for process %s status=%s detected_form=%s "
        "field_count=%s field_summaries=%s violation_count=%s notification_sent=%s",
        job.id,
        job.processId,
        JobStatus.SUCCEEDED.value,
        mapped_result.detected_form,
        len(field_summaries),
        field_summaries,
        len(mapped_result.confidence_violations),
        notification_sent,
    )
    _job_cost_counter.add(
        estimate_document_cost_usd(len(mapped_result.pages)),
        {
            "process_id": job.processId,
            "detected_form": mapped_result.detected_form or "unclassified",
        },
    )


def mark_terminal_failure(
    dependencies: WorkerDependencies,
    job: JobDocument,
    *,
    error: str,
) -> None:
    with tracer.start_as_current_span("job.persist") as span:
        set_span_attributes(
            span,
            correlation_id=job.correlationId,
            job_id=job.id,
            process_id=job.processId,
        )
        dependencies.cosmos.upsert_job(
            job.model_copy(
                update={
                    "status": JobStatus.FAILED,
                    "completedAt": datetime.now(UTC),
                    "error": error,
                }
            )
        )
    logger.error(
        "Persisted job %s for process %s status=%s error=%s",
        job.id,
        job.processId,
        JobStatus.FAILED.value,
        error,
    )


def mark_missing_or_failed_job(
    dependencies: WorkerDependencies,
    *,
    process_id: str,
    job_id: str,
    attempt: int,
    error: str,
) -> None:
    job = try_read_job(dependencies, process_id=process_id, job_id=job_id)
    if job is None:
        return
    mark_terminal_failure(
        dependencies,
        job.model_copy(update={"attempts": max(job.attempts, attempt)}),
        error=error,
    )


def try_read_job(
    dependencies: WorkerDependencies,
    *,
    process_id: str,
    job_id: str,
) -> JobDocument | None:
    try:
        return dependencies.cosmos.read_job(process_id, job_id)
    except CosmosResourceNotFoundError:
        return None


def try_read_process(
    dependencies: WorkerDependencies,
    *,
    process_id: str,
) -> BusinessProcessDocument | None:
    try:
        return dependencies.cosmos.read_process(process_id)
    except CosmosResourceNotFoundError:
        return None


def send_notification_email(
    settings: Settings,
    *,
    process: BusinessProcessDocument,
    job: JobDocument,
    violations: list[str],
) -> None:
    message = EmailMessage()
    message["From"] = "enterprise-idp@localhost"
    message["To"] = process.ownerEmail
    message["Subject"] = f"[Enterprise IDP] Review needed for {job.fileName}"
    review_url = f"{settings.web_origin.rstrip('/')}/processes/{process.id}/jobs/{job.id}"
    message.set_content(
        "\n".join(
            [
                "The following extracted fields were below the configured confidence threshold:",
                "",
                f"Process: {process.name}",
                f"Job ID: {job.id}",
                f"File: {job.fileName}",
                "",
                *[f"- {path}" for path in violations],
                "",
                f"Review this document: {review_url}",
            ]
        )
    )
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as client:
        client.send_message(message)


def summarize_fields_for_logging(fields: list[Field]) -> list[dict[str, object]]:
    summaries: list[dict[str, object]] = []
    for field in fields:
        _collect_field_summaries(field, summaries=summaries)
    return summaries


def _collect_field_summaries(field: Field, *, summaries: list[dict[str, object]]) -> None:
    if isinstance(field, ArrayField):
        for item in field.items or []:
            _collect_field_summaries(item, summaries=summaries)
        return
    if isinstance(field, ObjectField):
        for child in (field.properties or {}).values():
            _collect_field_summaries(child, summaries=summaries)
        return
    summaries.append(
        {
            "path": field.path,
            "type": field.type,
            "confidence": field.confidence,
            "page": field.page,
        }
    )


def _operation_error_message(result: dict[str, Any]) -> str:
    raw_error = result.get("error")
    if isinstance(raw_error, dict):
        code = raw_error.get("code")
        message = raw_error.get("message")
        if isinstance(code, str) and isinstance(message, str):
            return f"{code}: {message}"
        if isinstance(message, str):
            return message
    raw_message = result.get("message")
    if isinstance(raw_message, str) and raw_message:
        return raw_message
    return "Content Understanding analysis failed."


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Enterprise IDP worker")
    parser.add_argument(
        "--once",
        action="store_true",
        help="Process at most one visible queue message, then exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    return run_worker(once=args.once)


if __name__ == "__main__":
    raise SystemExit(main())
