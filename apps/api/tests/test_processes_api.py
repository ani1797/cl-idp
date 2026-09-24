from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.db import DataStore, DocumentNotFoundError
from app.models import JobDocument, JobStatus, RoutingAnalyzerStatus
from app.storage import BlobService


def process_payload(
    *,
    name: str = "Invoice Intake",
    description: str = "Invoices",
    allowed_analyzer_ids: list[str] | None = None,
) -> dict[str, object]:
    return {
        "name": name,
        "description": description,
        "allowedAnalyzerIds": allowed_analyzer_ids or ["prebuilt-invoice"],
        "confidenceThreshold": 0.8,
        "ownerEmail": "owner@example.com",
    }


def test_list_processes_returns_empty_array(api_client: TestClient) -> None:
    response = api_client.get("/processes")

    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.live
def test_create_list_and_get_process(live_api_client: TestClient) -> None:
    create_response = live_api_client.post("/processes", json=process_payload())

    assert create_response.status_code == 201
    created = create_response.json()
    assert created["routingAnalyzerStatus"] == "building"
    assert created["allowedAnalyzers"] == [{"id": "prebuilt-invoice", "name": "Invoice"}]

    list_response = live_api_client.get("/processes")
    assert list_response.status_code == 200
    assert [item["id"] for item in list_response.json()] == [created["id"]]

    get_response = live_api_client.get(f"/processes/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["name"] == "Invoice Intake"


@pytest.mark.live
def test_create_process_rejects_duplicate_name_case_insensitively(
    live_api_client: TestClient,
) -> None:
    first = live_api_client.post("/processes", json=process_payload(name="Invoice Intake"))
    duplicate = live_api_client.post("/processes", json=process_payload(name="invoice intake"))

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["code"] == "duplicate_process_name"


@pytest.mark.parametrize(
    ("payload", "expected_message"),
    [
        (
            process_payload(allowed_analyzer_ids=[f"prebuilt-{index}" for index in range(200)]),
            "The request was invalid.",
        ),
        (
            process_payload(allowed_analyzer_ids=["prebuilt-invoice", "prebuilt-invoice"]),
            "The request was invalid.",
        ),
        (
            process_payload(allowed_analyzer_ids=["other"]),
            "The analyzer ID 'other' is reserved and cannot be selected.",
        ),
    ],
)
def test_create_process_rejects_invalid_analyzer_payloads(
    api_client: TestClient,
    payload: dict[str, object],
    expected_message: str,
) -> None:
    response = api_client.post("/processes", json=payload)

    assert response.status_code == 400
    assert response.json()["message"] == expected_message


@pytest.mark.live
def test_create_process_rejects_unknown_analyzer_id(live_api_client: TestClient) -> None:
    response = live_api_client.post(
        "/processes",
        json=process_payload(allowed_analyzer_ids=["not-a-real-analyzer"]),
    )

    assert response.status_code == 400
    assert response.json() == {
        "code": "invalid_analyzer_selection",
        "message": "Unknown analyzer ID: not-a-real-analyzer",
        "details": {"analyzerId": "not-a-real-analyzer"},
    }


@pytest.mark.live
def test_update_description_only_keeps_routing_status(
    live_api_client: TestClient,
    live_services: tuple[DataStore, BlobService],
) -> None:
    cosmos, _ = live_services
    created = live_api_client.post("/processes", json=process_payload()).json()
    stored = cosmos.read_process(created["id"])
    cosmos.upsert_process(
        stored.model_copy(
            update={
                "routingAnalyzerStatus": RoutingAnalyzerStatus.READY,
                "routingAnalyzerError": "previous error",
            }
        )
    )

    response = live_api_client.put(
        f"/processes/{created['id']}",
        json=process_payload(description="Updated description"),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["description"] == "Updated description"
    assert body["routingAnalyzerStatus"] == "ready"
    assert body["routingAnalyzerError"] == "previous error"


@pytest.mark.live
def test_update_allowed_analyzers_resets_routing_status_to_building(
    live_api_client: TestClient,
    live_services: tuple[DataStore, BlobService],
) -> None:
    cosmos, _ = live_services
    created = live_api_client.post("/processes", json=process_payload()).json()
    stored = cosmos.read_process(created["id"])
    cosmos.upsert_process(
        stored.model_copy(
            update={
                "routingAnalyzerStatus": RoutingAnalyzerStatus.READY,
                "routingAnalyzerError": "previous error",
            }
        )
    )

    response = live_api_client.put(
        f"/processes/{created['id']}",
        json=process_payload(allowed_analyzer_ids=["prebuilt-invoice", "prebuilt-receipt"]),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["allowedAnalyzerIds"] == ["prebuilt-invoice", "prebuilt-receipt"]
    assert body["routingAnalyzerStatus"] == "building"
    assert body["routingAnalyzerError"] is None


@pytest.mark.live
def test_update_process_rejects_name_collision(live_api_client: TestClient) -> None:
    first = live_api_client.post("/processes", json=process_payload(name="Invoice Intake"))
    second = live_api_client.post("/processes", json=process_payload(name="Receipts Intake"))

    response = live_api_client.put(
        f"/processes/{second.json()['id']}",
        json=process_payload(name="invoice intake"),
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert response.status_code == 409
    assert response.json()["code"] == "duplicate_process_name"


@pytest.mark.parametrize("method", ["GET", "PUT", "DELETE"])
def test_process_endpoints_return_404_for_missing_process(
    api_client: TestClient,
    method: str,
) -> None:
    process_id = str(uuid4())
    if method == "GET":
        response = api_client.get(f"/processes/{process_id}")
    elif method == "PUT":
        response = api_client.put(f"/processes/{process_id}", json=process_payload())
    else:
        response = api_client.delete(f"/processes/{process_id}")

    assert response.status_code == 404
    assert response.json()["code"] == "process_not_found"


@pytest.mark.live
def test_delete_process_cascades_jobs_and_blobs(
    live_api_client: TestClient,
    live_services: tuple[DataStore, BlobService],
) -> None:
    cosmos, blob = live_services
    created = live_api_client.post("/processes", json=process_payload()).json()
    process_id = created["id"]
    job_id = str(uuid4())
    now = datetime.now(UTC)

    cosmos.upsert_job(
        JobDocument(
            id=job_id,
            processId=process_id,
            correlationId=str(uuid4()),
            fileName="invoice.pdf",
            contentType="application/pdf",
            blobPath=f"{process_id}/{job_id}/invoice.pdf",
            status=JobStatus.QUEUED,
            submittedAt=now,
            completedAt=None,
            detectedForm=None,
            detectedFormName=None,
            unclassified=None,
            retryOfJobId=None,
            pages=None,
            fields=None,
            fieldCount=None,
            confidenceViolations=None,
            error=None,
            reviewedAt=None,
        )
    )
    blob.upload_bytes(f"{process_id}/{job_id}/invoice.pdf", b"pdf-bytes", "application/pdf")

    response = live_api_client.delete(f"/processes/{process_id}")

    assert response.status_code == 204
    assert live_api_client.get(f"/processes/{process_id}").status_code == 404
    with pytest.raises(DocumentNotFoundError):
        cosmos.read_job(process_id, job_id)
    assert blob.list_blob_names(prefix=f"{process_id}/") == []


def test_create_process_returns_502_when_cu_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main as app_main

    monkeypatch.setenv("CU_ENDPOINT", "http://127.0.0.1:9")
    monkeypatch.setenv("CU_API_KEY", "")
    get_settings.cache_clear()

    app = app_main.create_app()
    with TestClient(app) as client:
        response = client.post("/processes", json=process_payload())

    assert response.status_code == 502
    assert response.json() == {
        "code": "content_understanding_unavailable",
        "message": "Content Understanding was unavailable while resolving analyzers.",
        "details": None,
    }


def test_update_description_only_does_not_schedule_reprovisioning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main as app_main
    from app.models import AnalyzerRef, BusinessProcessDocument

    scheduled_process_ids: list[str] = []

    def fake_resolve_allowed_analyzers(
        selected_ids: list[str],
        cu_client: object,
    ) -> list[AnalyzerRef]:
        _ = cu_client
        return [AnalyzerRef(id=analyzer_id, name=analyzer_id) for analyzer_id in selected_ids]

    def fake_schedule(
        application: object,
        background_tasks: object,
        process: BusinessProcessDocument,
    ) -> None:
        _ = application, background_tasks
        scheduled_process_ids.append(process.id)

    monkeypatch.setattr(app_main, "resolve_allowed_analyzers", fake_resolve_allowed_analyzers)
    monkeypatch.setattr(app_main, "schedule_routing_analyzer_provisioning", fake_schedule)

    app = app_main.create_app()
    with TestClient(app) as client:
        created = client.post("/processes", json=process_payload())
        assert created.status_code == 201
        process_id = created.json()["id"]

        updated = client.put(
            f"/processes/{process_id}",
            json=process_payload(description="Updated without analyzer changes"),
        )

    assert updated.status_code == 200
    assert scheduled_process_ids == [process_id]
