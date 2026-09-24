"""Backend-agnostic contract tests for `app.db.base.DataStore`.

Both `MongoService` (default) and `CosmosService` (config-selectable
fallback) must behave identically for every test in this module. Tests are
parametrized over both backends via the `data_store` fixture so a
regression in either implementation - or a divergence between them - fails
here first.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from pymongo import MongoClient

from app.config import AZURITE_ACCOUNT_KEY, COSMOS_EMULATOR_KEY, Settings
from app.db.base import DataStore, JobFilters
from app.db.cosmos import CosmosService
from app.db.exceptions import DocumentNotFoundError
from app.db.mongo import MongoService
from app.models import (
    AnalyzerRef,
    BusinessProcessDocument,
    JobDocument,
    JobStatus,
    RoutingAnalyzerStatus,
)


def _cosmos_settings() -> Settings:
    return Settings(
        COSMOS_CONNECTION_STRING=f"AccountEndpoint=https://localhost:8081/;AccountKey={COSMOS_EMULATOR_KEY};",
        AZURITE_BLOB_CONNECTION_STRING=(
            "DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;"
            f"AccountKey={AZURITE_ACCOUNT_KEY};BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
        ),
        DB_BACKEND="cosmos",
    )


def _mongo_settings() -> Settings:
    return Settings(
        MONGO_CONNECTION_STRING="mongodb://localhost:27017/?directConnection=true",
        MONGO_DATABASE_NAME="contract-test",
        DB_BACKEND="mongo",
    )


def _clear_cosmos(service: CosmosService) -> None:
    # The Cosmos emulator database is shared/persistent across test runs
    # (unlike Mongo, which is dropped per-test), so leftover documents from
    # earlier runs must be purged explicitly for test isolation.
    for process in service.list_processes():
        for job in service.list_jobs_for_process(process.id):
            service.delete_job(process.id, job.id)
        service.delete_process(process.id)


@pytest.fixture
def cosmos_store() -> Iterator[CosmosService]:
    service = CosmosService(_cosmos_settings())
    service.ensure_schema()
    _clear_cosmos(service)
    yield service
    _clear_cosmos(service)


@pytest.fixture
def mongo_store() -> Iterator[MongoService]:
    settings = _mongo_settings()
    client: MongoClient = MongoClient(settings.mongo_connection_string, tz_aware=True)
    client.drop_database(settings.mongo_database_name)
    service = MongoService(settings)
    service.ensure_schema()
    yield service
    client.drop_database(settings.mongo_database_name)
    client.close()


@pytest.fixture(params=["mongo", "cosmos"])
def data_store(request: pytest.FixtureRequest) -> DataStore:
    if request.param == "mongo":
        return request.getfixturevalue("mongo_store")
    return request.getfixturevalue("cosmos_store")


def make_process(**overrides: object) -> BusinessProcessDocument:
    process_id = overrides.pop("id", str(uuid4()))
    now = datetime.now(UTC).replace(microsecond=0)
    defaults: dict[str, object] = dict(
        id=process_id,
        name=f"Process {process_id}",
        description="Contract test process",
        allowedAnalyzerIds=["prebuilt-invoice"],
        allowedAnalyzers=[AnalyzerRef(id="prebuilt-invoice", name="Invoice")],
        confidenceThreshold=0.8,
        ownerEmail="owner@example.com",
        routingAnalyzerStatus=RoutingAnalyzerStatus.READY,
        routingAnalyzerId=f"idp-route-{process_id}",
        derivedAnalyzerIds={"prebuilt-invoice": f"idp-derived-{process_id}"},
        routingAnalyzerError=None,
        createdAt=now,
        updatedAt=now,
    )
    defaults.update(overrides)
    return BusinessProcessDocument.model_validate(defaults)


def make_job(process_id: str, **overrides: object) -> JobDocument:
    job_id = overrides.pop("id", str(uuid4()))
    now = datetime.now(UTC).replace(microsecond=0)
    defaults: dict[str, object] = dict(
        id=job_id,
        processId=process_id,
        correlationId=str(uuid4()),
        fileName="invoice-0042.pdf",
        contentType="application/pdf",
        blobPath=f"{process_id}/{job_id}/invoice-0042.pdf",
        status=JobStatus.SUCCEEDED,
        submittedAt=now,
        completedAt=now,
        detectedForm="prebuilt-invoice",
        detectedFormName="Invoice",
        unclassified=False,
        retryOfJobId=None,
        attempts=1,
        pages=[{"page": 1, "width": 8.5, "height": 11.0, "unit": "inch", "angle": 0.0}],
    )
    defaults.update(overrides)
    return JobDocument.model_validate(defaults)


class TestProcessCrud:
    def test_upsert_and_read_process_round_trips(self, data_store: DataStore) -> None:
        process = make_process()

        data_store.upsert_process(process)
        result = data_store.read_process(process.id)

        assert result == process

    def test_read_missing_process_raises_not_found(self, data_store: DataStore) -> None:
        with pytest.raises(DocumentNotFoundError):
            data_store.read_process(str(uuid4()))

    def test_upsert_process_overwrites_existing(self, data_store: DataStore) -> None:
        process = make_process()
        data_store.upsert_process(process)

        updated = process.model_copy(update={"description": "Updated description"})
        data_store.upsert_process(updated)

        assert data_store.read_process(process.id).description == "Updated description"

    def test_list_processes_orders_by_created_at_descending(self, data_store: DataStore) -> None:
        now = datetime.now(UTC).replace(microsecond=0)
        older = make_process(createdAt=now - timedelta(days=1), updatedAt=now - timedelta(days=1))
        newer = make_process(createdAt=now, updatedAt=now)
        data_store.upsert_process(older)
        data_store.upsert_process(newer)

        results = data_store.list_processes()

        ids = [process.id for process in results if process.id in {older.id, newer.id}]
        assert ids == [newer.id, older.id]

    def test_find_process_by_name_is_case_insensitive(self, data_store: DataStore) -> None:
        process = make_process(name="Invoice Intake")
        data_store.upsert_process(process)

        found = data_store.find_process_by_name("invoice intake")

        assert found is not None
        assert found.id == process.id

    def test_find_process_by_name_returns_none_when_missing(self, data_store: DataStore) -> None:
        assert data_store.find_process_by_name("does not exist") is None

    def test_delete_process_removes_it(self, data_store: DataStore) -> None:
        process = make_process()
        data_store.upsert_process(process)

        data_store.delete_process(process.id)

        with pytest.raises(DocumentNotFoundError):
            data_store.read_process(process.id)

    def test_delete_missing_process_raises_not_found(self, data_store: DataStore) -> None:
        with pytest.raises(DocumentNotFoundError):
            data_store.delete_process(str(uuid4()))


class TestJobCrud:
    def test_upsert_and_read_job_round_trips(self, data_store: DataStore) -> None:
        process = make_process()
        data_store.upsert_process(process)
        job = make_job(process.id)

        data_store.upsert_job(job)
        result = data_store.read_job(process.id, job.id)

        assert result == job

    def test_read_missing_job_raises_not_found(self, data_store: DataStore) -> None:
        with pytest.raises(DocumentNotFoundError):
            data_store.read_job(str(uuid4()), str(uuid4()))

    def test_delete_job_removes_it(self, data_store: DataStore) -> None:
        process = make_process()
        data_store.upsert_process(process)
        job = make_job(process.id)
        data_store.upsert_job(job)

        data_store.delete_job(process.id, job.id)

        with pytest.raises(DocumentNotFoundError):
            data_store.read_job(process.id, job.id)

    def test_delete_missing_job_raises_not_found(self, data_store: DataStore) -> None:
        with pytest.raises(DocumentNotFoundError):
            data_store.delete_job(str(uuid4()), str(uuid4()))

    def test_list_jobs_for_process_only_returns_matching_jobs(self, data_store: DataStore) -> None:
        process_a = make_process()
        process_b = make_process()
        data_store.upsert_process(process_a)
        data_store.upsert_process(process_b)
        job_a = make_job(process_a.id)
        job_b = make_job(process_b.id)
        data_store.upsert_job(job_a)
        data_store.upsert_job(job_b)

        results = data_store.list_jobs_for_process(process_a.id)

        assert [job.id for job in results] == [job_a.id]

    def test_list_running_jobs_before_filters_by_status_and_time(self, data_store: DataStore) -> None:
        process = make_process()
        data_store.upsert_process(process)
        now = datetime.now(UTC).replace(microsecond=0)

        old_running = make_job(
            process.id,
            status=JobStatus.RUNNING,
            submittedAt=now - timedelta(hours=2),
            completedAt=None,
        )
        recent_running = make_job(
            process.id,
            status=JobStatus.RUNNING,
            submittedAt=now,
            completedAt=None,
        )
        succeeded = make_job(process.id, status=JobStatus.SUCCEEDED, submittedAt=now - timedelta(hours=2))
        data_store.upsert_job(old_running)
        data_store.upsert_job(recent_running)
        data_store.upsert_job(succeeded)

        results = data_store.list_running_jobs_before(now - timedelta(hours=1))

        assert [job.id for job in results] == [old_running.id]


class TestJobQuerying:
    @pytest.fixture
    def process_with_jobs(self, data_store: DataStore) -> tuple[DataStore, BusinessProcessDocument]:
        process = make_process()
        data_store.upsert_process(process)
        now = datetime.now(UTC).replace(microsecond=0)

        jobs = [
            make_job(
                process.id,
                fileName="alpha.pdf",
                status=JobStatus.SUCCEEDED,
                detectedForm="prebuilt-invoice",
                unclassified=False,
                submittedAt=now - timedelta(hours=3),
                confidenceViolations=None,
                reviewedAt=None,
                pages=[
                    {"page": 1, "width": 8.5, "height": 11.0, "unit": "inch", "angle": 0.0},
                    {"page": 2, "width": 8.5, "height": 11.0, "unit": "inch", "angle": 0.0},
                ],
            ),
            make_job(
                process.id,
                fileName="beta.pdf",
                status=JobStatus.FAILED,
                detectedForm=None,
                unclassified=True,
                submittedAt=now - timedelta(hours=2),
                error="boom",
                pages=None,
            ),
            make_job(
                process.id,
                fileName="gamma.pdf",
                status=JobStatus.SUCCEEDED,
                detectedForm="custom-po-form",
                unclassified=False,
                submittedAt=now - timedelta(hours=1),
                confidenceViolations=["invoiceTotal"],
                reviewedAt=now,
                pages=[{"page": 1, "width": 8.5, "height": 11.0, "unit": "inch", "angle": 0.0}],
            ),
        ]
        for job in jobs:
            data_store.upsert_job(job)
        return data_store, process

    def test_list_jobs_with_no_filters_orders_by_submitted_at_descending(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(), limit=10)

        assert [job.fileName for job in results] == ["gamma.pdf", "beta.pdf", "alpha.pdf"]

    def test_list_jobs_respects_limit(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(), limit=2)

        assert len(results) == 2

    def test_list_jobs_filters_by_status(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(
            process.id, filters=JobFilters(statuses=[JobStatus.FAILED]), limit=10
        )

        assert [job.fileName for job in results] == ["beta.pdf"]

    def test_list_jobs_filters_by_detected_form(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(
            process.id, filters=JobFilters(detected_forms=["custom-po-form"]), limit=10
        )

        assert [job.fileName for job in results] == ["gamma.pdf"]

    def test_list_jobs_filters_by_has_violations(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(has_violations=True), limit=10)

        assert [job.fileName for job in results] == ["gamma.pdf"]

    def test_list_jobs_filters_by_reviewed(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(reviewed=True), limit=10)

        assert [job.fileName for job in results] == ["gamma.pdf"]

    def test_list_jobs_filters_by_unclassified(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(unclassified=True), limit=10)

        assert [job.fileName for job in results] == ["beta.pdf"]

    def test_list_jobs_filters_by_file_name_case_insensitively(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        results = data_store.list_jobs(process.id, filters=JobFilters(file_name="ALPHA"), limit=10)

        assert [job.fileName for job in results] == ["alpha.pdf"]

    def test_list_jobs_filters_by_submitted_range(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs
        now = datetime.now(UTC).replace(microsecond=0)

        results = data_store.list_jobs(
            process.id,
            filters=JobFilters(
                submitted_from=now - timedelta(hours=2, minutes=30),
                submitted_to=now - timedelta(hours=1, minutes=30),
            ),
            limit=10,
        )

        assert [job.fileName for job in results] == ["beta.pdf"]

    def test_count_jobs_matches_filtered_set(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        assert data_store.count_jobs(process.id, filters=JobFilters()) == 3
        assert data_store.count_jobs(process.id, filters=JobFilters(statuses=[JobStatus.FAILED])) == 1

    def test_sum_pages_sums_only_matching_jobs(
        self, process_with_jobs: tuple[DataStore, BusinessProcessDocument]
    ) -> None:
        data_store, process = process_with_jobs

        assert data_store.sum_pages(process.id, filters=JobFilters(statuses=[JobStatus.SUCCEEDED])) == 3
        assert data_store.sum_pages(process.id, filters=JobFilters(statuses=[JobStatus.FAILED])) == 0

    def test_list_jobs_scoped_to_process(self, data_store: DataStore) -> None:
        process_a = make_process()
        process_b = make_process()
        data_store.upsert_process(process_a)
        data_store.upsert_process(process_b)
        data_store.upsert_job(make_job(process_a.id, fileName="a.pdf"))
        data_store.upsert_job(make_job(process_b.id, fileName="b.pdf"))

        results = data_store.list_jobs(process_a.id, filters=JobFilters(), limit=10)

        assert [job.fileName for job in results] == ["a.pdf"]


class TestHealth:
    def test_check_health_returns_true_when_reachable(self, data_store: DataStore) -> None:
        assert data_store.check_health() is True
