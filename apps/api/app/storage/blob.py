from __future__ import annotations

from dataclasses import dataclass

from azure.core.exceptions import AzureError, ResourceExistsError
from azure.storage.blob import BlobServiceClient, ContentSettings

from app.config import Settings

AZURITE_BLOB_API_VERSION = "2023-11-03"


@dataclass
class BlobService:
    settings: Settings

    def __post_init__(self) -> None:
        self._service = BlobServiceClient.from_connection_string(
            self.settings.azurite_blob_connection_string,
            api_version=AZURITE_BLOB_API_VERSION,
        )
        self._container = self._service.get_container_client(
            self.settings.blob_container_name
        )

    def ensure_container(self) -> None:
        try:
            self._container.create_container()
        except ResourceExistsError:
            return

    def check_health(self) -> bool:
        try:
            self._container.get_container_properties()
        except AzureError:
            return False
        return True

    def upload_bytes(self, blob_name: str, data: bytes, content_type: str) -> None:
        blob_client = self._container.get_blob_client(blob_name)
        blob_client.upload_blob(
            data,
            overwrite=True,
            content_settings=ContentSettings(content_type=content_type),
        )

    def download_bytes(self, blob_name: str) -> bytes:
        blob_client = self._container.get_blob_client(blob_name)
        return blob_client.download_blob().readall()

    def delete_blob(self, blob_name: str) -> None:
        blob_client = self._container.get_blob_client(blob_name)
        blob_client.delete_blob(delete_snapshots="include")

    def list_blob_names(self, *, prefix: str = "") -> list[str]:
        return [blob.name for blob in self._container.list_blobs(name_starts_with=prefix)]
