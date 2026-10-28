from __future__ import annotations

import asyncio
from threading import Event
from types import SimpleNamespace

import httpx
import pytest
from fastapi import Request

from app import main as app_main
from app.auth import Principal
from app.config import get_settings
from app.db.base import JobSummaryCounts


@pytest.mark.parametrize("slow_operation", ["analyzers", "summary", "login", "authentication"])
def test_slow_dependency_does_not_block_other_requests(
    monkeypatch: pytest.MonkeyPatch, slow_operation: str
) -> None:
    started = Event()
    release = Event()
    finished = Event()

    def block() -> None:
        started.set()
        release.wait(timeout=2)
        finished.set()

    def list_analyzers(_client: object) -> list[object]:
        block()
        return []

    def summarize_jobs(*_args: object, **_kwargs: object) -> JobSummaryCounts:
        block()
        return JobSummaryCounts()

    def find_user_by_email(_email: str) -> None:
        block()

    def resolve_principal(request: Request, *_args: object) -> Principal:
        if slow_operation == "authentication" and request.headers.get("x-slow"):
            block()
        return Principal(user=None)

    monkeypatch.setattr(app_main, "initialize_observability", lambda _app: None)
    monkeypatch.setattr(app_main, "list_available_analyzers", list_analyzers)
    monkeypatch.setattr(app_main, "resolve_principal", resolve_principal)
    app = app_main.create_app()
    app.state.settings = get_settings()
    app.state.data_store = SimpleNamespace(
        list_processes=list,
        read_process=lambda _process_id: object(),
        summarize_jobs=summarize_jobs,
        find_user_by_email=find_user_by_email,
    )
    app.state.cu_client = object()

    async def exercise_requests() -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            if slow_operation == "login":
                slow_request = client.post(
                    "/auth/login", json={"email": "user@example.com", "password": "password"}
                )
            else:
                path = {
                    "analyzers": "/analyzers",
                    "summary": "/processes/example/jobs/summary",
                    "authentication": "/processes",
                }[slow_operation]
                slow_request = client.get(path, headers={"x-slow": "true"})
            task = asyncio.create_task(slow_request)
            try:
                assert await asyncio.to_thread(started.wait, 2)
                response = await client.get("/processes")
                assert response.status_code == 200
                assert response.json() == []
                assert not finished.is_set(), "Unrelated request waited for the slow dependency"
            finally:
                release.set()
                await task

    asyncio.run(exercise_requests())
