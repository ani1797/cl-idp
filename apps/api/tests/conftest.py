from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path
from typing import cast

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app import main as app_main
from app.config import AZURITE_ACCOUNT_KEY, COSMOS_EMULATOR_KEY, get_settings
from app.cu import ContentUnderstandingError, CuClient
from app.db import DataStore
from app.storage import BlobService, QueueService


@pytest.fixture(autouse=True)
def configure_test_environment(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    # Isolate the test suite's Mongo database from the "enterprise-idp"
    # database the docker-compose dev stack (and seed scripts) use by
    # default. Without this, running pytest against the default
    # DB_BACKEND=mongo would repeatedly wipe seeded dev data via
    # clean_backend_state, since tests otherwise share the same local
    # mongo:7 instance as the dev/seed workflow.
    monkeypatch.setenv("MONGO_DATABASE_NAME", "enterprise-idp-test")
    monkeypatch.setenv(
        "COSMOS_CONNECTION_STRING",
        f"AccountEndpoint=https://localhost:8081/;AccountKey={COSMOS_EMULATOR_KEY};",
    )
    monkeypatch.setenv(
        "AZURITE_BLOB_CONNECTION_STRING",
        "DefaultEndpointsProtocol=http;"
        "AccountName=devstoreaccount1;"
        f"AccountKey={AZURITE_ACCOUNT_KEY};"
        "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;",
    )
    monkeypatch.setenv(
        "AZURITE_QUEUE_CONNECTION_STRING",
        "DefaultEndpointsProtocol=http;"
        "AccountName=devstoreaccount1;"
        f"AccountKey={AZURITE_ACCOUNT_KEY};"
        "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;",
    )
    # Same isolation problem as Mongo above, but for blob/queue storage:
    # tests share the same Azurite account/ports as the docker-compose dev
    # stack, so clean_backend_state()'s blob/queue clearing would otherwise
    # delete seeded documents and drain the live worker's job queue. Use a
    # dedicated container/queue name so tests never touch the dev ones.
    monkeypatch.setenv("BLOB_CONTAINER_NAME", "documents-test")
    monkeypatch.setenv("QUEUE_NAME", "jobs-test")
    monkeypatch.setenv("SMTP_HOST", "127.0.0.1")
    monkeypatch.setenv("SMTP_PORT", "1025")
    monkeypatch.setenv("WEB_ORIGIN", "http://localhost:3000")
    monkeypatch.setenv("NEXT_PUBLIC_API_BASE_URL", "http://localhost:8000")
    if "CU_ENDPOINT" not in os.environ:
        monkeypatch.setenv("CU_ENDPOINT", "https://example.services.ai.azure.com/")
    if "CU_API_KEY" not in os.environ:
        monkeypatch.setenv("CU_API_KEY", "")
    if "CU_MODEL_DEPLOYMENT" not in os.environ:
        monkeypatch.setenv("CU_MODEL_DEPLOYMENT", "demo-model")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


@pytest.fixture
def api_client() -> Iterator[TestClient]:
    get_settings.cache_clear()
    app = app_main.create_app()
    with TestClient(app) as client:
        fastapi_app = cast(FastAPI, client.app)
        clean_backend_state(
            fastapi_app.state.data_store,
            fastapi_app.state.blob_service,
            fastapi_app.state.queue_service,
        )
        yield client
        clean_backend_state(
            fastapi_app.state.data_store,
            fastapi_app.state.blob_service,
            fastapi_app.state.queue_service,
        )


@pytest.fixture
def live_cu_env(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    env_values = load_live_cu_values()
    for key, value in env_values.items():
        if value:
            monkeypatch.setenv(key, value)
        elif key in os.environ:
            monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()

    client = CuClient(get_settings())
    try:
        client.list_analyzers()
    except ContentUnderstandingError as exc:
        pytest.skip(f"live CU unavailable: {exc}")
    finally:
        client.close()

    return env_values


@pytest.fixture
def live_api_client(live_cu_env: dict[str, str]) -> Iterator[TestClient]:
    _ = live_cu_env
    get_settings.cache_clear()
    app = app_main.create_app()
    with TestClient(app) as client:
        fastapi_app = cast(FastAPI, client.app)
        clean_backend_state(
            fastapi_app.state.data_store,
            fastapi_app.state.blob_service,
            fastapi_app.state.queue_service,
        )
        yield client
        clean_backend_state(
            fastapi_app.state.data_store,
            fastapi_app.state.blob_service,
            fastapi_app.state.queue_service,
        )


@pytest.fixture
def services(api_client: TestClient) -> tuple[DataStore, BlobService]:
    fastapi_app = cast(FastAPI, api_client.app)
    return fastapi_app.state.data_store, fastapi_app.state.blob_service


@pytest.fixture
def live_services(live_api_client: TestClient) -> tuple[DataStore, BlobService]:
    fastapi_app = cast(FastAPI, live_api_client.app)
    return fastapi_app.state.data_store, fastapi_app.state.blob_service


def clean_backend_state(data_store: DataStore, blob: BlobService, queue: QueueService) -> None:
    queue.clear_messages()

    for process in data_store.list_processes():
        for job in data_store.list_jobs_for_process(process.id):
            data_store.delete_job(process.id, job.id)
        data_store.delete_process(process.id)

    for blob_name in blob.list_blob_names():
        blob.delete_blob(blob_name)


def load_live_cu_values() -> dict[str, str]:
    if "CU_ENDPOINT" in os.environ:
        endpoint = os.environ.get("CU_ENDPOINT", "")
        if not endpoint:
            pytest.skip("CU_ENDPOINT is unset; skipping live CU tests.")
        if "example.services.ai.azure.com" not in endpoint:
            return {
                "CU_ENDPOINT": endpoint,
                "CU_API_KEY": os.environ.get("CU_API_KEY", ""),
                "CU_MODEL_DEPLOYMENT": os.environ.get("CU_MODEL_DEPLOYMENT", ""),
            }

    for candidate in (
        Path(__file__).resolve().parents[1] / ".env",
        Path(__file__).resolve().parents[3] / ".env",
    ):
        if not candidate.exists():
            continue
        values = parse_env_file(candidate)
        endpoint = values.get("CU_ENDPOINT", "")
        if endpoint and "example.services.ai.azure.com" not in endpoint:
            return {
                "CU_ENDPOINT": endpoint,
                "CU_API_KEY": values.get("CU_API_KEY", ""),
                "CU_MODEL_DEPLOYMENT": values.get("CU_MODEL_DEPLOYMENT", ""),
            }
    pytest.skip("No live CU configuration found in apps/api/.env or repo-root .env.")


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text().splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values
