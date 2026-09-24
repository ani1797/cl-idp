from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from app.models import BusinessProcessDocument, JobDocument, JobStatus


@dataclass(slots=True)
class JobFilters:
    """Backend-agnostic job-list filter criteria.

    Each `DataStore` implementation translates this into its own query
    language (Cosmos SQL, MongoDB filter documents, ...). Routers must
    never build backend-specific query strings themselves - that's the
    whole point of this type existing.
    """

    statuses: list[JobStatus] = field(default_factory=list)
    detected_forms: list[str] = field(default_factory=list)
    has_violations: bool | None = None
    reviewed: bool | None = None
    unclassified: bool | None = None
    file_name: str | None = None
    submitted_from: datetime | None = None
    submitted_to: datetime | None = None


class DataStore(Protocol):
    """Persistence contract shared by every backend implementation.

    `MongoService` (default, MongoDB Atlas-compatible) and `CosmosService`
    (config-selectable fallback) both implement this in full and are
    exercised by the same contract test suite
    (`tests/test_datastore_contract.py`).
    """

    def ensure_schema(self) -> None:
        """Create collections/containers and indexes if they don't exist."""
        ...

    def check_health(self) -> bool:
        """Return whether the underlying store is reachable and ready."""
        ...

    # -- Processes -----------------------------------------------------

    def upsert_process(self, process: BusinessProcessDocument) -> BusinessProcessDocument: ...

    def read_process(self, process_id: str) -> BusinessProcessDocument:
        """Raises `DocumentNotFoundError` if the process does not exist."""
        ...

    def list_processes(self) -> list[BusinessProcessDocument]:
        """Ordered by `createdAt` descending."""
        ...

    def find_process_by_name(self, name: str) -> BusinessProcessDocument | None:
        """Case-insensitive exact match, or `None` if no process matches."""
        ...

    def delete_process(self, process_id: str) -> None: ...

    # -- Jobs ------------------------------------------------------------

    def upsert_job(self, job: JobDocument) -> JobDocument: ...

    def read_job(self, process_id: str, job_id: str) -> JobDocument:
        """Raises `DocumentNotFoundError` if the job does not exist."""
        ...

    def delete_job(self, process_id: str, job_id: str) -> None: ...

    def list_jobs_for_process(self, process_id: str) -> list[JobDocument]: ...

    def list_running_jobs_before(self, before: datetime) -> list[JobDocument]:
        """All jobs with status `running` and `submittedAt` before `before`,
        across every process."""
        ...

    def list_jobs(
        self,
        process_id: str,
        *,
        filters: JobFilters,
        limit: int,
    ) -> list[JobDocument]:
        """Matching jobs for `process_id`, ordered `submittedAt` descending,
        capped at `limit`."""
        ...

    def count_jobs(self, process_id: str, *, filters: JobFilters) -> int: ...

    def sum_pages(self, process_id: str, *, filters: JobFilters) -> int:
        """Sum of `len(pages)` across matching jobs."""
        ...
