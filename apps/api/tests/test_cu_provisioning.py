from __future__ import annotations

import time
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.cu import (
    CuClient,
    derived_analyzer_id,
    provision_process_routing_analyzer,
    routing_analyzer_id,
)
from app.db import CosmosService
from app.models import AnalyzerRef, BusinessProcessDocument, RoutingAnalyzerStatus
from app.storage import BlobService


def process_payload(allowed_analyzer_ids: list[str]) -> dict[str, object]:
    return {
        "name": f"Provisioning Test {uuid4()}",
        "description": "Live provisioning test",
        "allowedAnalyzerIds": allowed_analyzer_ids,
        "confidenceThreshold": 0.8,
        "ownerEmail": "owner@example.com",
    }


def wait_for_process_status(
    cosmos: CosmosService,
    process_id: str,
    expected_status: RoutingAnalyzerStatus,
    *,
    timeout_seconds: float = 180,
) -> BusinessProcessDocument:
    deadline = time.monotonic() + timeout_seconds
    while True:
        process = cosmos.read_process(process_id)
        if process.routingAnalyzerStatus == expected_status:
            return process
        if process.routingAnalyzerStatus == RoutingAnalyzerStatus.FAILED:
            raise AssertionError(process.routingAnalyzerError)
        if time.monotonic() >= deadline:
            raise AssertionError(
                f"Timed out waiting for process {process_id} to reach {expected_status.value}."
            )
        time.sleep(2)


def cleanup_process_analyzers(process: BusinessProcessDocument) -> None:
    client = CuClient(get_settings())
    try:
        for analyzer_id in sorted(process.derivedAnalyzerIds.values(), key=len, reverse=True):
            client.delete_analyzer(analyzer_id)
        if process.routingAnalyzerId:
            client.delete_analyzer(process.routingAnalyzerId)
    finally:
        client.close()


@pytest.mark.live
def test_background_provisioning_builds_routing_analyzer_with_direct_fallback(
    live_api_client: TestClient,
    live_services: tuple[CosmosService, BlobService],
) -> None:
    cosmos, _ = live_services
    response = live_api_client.post(
        "/processes",
        json=process_payload(["prebuilt-invoice", "prebuilt-receipt"]),
    )

    assert response.status_code == 201
    body = response.json()
    assert body["routingAnalyzerStatus"] == "building"

    process = wait_for_process_status(cosmos, body["id"], RoutingAnalyzerStatus.READY)
    assert process.routingAnalyzerId == routing_analyzer_id(process.id)
    assert "prebuilt-invoice" not in process.derivedAnalyzerIds
    assert process.routingAnalyzerError is None

    client = CuClient(get_settings())
    try:
        routing = client.get_analyzer(process.routingAnalyzerId or "")
        assert routing.models is not None
        assert "completion" in routing.models
        assert routing.config is not None
        assert routing.config["enableSegment"] is False
        assert routing.config["omitContent"] is False
        categories = routing.config["contentCategories"]
        assert categories["prebuilt-invoice"]["analyzerId"] == "prebuilt-invoice"
        assert categories["other"]["description"] == "Any document not matching the categories above"
    finally:
        client.close()
        cleanup_process_analyzers(process)


@pytest.mark.live
def test_provisioning_fails_for_missing_selected_analyzer(
    live_services: tuple[CosmosService, BlobService],
) -> None:
    cosmos, _ = live_services
    now = datetime.now(UTC)
    process = cosmos.upsert_process(
        BusinessProcessDocument(
            id=str(uuid4()),
            name=f"Stale Analyzer {uuid4()}",
            description="Live stale analyzer test",
            allowedAnalyzerIds=["not-a-real-analyzer"],
            allowedAnalyzers=[AnalyzerRef(id="not-a-real-analyzer", name="Missing analyzer")],
            confidenceThreshold=0.8,
            ownerEmail="owner@example.com",
            routingAnalyzerStatus=RoutingAnalyzerStatus.BUILDING,
            routingAnalyzerError=None,
            routingAnalyzerId=None,
            derivedAnalyzerIds={},
            createdAt=now,
            updatedAt=now,
        )
    )

    provision_process_routing_analyzer(
        settings=get_settings(),
        cosmos=cosmos,
        process_id=process.id,
    )

    stored = cosmos.read_process(process.id)
    assert stored.routingAnalyzerStatus == RoutingAnalyzerStatus.FAILED
    assert stored.routingAnalyzerError is not None
    assert "not-a-real-analyzer" in stored.routingAnalyzerError
    assert stored.derivedAnalyzerIds == {}


@pytest.mark.live
def test_rebuild_with_changed_analyzer_set_keeps_deterministic_ids(
    live_api_client: TestClient,
    live_services: tuple[CosmosService, BlobService],
) -> None:
    cosmos, _ = live_services
    created = live_api_client.post("/processes", json=process_payload(["prebuilt-invoice"]))
    assert created.status_code == 201
    process_id = created.json()["id"]

    first_ready = wait_for_process_status(cosmos, process_id, RoutingAnalyzerStatus.READY)
    expected_routing_id = routing_analyzer_id(process_id)
    assert first_ready.routingAnalyzerId == expected_routing_id
    for source_id, derived_id_value in first_ready.derivedAnalyzerIds.items():
        assert derived_id_value == derived_analyzer_id(process_id, source_id)

    update_response = live_api_client.put(
        f"/processes/{process_id}",
        json={
            **process_payload(["prebuilt-invoice", "prebuilt-receipt"]),
            "name": first_ready.name,
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["routingAnalyzerStatus"] == "building"

    second_ready = wait_for_process_status(cosmos, process_id, RoutingAnalyzerStatus.READY)
    assert second_ready.routingAnalyzerId == expected_routing_id
    for source_id, derived_id_value in second_ready.derivedAnalyzerIds.items():
        assert derived_id_value == derived_analyzer_id(process_id, source_id)

    cleanup_process_analyzers(second_ready)
