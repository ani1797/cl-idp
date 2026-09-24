"""Azure Functions entry point for the queue-triggered pipeline worker.

This is a thin adapter around `app.worker.main` (the exact same job-handling
logic used by the standalone/local worker process) — bound to the shared
storage account's "jobs" queue via the Functions queue trigger, so in Azure
this becomes an independently-scaling Function App rather than a
long-running polling loop (see docs/spec/TECHNOLOGY.md "Azure Production
Architecture").

Dependencies (Mongo, Blob, Queue, Content Understanding clients) are created
lazily on first invocation rather than at module import time, so a
transient dependency outage during a cold start doesn't crash the whole
function host — only that invocation fails and the message is retried per
the storage queue's dequeue-count/visibility-timeout semantics.

Note: host.json sets `extensions.queues.messageEncoding` to `"none"`
because `apps/api/app/storage/queue.py` sends the raw JSON payload as
plain text (pymongo/azure-storage-queue's default `NoEncodePolicy`), not
Base64 — which is the Functions queue-trigger binding's own default. Without
that override, every message is rejected at the binding level (never even
reaching this handler) and ends up in the `jobs-poison` queue after
`MaxDequeueCount` retries.
"""

from __future__ import annotations

import logging
import threading

import azure.functions as func

from app.config import get_settings
from app.models import JobQueueMessage
from app.observability import init_observability
from app.worker.main import (
    WorkerConfig,
    WorkerDependencies,
    create_dependencies,
    handle_queue_message,
)

logger = logging.getLogger(__name__)

app = func.FunctionApp()

_config = WorkerConfig()
_dependencies: WorkerDependencies | None = None
_dependencies_lock = threading.Lock()
_observability_initialized = False


def _get_dependencies() -> WorkerDependencies:
    global _dependencies, _observability_initialized
    if _dependencies is not None:
        return _dependencies
    with _dependencies_lock:
        if _dependencies is None:
            settings = get_settings()
            if not _observability_initialized:
                init_observability(service_name="enterprise-idp-worker", settings=settings)
                _observability_initialized = True
            _dependencies = create_dependencies(settings)
        return _dependencies


@app.queue_trigger(arg_name="msg", queue_name="jobs", connection="AzureWebJobsStorage")
def jobs_worker(msg: func.QueueMessage) -> None:
    body = msg.get_body().decode("utf-8")
    payload = JobQueueMessage.model_validate_json(body)
    # Storage queue dequeue_count starts at 1 on first delivery, matching the
    # `attempt` semantics `handle_queue_message` expects.
    attempt = msg.dequeue_count or 1
    dependencies = _get_dependencies()
    handle_queue_message(
        dependencies,
        payload=payload,
        attempt=attempt,
        config=_config,
    )
    logger.info(
        "Processed queue message for job %s (process %s, attempt %s).",
        payload.jobId,
        payload.processId,
        attempt,
    )
