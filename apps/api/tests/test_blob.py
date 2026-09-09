from __future__ import annotations

from uuid import uuid4

from app.config import get_settings
from app.storage.blob import BlobService


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
