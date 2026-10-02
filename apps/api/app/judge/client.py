"""Foundry AI Agent Judge client.

Wraps `azure.ai.agents.AgentsClient` the same way `app.cu.client.CuClient`
wraps the Content Understanding SDK: one lazily-constructed, reusable
client per process, a narrow error hierarchy, and no leakage of SDK types
past this module's boundary.

Note on the Azure SDK surface: `azure-ai-projects`' `AIProjectClient` does
NOT expose `.agents` in the version used here — the real, current API is
the standalone `AgentsClient(endpoint, credential)` from `azure-ai-agents`,
confirmed via `scripts/spikes/judge_spike.py`. Only `azure-ai-agents` is a
dependency; `azure-ai-projects` is intentionally not used.
"""

from __future__ import annotations

import logging
import time
from typing import Any, ClassVar

from azure.ai.agents import AgentsClient
from azure.ai.agents.models import (
    Agent,
    ResponseFormatJsonSchema,
    ResponseFormatJsonSchemaType,
    RunStatus,
    ThreadRun,
)
from azure.core.exceptions import AzureError
from azure.identity import DefaultAzureCredential

from app.config import Settings
from app.judge.schema import JUDGE_RESPONSE_SCHEMA, JUDGE_RESPONSE_SCHEMA_NAME

logger = logging.getLogger(__name__)

CREATED_BY_TAG = "cl-idp"


class JudgeError(RuntimeError):
    """Base for all judge-client failures. Callers (the worker) treat every
    subclass identically: log it, record a `status=failed` JudgeReview, and
    otherwise proceed with the job unaffected."""


class JudgeNotConfiguredError(JudgeError):
    pass


class JudgeRunFailedError(JudgeError):
    def __init__(self, message: str, *, last_error: Any | None = None) -> None:
        super().__init__(message)
        self.last_error = last_error


class JudgeTimeoutError(JudgeError):
    pass


def project_endpoint_from_cu_endpoint(cu_endpoint: str) -> str | None:
    """Derive the Foundry Agent Service project endpoint from the Content
    Understanding account endpoint when `JUDGE_PROJECT_ENDPOINT` is unset.

    Same Azure AI Foundry account, different API surface/domain:
    `https://{account}.cognitiveservices.azure.com/` ->
    `https://{account}.services.ai.azure.com/api/projects/{project}`.
    This only works when the account's default project name matches the
    account name convention used by this deployment; set
    JUDGE_PROJECT_ENDPOINT explicitly if it does not.
    """
    endpoint = cu_endpoint.rstrip("/")
    if not endpoint or ".cognitiveservices.azure.com" not in endpoint:
        return None
    foundry_host = endpoint.replace(".cognitiveservices.azure.com", ".services.ai.azure.com")
    account = foundry_host.split("//", 1)[-1].split(".", 1)[0]
    project = (
        account.removesuffix("-foundry") + "-project" if account.endswith("-foundry") else account
    )
    return f"{foundry_host}/api/projects/{project}"


class JudgeClient:
    def __init__(self, settings: Settings) -> None:
        if not settings.judge_enabled:
            raise JudgeNotConfiguredError("Judge is disabled (JUDGE_ENABLED is false).")

        endpoint = settings.judge_project_endpoint or project_endpoint_from_cu_endpoint(
            settings.cu_endpoint
        )
        if not endpoint:
            raise JudgeNotConfiguredError(
                "Could not resolve a Foundry project endpoint: set JUDGE_PROJECT_ENDPOINT "
                "(or CU_ENDPOINT, which it is derived from)."
            )

        self._model = settings.judge_model_deployment
        self._agent_name = settings.judge_agent_name
        self._timeout_seconds = settings.judge_timeout_seconds
        self._credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
        self._client = AgentsClient(endpoint=endpoint, credential=self._credential)
        self._agent_id: str | None = None

    def close(self) -> None:
        self._client.close()
        self._credential.close()

    def adjudicate(self, *, instructions: str, user_message: str) -> str:
        """Run one judge turn and return the agent's raw JSON reply text.

        Raises `JudgeError` on any failure; never returns a partial/invalid
        reply silently — parsing tolerance belongs to `app.judge.schema`,
        not this transport layer."""
        agent_id = self._resolve_agent(instructions)
        thread = self._client.threads.create()
        try:
            self._client.messages.create(thread_id=thread.id, role="user", content=user_message)
            try:
                run = self._client.runs.create(
                    thread_id=thread.id,
                    agent_id=agent_id,
                    response_format=ResponseFormatJsonSchemaType(
                        json_schema=ResponseFormatJsonSchema(
                            name=JUDGE_RESPONSE_SCHEMA_NAME,
                            description="Per-field judge verdicts",
                            schema=JUDGE_RESPONSE_SCHEMA,
                        )
                    ),
                )
                run = self._poll_until_done(thread_id=thread.id, run_id=run.id)
            except AzureError as exc:
                raise JudgeRunFailedError(f"Judge agent run failed: {exc}") from exc

            if run.status != RunStatus.COMPLETED:
                raise JudgeRunFailedError(
                    f"Judge agent run ended in status {run.status}.", last_error=run.last_error
                )

            for message in self._client.messages.list(thread_id=thread.id):
                if str(message.role).endswith("AGENT"):
                    return message.content[0]["text"]["value"]
            raise JudgeRunFailedError("Judge agent run completed with no reply message.")
        finally:
            try:
                self._client.threads.delete(thread.id)
            except AzureError:
                logger.warning("Failed to delete judge thread %s", thread.id, exc_info=True)

    _TERMINAL_STATUSES: ClassVar[set[RunStatus]] = {
        RunStatus.COMPLETED,
        RunStatus.FAILED,
        RunStatus.CANCELLED,
        RunStatus.EXPIRED,
    }

    def _poll_until_done(
        self, *, thread_id: str, run_id: str, poll_interval_seconds: float = 1.0
    ) -> ThreadRun:
        deadline = time.monotonic() + self._timeout_seconds
        run = self._client.runs.get(thread_id=thread_id, run_id=run_id)
        while run.status not in self._TERMINAL_STATUSES:
            if time.monotonic() >= deadline:
                raise JudgeTimeoutError(
                    f"Judge agent run exceeded the {self._timeout_seconds}s timeout."
                )
            time.sleep(poll_interval_seconds)
            run = self._client.runs.get(thread_id=thread_id, run_id=run_id)
        return run

    def _resolve_agent(self, instructions: str) -> str:
        if self._agent_id is not None:
            return self._agent_id

        try:
            for agent in self._client.list_agents():
                if agent.name == self._agent_name:
                    self._agent_id = agent.id
                    return self._agent_id
        except AzureError as exc:
            raise JudgeError(f"Failed to list Foundry agents: {exc}") from exc

        try:
            agent: Agent = self._client.create_agent(
                model=self._model,
                name=self._agent_name,
                instructions=instructions,
                metadata={"created-by": CREATED_BY_TAG},
            )
        except AzureError as exc:
            raise JudgeError(f"Failed to create the judge agent: {exc}") from exc
        self._agent_id = agent.id
        return self._agent_id
