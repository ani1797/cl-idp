"""Foundry AI Agent Judge client.

Wraps the Foundry Agent Service's current (non-classic) surface the same
way `app.cu.client.CuClient` wraps the Content Understanding SDK: one
lazily-constructed, reusable client per process, a narrow error hierarchy,
and no leakage of SDK types past this module's boundary.

Note on the Azure SDK surface: this talks to the **versioned Agents API**
(`azure-ai-projects>=2.3.0`'s `AIProjectClient.agents.create_version(...)`),
not the deprecating classic Assistants-API-style surface
(`azure-ai-agents`'s `AgentsClient.create_agent`/threads/runs). Agents
created this way show up under the Foundry portal's "Agents" tab as
versioned resources (`object: "agent.version"`), not classic
`asst_`-prefixed assistants. Conversations/Responses replace
threads/runs: each judge call is a single, stateless Responses API call
scoped to the agent via `project.get_openai_client(agent_name=...)` — no
conversation object is created since every adjudication is a one-shot,
independent turn (mirrors the old implementation's "new thread per job,
delete after" behaviour, just without a thread to delete).
"""

from __future__ import annotations

import logging
from typing import Any

import openai
from azure.ai.projects import AIProjectClient
from azure.ai.projects.models import (
    PromptAgentDefinition,
    PromptAgentDefinitionTextOptions,
    TextResponseFormatJsonSchema,
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
        # allow_preview=True is required for the agent-scoped OpenAI client
        # (`get_openai_client(agent_name=...)`) used below — the versioned
        # Agents/Responses surface is still a preview capability of the SDK.
        self._project = AIProjectClient(
            endpoint=endpoint, credential=self._credential, allow_preview=True
        )
        self._openai: openai.OpenAI | None = None
        self._agent_ensured = False

    def close(self) -> None:
        self._project.close()
        self._credential.close()

    def adjudicate(self, *, instructions: str, user_message: str) -> str:
        """Run one judge turn and return the agent's raw JSON reply text.

        Raises `JudgeError` on any failure; never returns a partial/invalid
        reply silently — parsing tolerance belongs to `app.judge.schema`,
        not this transport layer."""
        openai_client = self._ensure_agent(instructions)

        try:
            response = openai_client.responses.create(
                input=user_message,
                timeout=self._timeout_seconds,
            )
        except openai.OpenAIError as exc:
            raise JudgeRunFailedError(f"Judge agent response failed: {exc}") from exc
        except AzureError as exc:
            raise JudgeRunFailedError(f"Judge agent response failed: {exc}") from exc

        if response.status not in (None, "completed"):
            raise JudgeRunFailedError(
                f"Judge agent response ended in status {response.status}.",
                last_error=response.error,
            )

        text = response.output_text
        if not text:
            raise JudgeRunFailedError("Judge agent response completed with no reply message.")
        return text

    def _ensure_agent(self, instructions: str) -> openai.OpenAI:
        if self._agent_ensured and self._openai is not None:
            return self._openai

        try:
            self._project.agents.create_version(
                agent_name=self._agent_name,
                definition=PromptAgentDefinition(
                    model=self._model,
                    instructions=instructions,
                    # Structured output must be configured on the agent
                    # definition itself, not per-response-call: the
                    # Responses API rejects a `text` override once an
                    # `agent_reference` is specified ("Not allowed when
                    # agent is specified"), discovered via the live smoke
                    # test against the real Foundry project.
                    text=PromptAgentDefinitionTextOptions(
                        format=TextResponseFormatJsonSchema(
                            name=JUDGE_RESPONSE_SCHEMA_NAME,
                            description="Per-field judge verdicts",
                            schema=JUDGE_RESPONSE_SCHEMA,
                            strict=True,
                        )
                    ),
                ),
                metadata={"created-by": CREATED_BY_TAG},
            )
        except AzureError as exc:
            raise JudgeError(f"Failed to create/version the judge agent: {exc}") from exc

        self._openai = self._project.get_openai_client(agent_name=self._agent_name)
        self._agent_ensured = True
        return self._openai
