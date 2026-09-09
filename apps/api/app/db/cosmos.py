from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from urllib.parse import urlparse

from azure.core.exceptions import AzureError
from azure.cosmos import CosmosClient, PartitionKey

from app.config import Settings
from app.models import BusinessProcessDocument, JobDocument

DATABASE_NAME = "enterprise-idp"
PROCESSES_CONTAINER = "processes"
JOBS_CONTAINER = "jobs"


@dataclass
class CosmosService:
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

    def ensure_containers(self) -> None:
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

    def upsert_process(self, process: BusinessProcessDocument) -> BusinessProcessDocument:
        raw = self._processes.upsert_item(process.model_dump(mode="json"))
        return BusinessProcessDocument.model_validate(self._strip_system_fields(raw))

    def read_process(self, process_id: str) -> BusinessProcessDocument:
        raw = self._processes.read_item(item=process_id, partition_key=process_id)
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
        self._processes.delete_item(item=process_id, partition_key=process_id)

    def upsert_job(self, job: JobDocument) -> JobDocument:
        raw = self._jobs.upsert_item(job.model_dump(mode="json"))
        return JobDocument.model_validate(self._strip_system_fields(raw))

    def read_job(self, process_id: str, job_id: str) -> JobDocument:
        raw = self._jobs.read_item(item=job_id, partition_key=process_id)
        return JobDocument.model_validate(self._strip_system_fields(raw))

    def delete_job(self, process_id: str, job_id: str) -> None:
        self._jobs.delete_item(item=job_id, partition_key=process_id)

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

    def query_jobs(
        self,
        process_id: str,
        *,
        query: str,
        parameters: list[dict[str, object]] | None = None,
    ) -> list[dict[str, Any]]:
        return [
            self._strip_system_fields(document)
            for document in self._jobs.query_items(
                query=query,
                parameters=parameters or [],
                partition_key=process_id,
            )
        ]

    def query_job_values(
        self,
        process_id: str,
        *,
        query: str,
        parameters: list[dict[str, object]] | None = None,
    ) -> list[Any]:
        return list(
            self._jobs.query_items(
                query=query,
                parameters=parameters or [],
                partition_key=process_id,
            )
        )

    def process_container_properties(self) -> dict[str, Any]:
        return dict(self._processes.read())

    def job_container_properties(self) -> dict[str, Any]:
        return dict(self._jobs.read())

    @staticmethod
    def _strip_system_fields(document: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in document.items() if not key.startswith("_")}
