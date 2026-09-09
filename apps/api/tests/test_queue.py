from __future__ import annotations

from uuid import uuid4

from app.config import get_settings
from app.storage.queue import QueueService


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
