from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlparse

from azure.core.exceptions import AzureError
from azure.cosmos import CosmosClient, PartitionKey
from azure.cosmos.exceptions import CosmosResourceNotFoundError

from app.config import Settings
from app.db.base import JobFilters
from app.db.exceptions import DocumentNotFoundError
from app.models import BusinessProcessDocument, JobDocument

DATABASE_NAME = "enterprise-idp"
PROCESSES_CONTAINER = "processes"
JOBS_CONTAINER = "jobs"


def _cosmos_datetime(value: datetime) -> str:
    normalized = value if value.tzinfo is not None else value.replace(tzinfo=UTC)
    return normalized.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass
class CosmosService:
    """DataStore implementation backed by Azure Cosmos DB (SQL API).

    Config-selectable fallback behind `DB_BACKEND=cosmos`; MongoDB
    (`MongoService`) is the default per Canada Life's approved production
    stack. Both implement `app.db.base.DataStore` and are exercised by the
    same contract test suite.
    """

    settings: Settings

    def __post_init__(self) -> None:
        self._connection_string = self._normalized_connection_string()
        self._client = CosmosClient.from_connection_string(
            self._connection_string,
            connection_verify=self._should_verify_connection(),
        )
        self._database = self._client.get_database_client(DATABASE_NAME)
        self._processes = self._database.get_container_client(PROCESSES_CONTAINER)
        self._jobs = self._database.get_container_client(JOBS_CONTAINER)

    def _should_verify_connection(self) -> bool:
        endpoint = self._parse_connection_string(self._connection_string).get("AccountEndpoint", "")
        hostname = urlparse(endpoint).hostname or ""
        if hostname in {"localhost", "127.0.0.1"}:
            return False
        if self.settings.cosmos_tls_insecure:
            return False
        return True

    def _parse_connection_string(self, connection_string: str) -> dict[str, str]:
        parts: dict[str, str] = {}
        for segment in connection_string.split(";"):
            if not segment or "=" not in segment:
                continue
            key, value = segment.split("=", 1)
            parts[key] = value
        return parts

    def _normalized_connection_string(self) -> str:
        parts = self._parse_connection_string(self.settings.cosmos_connection_string)
        endpoint = parts.get("AccountEndpoint", "")
        parsed = urlparse(endpoint)
        should_downgrade_to_http = parsed.scheme == "https" and (
            parsed.hostname in {"localhost", "127.0.0.1"} or self.settings.cosmos_tls_insecure
        )
        if should_downgrade_to_http:
            parts["AccountEndpoint"] = endpoint.replace("https://", "http://", 1)

        return ";".join(f"{key}={value}" for key, value in parts.items()) + ";"

    def ensure_schema(self) -> None:
        self._database = self._client.create_database_if_not_exists(id=DATABASE_NAME)
        self._processes = self._database.create_container_if_not_exists(
            id=PROCESSES_CONTAINER,
            partition_key=PartitionKey(path="/id"),
        )
        self._jobs = self._database.create_container_if_not_exists(
            id=JOBS_CONTAINER,
            partition_key=PartitionKey(path="/processId"),
        )

    def check_health(self) -> bool:
        try:
            self._database.read()
            self._processes.read()
            self._jobs.read()
        except AzureError:
            return False
        return True

    # -- Processes ---------------------------------------------------------

    def upsert_process(self, process: BusinessProcessDocument) -> BusinessProcessDocument:
        raw = self._processes.upsert_item(process.model_dump(mode="json"))
        return BusinessProcessDocument.model_validate(self._strip_system_fields(raw))

    def read_process(self, process_id: str) -> BusinessProcessDocument:
        try:
            raw = self._processes.read_item(item=process_id, partition_key=process_id)
        except CosmosResourceNotFoundError as exc:
            raise DocumentNotFoundError(f"Process {process_id} was not found.") from exc
        return BusinessProcessDocument.model_validate(self._strip_system_fields(raw))

    def list_processes(self) -> list[BusinessProcessDocument]:
        query = "SELECT * FROM c ORDER BY c.createdAt DESC"
        return [
            BusinessProcessDocument.model_validate(self._strip_system_fields(document))
            for document in self._processes.query_items(
                query=query,
                enable_cross_partition_query=True,
            )
        ]

    def find_process_by_name(self, name: str) -> BusinessProcessDocument | None:
        query = "SELECT TOP 1 * FROM c WHERE LOWER(c.name) = @normalizedName"
        parameters: list[dict[str, object]] = [{"name": "@normalizedName", "value": name.lower()}]
        results = list(
            self._processes.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True,
            )
        )
        if not results:
            return None
        return BusinessProcessDocument.model_validate(self._strip_system_fields(results[0]))

    def delete_process(self, process_id: str) -> None:
        try:
            self._processes.delete_item(item=process_id, partition_key=process_id)
        except CosmosResourceNotFoundError as exc:
            raise DocumentNotFoundError(f"Process {process_id} was not found.") from exc

    # -- Jobs ----------------------------------------------------------------

    def upsert_job(self, job: JobDocument) -> JobDocument:
        raw = self._jobs.upsert_item(job.model_dump(mode="json"))
        return JobDocument.model_validate(self._strip_system_fields(raw))

    def read_job(self, process_id: str, job_id: str) -> JobDocument:
        try:
            raw = self._jobs.read_item(item=job_id, partition_key=process_id)
        except CosmosResourceNotFoundError as exc:
            raise DocumentNotFoundError(f"Job {job_id} was not found for process {process_id}.") from exc
        return JobDocument.model_validate(self._strip_system_fields(raw))

    def delete_job(self, process_id: str, job_id: str) -> None:
        try:
            self._jobs.delete_item(item=job_id, partition_key=process_id)
        except CosmosResourceNotFoundError as exc:
            raise DocumentNotFoundError(f"Job {job_id} was not found for process {process_id}.") from exc

    def list_jobs_for_process(self, process_id: str) -> list[JobDocument]:
        query = "SELECT * FROM c WHERE c.processId = @processId"
        parameters: list[dict[str, object]] = [{"name": "@processId", "value": process_id}]
        return [
            JobDocument.model_validate(self._strip_system_fields(document))
            for document in self._jobs.query_items(
                query=query,
                parameters=parameters,
                partition_key=process_id,
            )
        ]

    def list_running_jobs_before(self, before: datetime) -> list[JobDocument]:
        query = "SELECT * FROM c WHERE c.status = @status AND c.submittedAt < @before"
        parameters: list[dict[str, object]] = [
            {"name": "@status", "value": "running"},
            {"name": "@before", "value": before.isoformat()},
        ]
        return [
            JobDocument.model_validate(self._strip_system_fields(document))
            for document in self._jobs.query_items(
                query=query,
                parameters=parameters,
                enable_cross_partition_query=True,
            )
        ]

    def list_jobs(
        self,
        process_id: str,
        *,
        filters: JobFilters,
        limit: int,
    ) -> list[JobDocument]:
        where_clauses, parameters = self._build_where_clauses(process_id, filters)
        query = (
            f"SELECT TOP {limit} * FROM c "
            f"WHERE {' AND '.join(where_clauses)} "
            "ORDER BY c.submittedAt DESC"
        )
        return [
            JobDocument.model_validate(self._strip_system_fields(document))
            for document in self._jobs.query_items(
                query=query,
                parameters=parameters,
                partition_key=process_id,
            )
        ]

    def count_jobs(self, process_id: str, *, filters: JobFilters) -> int:
        where_clauses, parameters = self._build_where_clauses(process_id, filters)
        query = f"SELECT VALUE COUNT(1) FROM c WHERE {' AND '.join(where_clauses)}"
        results = list(
            self._jobs.query_items(query=query, parameters=parameters, partition_key=process_id)
        )
        return int(results[0]) if results else 0

    def sum_pages(self, process_id: str, *, filters: JobFilters) -> int:
        where_clauses, parameters = self._build_where_clauses(process_id, filters)
        query = (
            "SELECT VALUE SUM(IS_ARRAY(c.pages) ? ARRAY_LENGTH(c.pages) : 0) "
            f"FROM c WHERE {' AND '.join(where_clauses)}"
        )
        results = list(
            self._jobs.query_items(query=query, parameters=parameters, partition_key=process_id)
        )
        return int(results[0]) if results and results[0] is not None else 0

    @staticmethod
    def _build_where_clauses(
        process_id: str,
        filters: JobFilters,
    ) -> tuple[list[str], list[dict[str, object]]]:
        where_clauses = ["c.processId = @processId"]
        parameters: list[dict[str, object]] = [{"name": "@processId", "value": process_id}]

        if filters.statuses:
            where_clauses.append(
                "("
                + " OR ".join(f"c.status = @status{index}" for index, _ in enumerate(filters.statuses))
                + ")"
            )
            parameters.extend(
                {"name": f"@status{index}", "value": status.value}
                for index, status in enumerate(filters.statuses)
            )

        if filters.detected_forms:
            where_clauses.append(
                "("
                + " OR ".join(
                    f"c.detectedForm = @detectedForm{index}"
                    for index, _ in enumerate(filters.detected_forms)
                )
                + ")"
            )
            parameters.extend(
                {"name": f"@detectedForm{index}", "value": detected_form}
                for index, detected_form in enumerate(filters.detected_forms)
            )

        if filters.has_violations is True:
            where_clauses.append(
                "IS_ARRAY(c.confidenceViolations) AND ARRAY_LENGTH(c.confidenceViolations) > 0"
            )
        elif filters.has_violations is False:
            where_clauses.append(
                "(NOT IS_ARRAY(c.confidenceViolations) OR ARRAY_LENGTH(c.confidenceViolations) = 0)"
            )

        if filters.reviewed is True:
            where_clauses.append("NOT IS_NULL(c.reviewedAt)")
        elif filters.reviewed is False:
            where_clauses.append("IS_NULL(c.reviewedAt)")

        if filters.unclassified is not None:
            where_clauses.append("c.unclassified = @unclassified")
            parameters.append({"name": "@unclassified", "value": filters.unclassified})

        if filters.file_name:
            where_clauses.append("CONTAINS(LOWER(c.fileName), @fileName)")
            parameters.append({"name": "@fileName", "value": filters.file_name.lower()})

        if filters.submitted_from is not None:
            where_clauses.append(
                "DateTimeToTimestamp(c.submittedAt) >= DateTimeToTimestamp(@submittedFrom)"
            )
            parameters.append(
                {"name": "@submittedFrom", "value": _cosmos_datetime(filters.submitted_from)}
            )

        if filters.submitted_to is not None:
            where_clauses.append(
                "DateTimeToTimestamp(c.submittedAt) <= DateTimeToTimestamp(@submittedTo)"
            )
            parameters.append(
                {"name": "@submittedTo", "value": _cosmos_datetime(filters.submitted_to)}
            )

        return where_clauses, parameters

    @staticmethod
    def _strip_system_fields(document: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in document.items() if not key.startswith("_")}
