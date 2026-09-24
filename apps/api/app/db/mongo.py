from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collation import Collation
from pymongo.errors import OperationFailure, PyMongoError

from app.config import Settings
from app.db.base import JobFilters
from app.db.exceptions import DocumentNotFoundError
from app.models import BusinessProcessDocument, JobDocument

DATABASE_NAME = "enterprise-idp"
PROCESSES_COLLECTION = "processes"
JOBS_COLLECTION = "jobs"

logger = logging.getLogger(__name__)

_CASE_INSENSITIVE_COLLATION = Collation(locale="en", strength=2)


@dataclass
class MongoService:
    """DataStore implementation backed by MongoDB / MongoDB Atlas.

    Documents are stored with `_id` set to the model's own `id` so
    upserts/reads/deletes are simple `_id` lookups, mirroring how Cosmos
    documents are keyed by `id`. `_id` is stripped before validating a
    document back into its pydantic model.
    """

    settings: Settings

    def __post_init__(self) -> None:
        self._client: MongoClient[dict[str, Any]] = MongoClient(
            self.settings.mongo_connection_string,
            serverSelectionTimeoutMS=5000,
            tz_aware=True,
            tzinfo=UTC,
        )
        self._database = self._client[self.settings.mongo_database_name]
        self._processes = self._database[PROCESSES_COLLECTION]
        self._jobs = self._database[JOBS_COLLECTION]

    def ensure_schema(self) -> None:
        self._create_processes_name_index()
        self._processes.create_index(
            [("createdAt", DESCENDING)],
            name="ix_processes_createdAt",
        )
        self._jobs.create_index(
            [("processId", ASCENDING), ("submittedAt", DESCENDING)],
            name="ix_jobs_processId_submittedAt",
        )
        self._jobs.create_index(
            [("status", ASCENDING), ("submittedAt", ASCENDING)],
            name="ix_jobs_status_submittedAt",
        )

    def _create_processes_name_index(self) -> None:
        # Azure Cosmos DB for MongoDB (RU-based API) does not support the
        # `collation` index option (raises OperationFailure code 197,
        # "InvalidIndexSpecificationOption"), unlike the local `mongo:7`
        # dev container. Fall back to a plain unique index so uniqueness is
        # still enforced against Cosmos, at the cost of case-sensitivity.
        try:
            self._processes.create_index(
                "name",
                name="uq_processes_name_ci",
                unique=True,
                collation=_CASE_INSENSITIVE_COLLATION,
            )
        except OperationFailure as exc:
            if exc.code != 197:
                raise
            logger.warning(
                "Case-insensitive collation index unsupported by this Mongo "
                "backend (%s); falling back to a case-sensitive unique index.",
                exc.details.get("errmsg", exc),
            )
            self._processes.create_index("name", name="uq_processes_name", unique=True)

    def check_health(self) -> bool:
        try:
            self._client.admin.command("ping")
        except PyMongoError:
            return False
        return True

    # -- Processes ---------------------------------------------------------

    def upsert_process(self, process: BusinessProcessDocument) -> BusinessProcessDocument:
        document = process.model_dump(mode="python")
        document["_id"] = process.id
        self._processes.replace_one({"_id": process.id}, document, upsert=True)
        # Read back rather than validating the in-memory document: BSON
        # dates only carry millisecond precision, so returning what was
        # actually persisted keeps this result consistent with later reads.
        return self.read_process(process.id)

    def read_process(self, process_id: str) -> BusinessProcessDocument:
        raw = self._processes.find_one({"_id": process_id})
        if raw is None:
            raise DocumentNotFoundError(f"Process {process_id} was not found.")
        return BusinessProcessDocument.model_validate(self._strip_system_fields(raw))

    def list_processes(self) -> list[BusinessProcessDocument]:
        cursor = self._processes.find().sort("createdAt", DESCENDING)
        return [
            BusinessProcessDocument.model_validate(self._strip_system_fields(document))
            for document in cursor
        ]

    def find_process_by_name(self, name: str) -> BusinessProcessDocument | None:
        raw = self._processes.find_one({"name": name}, collation=_CASE_INSENSITIVE_COLLATION)
        if raw is None:
            return None
        return BusinessProcessDocument.model_validate(self._strip_system_fields(raw))

    def delete_process(self, process_id: str) -> None:
        result = self._processes.delete_one({"_id": process_id})
        if result.deleted_count == 0:
            raise DocumentNotFoundError(f"Process {process_id} was not found.")

    # -- Jobs ----------------------------------------------------------------

    def upsert_job(self, job: JobDocument) -> JobDocument:
        document = job.model_dump(mode="python")
        document["_id"] = job.id
        self._jobs.replace_one({"_id": job.id}, document, upsert=True)
        # Read back rather than validating the in-memory document: BSON
        # dates only carry millisecond precision, so returning what was
        # actually persisted keeps this result consistent with later reads.
        return self.read_job(job.processId, job.id)

    def read_job(self, process_id: str, job_id: str) -> JobDocument:
        raw = self._jobs.find_one({"_id": job_id, "processId": process_id})
        if raw is None:
            raise DocumentNotFoundError(f"Job {job_id} was not found for process {process_id}.")
        return JobDocument.model_validate(self._strip_system_fields(raw))

    def delete_job(self, process_id: str, job_id: str) -> None:
        result = self._jobs.delete_one({"_id": job_id, "processId": process_id})
        if result.deleted_count == 0:
            raise DocumentNotFoundError(f"Job {job_id} was not found for process {process_id}.")

    def list_jobs_for_process(self, process_id: str) -> list[JobDocument]:
        cursor = self._jobs.find({"processId": process_id})
        return [JobDocument.model_validate(self._strip_system_fields(document)) for document in cursor]

    def list_running_jobs_before(self, before: datetime) -> list[JobDocument]:
        cursor = self._jobs.find({"status": "running", "submittedAt": {"$lt": before}})
        return [JobDocument.model_validate(self._strip_system_fields(document)) for document in cursor]

    def list_jobs(
        self,
        process_id: str,
        *,
        filters: JobFilters,
        limit: int,
    ) -> list[JobDocument]:
        cursor = (
            self._jobs.find(self._build_filter(process_id, filters))
            .sort("submittedAt", DESCENDING)
            .limit(limit)
        )
        return [JobDocument.model_validate(self._strip_system_fields(document)) for document in cursor]

    def count_jobs(self, process_id: str, *, filters: JobFilters) -> int:
        return self._jobs.count_documents(self._build_filter(process_id, filters))

    def sum_pages(self, process_id: str, *, filters: JobFilters) -> int:
        pipeline: list[dict[str, Any]] = [
            {"$match": self._build_filter(process_id, filters)},
            {
                "$group": {
                    "_id": None,
                    "totalPages": {
                        "$sum": {
                            "$cond": [
                                {"$isArray": "$pages"},
                                {"$size": "$pages"},
                                0,
                            ]
                        }
                    },
                }
            },
        ]
        results = list(self._jobs.aggregate(pipeline))
        if not results:
            return 0
        return int(results[0]["totalPages"])

    @staticmethod
    def _build_filter(process_id: str, filters: JobFilters) -> dict[str, Any]:
        query: dict[str, Any] = {"processId": process_id}

        if filters.statuses:
            query["status"] = {"$in": [status.value for status in filters.statuses]}

        if filters.detected_forms:
            query["detectedForm"] = {"$in": filters.detected_forms}

        if filters.has_violations is True:
            query["confidenceViolations.0"] = {"$exists": True}
        elif filters.has_violations is False:
            query["confidenceViolations.0"] = {"$exists": False}

        if filters.reviewed is True:
            query["reviewedAt"] = {"$ne": None}
        elif filters.reviewed is False:
            query["reviewedAt"] = None

        if filters.unclassified is not None:
            query["unclassified"] = filters.unclassified

        if filters.file_name:
            query["fileName"] = {"$regex": re.escape(filters.file_name), "$options": "i"}

        submitted_range: dict[str, datetime] = {}
        if filters.submitted_from is not None:
            submitted_range["$gte"] = filters.submitted_from
        if filters.submitted_to is not None:
            submitted_range["$lte"] = filters.submitted_to
        if submitted_range:
            query["submittedAt"] = submitted_range

        return query

    @staticmethod
    def _strip_system_fields(document: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in document.items() if key != "_id"}
