from __future__ import annotations

from unittest.mock import patch
from uuid import uuid4

from app.config import Settings, get_settings
from app.storage.queue import QueueService


def test_queue_uses_identity_instead_of_storage_keys() -> None:
    settings = Settings(
        AZURE_STORAGE_ACCOUNT_NAME="testaccount",
        AZURITE_QUEUE_CONNECTION_STRING="not-a-connection-string",
    )
    with (
        patch("app.storage.queue.DefaultAzureCredential") as credential,
        patch("app.storage.queue.QueueServiceClient") as client,
    ):
        service = QueueService(settings)
        service.ensure_queue()

    client.assert_called_once_with(
        account_url="https://testaccount.queue.core.windows.net",
        credential=credential.return_value,
        api_version="2023-11-03",
    )
    client.from_connection_string.assert_not_called()
    client.return_value.get_queue_client.return_value.create_queue.assert_called_once()


def test_queue_preserves_connection_string_auth_for_local_storage() -> None:
    settings = Settings(AZURE_STORAGE_ACCOUNT_NAME="")
    with (
        patch("app.storage.queue.DefaultAzureCredential") as credential,
        patch("app.storage.queue.QueueServiceClient") as client,
    ):
        QueueService(settings)

    credential.assert_not_called()
    client.from_connection_string.assert_called_once_with(
        settings.azurite_queue_connection_string, api_version="2023-11-03"
    )


def test_queue_round_trip() -> None:
    service = QueueService(get_settings())
    service.ensure_queue()
    service.clear_messages()

    content = f"queue-round-trip:{uuid4()}"
    service.send_message(content)

    messages = service.receive_messages(max_messages=1)
    assert messages
    message = messages[0]
    try:
        assert message.content == content
    finally:
        service.delete_message(message)
