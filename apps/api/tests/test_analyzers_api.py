from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.cu import CURATED_PREBUILT_ANALYZER_IDS, CURATED_PREBUILT_ANALYZERS, CuClient


def test_list_analyzers_returns_502_when_cu_unreachable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app import main as app_main

    monkeypatch.setenv("CU_ENDPOINT", "http://127.0.0.1:9")
    monkeypatch.setenv("CU_API_KEY", "")
    get_settings.cache_clear()

    app = app_main.create_app()
    with TestClient(app) as client:
        response = client.get("/analyzers")

    assert response.status_code == 502
    assert response.json() == {
        "code": "content_understanding_unavailable",
        "message": "Content Understanding was unavailable while listing analyzers.",
        "details": None,
    }


@pytest.mark.live
def test_list_analyzers_composes_curated_and_live_custom_analyzers(
    live_api_client: TestClient,
    live_cu_env: dict[str, str],
) -> None:
    _ = live_cu_env
    response = live_api_client.get("/analyzers")

    assert response.status_code == 200
    body = response.json()
    returned_ids = [item["id"] for item in body]

    expected_curated_ids = [item.id for item in CURATED_PREBUILT_ANALYZERS]
    assert returned_ids[: len(expected_curated_ids)] == expected_curated_ids

    client = CuClient(get_settings())
    try:
        expected_custom_ids = sorted(
            analyzer.analyzer_id
            for analyzer in client.list_analyzers()
            if not analyzer.analyzer_id.startswith("prebuilt-")
            and not analyzer.analyzer_id.startswith("idp")
            and analyzer.tags.get("createdBy") != "cl-idp"
        )
    finally:
        client.close()

    actual_custom_ids = sorted(item["id"] for item in body if item["id"] not in CURATED_PREBUILT_ANALYZER_IDS)
    assert actual_custom_ids == expected_custom_ids
    assert all(item["kind"] == "prebuilt" for item in body[: len(expected_curated_ids)])
    assert all(item["kind"] == "custom" for item in body[len(expected_curated_ids) :])
    assert not any(item["id"].startswith("idp") for item in body)
