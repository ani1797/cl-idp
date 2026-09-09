from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from uuid import uuid4

from app.config import get_settings
from app.db.cosmos import CosmosService
from app.models import (
    AnalyzerRef,
    ArrayField,
    BusinessProcessDocument,
    JobDocument,
    JobStatus,
    NumberField,
    ObjectField,
    PageInfo,
    PageUnit,
    RoutingAnalyzerStatus,
    StringField,
)


def make_service_for_connection(
    endpoint: str,
    *,
    cosmos_tls_insecure: bool = False,
) -> CosmosService:
    service = object.__new__(CosmosService)
    service.settings = SimpleNamespace(cosmos_tls_insecure=cosmos_tls_insecure)
    service._connection_string = f"AccountEndpoint={endpoint};AccountKey=test-key;"
    return service


def test_should_not_verify_localhost_emulator_connection() -> None:
    service = make_service_for_connection("https://localhost:8081/")
    assert service._should_verify_connection() is False


def test_should_verify_non_localhost_connection_by_default() -> None:
    service = make_service_for_connection("https://cosmosdb-emulator:8081/")
    assert service._should_verify_connection() is True


def test_should_allow_explicit_insecure_tls_override_for_compose_dns() -> None:
    service = make_service_for_connection(
        "https://cosmosdb-emulator:8081/",
        cosmos_tls_insecure=True,
    )
    assert service._should_verify_connection() is False


def test_should_downgrade_insecure_compose_dns_connection_string_to_http() -> None:
    service = object.__new__(CosmosService)
    service.settings = SimpleNamespace(
        cosmos_connection_string="AccountEndpoint=https://cosmosdb-emulator:8081/;AccountKey=test-key;",
        cosmos_tls_insecure=True,
    )

    normalized = service._normalized_connection_string()

    assert "AccountEndpoint=http://cosmosdb-emulator:8081/" in normalized


def test_cosmos_round_trip_process_and_job() -> None:
    service = CosmosService(get_settings())
    service.ensure_containers()

    process_id = str(uuid4())
    job_id = str(uuid4())
    now = datetime.now(UTC).replace(microsecond=0)

    process = BusinessProcessDocument(
        id=process_id,
        name="Invoice Intake",
        description="Round-trip integration test",
        allowedAnalyzerIds=["prebuilt-invoice", "custom-po-form"],
        allowedAnalyzers=[
            AnalyzerRef(id="prebuilt-invoice", name="Invoice"),
            AnalyzerRef(id="custom-po-form", name="Purchase Order (custom)"),
        ],
        confidenceThreshold=0.8,
        ownerEmail="owner@example.com",
        routingAnalyzerStatus=RoutingAnalyzerStatus.READY,
        routingAnalyzerId=f"idp-route-{process_id}",
        derivedAnalyzerIds={
            "prebuilt-invoice": f"idp-derived-{process_id}-prebuilt-invoice",
            "custom-po-form": f"idp-derived-{process_id}-custom-po-form",
        },
        routingAnalyzerError=None,
        createdAt=now,
        updatedAt=now,
    )

    job = JobDocument(
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
        pages=[PageInfo(page=1, width=8.5, height=11.0, unit=PageUnit.INCH, angle=0.0)],
        fields=[
            NumberField(
                name="invoiceTotal",
                path="/invoiceTotal",
                type="number",
                value=1024.5,
                confidence=0.62,
                boundingBox=[0.1, 0.2, 0.4, 0.2, 0.4, 0.3, 0.1, 0.3],
                page=1,
                reviewedValue=None,
            ),
            ArrayField(
                name="items",
                path="/items",
                type="array",
                items=[
                    ObjectField(
                        name="0",
                        path="/items/0",
                        type="object",
                        properties={
                            "description": StringField(
                                name="description",
                                path="/items/0/description",
                                type="string",
                                value="2 Surface Pro 6",
                                confidence=0.42,
                                boundingBox=[0.4, 0.55, 0.5, 0.55, 0.5, 0.58, 0.4, 0.58],
                                page=1,
                                reviewedValue=None,
                            ),
                        },
                    ),
                ],
            ),
        ],
        confidenceViolations=["/invoiceTotal", "/items/0/description"],
        notificationSent=True,
        reviewedAt=None,
        error=None,
    )

    round_tripped_job = JobDocument.model_validate_json(job.model_dump_json())
    assert round_tripped_job.model_dump(mode="json") == job.model_dump(mode="json")

    stored_process = service.upsert_process(process)
    stored_job = service.upsert_job(job)

    try:
        fetched_process = service.read_process(process_id)
        fetched_job = service.read_job(process_id, job_id)
    finally:
        service.delete_job(process_id, job_id)
        service.delete_process(process_id)

    assert fetched_process == stored_process
    assert fetched_job == stored_job
    assert fetched_job.fields == job.fields
    assert fetched_job.confidenceViolations == ["/invoiceTotal", "/items/0/description"]
