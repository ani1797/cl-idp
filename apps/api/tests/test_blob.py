from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from app.config import Settings, get_settings
from app.storage.blob import BlobService


def test_blob_uses_identity_instead_of_storage_keys() -> None:
    settings = Settings(
        AZURE_STORAGE_ACCOUNT_NAME="testaccount",
        AZURITE_BLOB_CONNECTION_STRING="not-a-connection-string",
    )
    with (
        patch("app.storage.blob.DefaultAzureCredential") as credential,
        patch("app.storage.blob.BlobServiceClient") as client,
    ):
        service = BlobService(settings)
        service.ensure_container()

    client.assert_called_once_with(
        account_url="https://testaccount.blob.core.windows.net",
        credential=credential.return_value,
        api_version="2023-11-03",
    )
    client.from_connection_string.assert_not_called()
    client.return_value.get_container_client.return_value.create_container.assert_called_once()


def test_blob_preserves_connection_string_auth_for_local_storage() -> None:
    settings = Settings(AZURE_STORAGE_ACCOUNT_NAME="")
    with (
        patch("app.storage.blob.DefaultAzureCredential") as credential,
        patch("app.storage.blob.BlobServiceClient") as client,
    ):
        BlobService(settings)

    credential.assert_not_called()
    client.from_connection_string.assert_called_once_with(
        settings.azurite_blob_connection_string, api_version="2023-11-03"
    )


def test_blob_round_trip() -> None:
    service = BlobService(get_settings())
    service.ensure_container()

    blob_name = f"test-process/{uuid4()}/sample.txt"
    payload = b"enterprise-idp-blob-round-trip"

    service.upload_bytes(blob_name, payload, "text/plain")
    try:
        downloaded = service.download_bytes(blob_name)
    finally:
        service.delete_blob(blob_name)

    assert downloaded == payload
