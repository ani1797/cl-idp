from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from azure.core.exceptions import AzureError, ResourceExistsError
from azure.storage.queue import QueueMessage, QueueServiceClient

from app.config import Settings

JOBS_QUEUE = "jobs"
AZURITE_QUEUE_API_VERSION = "2023-11-03"


@dataclass
class QueueService:
    settings: Settings

    def __post_init__(self) -> None:
        self._service = QueueServiceClient.from_connection_string(
            self.settings.azurite_queue_connection_string,
            api_version=AZURITE_QUEUE_API_VERSION,
        )
        self._queue = self._service.get_queue_client(JOBS_QUEUE)

    def ensure_queue(self) -> None:
        try:
            self._queue.create_queue()
        except ResourceExistsError:
            return

    def check_health(self) -> bool:
        try:
            self._queue.get_queue_properties()
        except AzureError:
            return False
        return True

    def clear_messages(self) -> None:
        self._queue.clear_messages()

    def send_message(self, content: str) -> QueueMessage:
        return self._queue.send_message(content)

    def receive_messages(
        self,
        *,
        max_messages: int = 1,
        visibility_timeout: int | None = None,
    ) -> list[QueueMessage]:
        return list(
            self._queue.receive_messages(
                max_messages=max_messages,
                visibility_timeout=visibility_timeout,
            )
        )

    def delete_message(self, message: QueueMessage) -> None:
        self._queue.delete_message(message)

    def queue_properties(self) -> dict[str, Any]:
        return dict(self._queue.get_queue_properties())
