from __future__ import annotations

import logging
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

COSMOS_EMULATOR_KEY = (
    "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMb"
    "IZnqyMsEcaGQy67XIw/Jw=="
)
AZURITE_ACCOUNT_KEY = (
    "Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1"
    "SZFPTOtr/KBHBeksoGMGw=="
)
API_ROOT = Path(__file__).resolve().parents[1]


def _resolve_repo_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "docker-compose.yml").exists() and (candidate / "apps").exists():
            return candidate
    return API_ROOT


REPO_ROOT = _resolve_repo_root()
logger = logging.getLogger(__name__)


def _ephemeral_jwt_secret() -> str:
    logger.warning(
        "JWT_SECRET is unset; generated an ephemeral development-only secret. "
        "Set JWT_SECRET in production so sessions survive restarts."
    )
    return secrets.token_urlsafe(48)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(REPO_ROOT / ".env", API_ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    db_backend: str = Field(default="mongo", alias="DB_BACKEND")
    mongo_connection_string: str = Field(
        default="mongodb://localhost:27017/?directConnection=true",
        alias="MONGO_CONNECTION_STRING",
    )
    mongo_database_name: str = Field(default="enterprise-idp", alias="MONGO_DATABASE_NAME")
    cosmos_connection_string: str = Field(
        default=(
            "AccountEndpoint=https://localhost:8081/;"
            f"AccountKey={COSMOS_EMULATOR_KEY};"
        ),
        alias="COSMOS_CONNECTION_STRING",
    )
    azurite_blob_connection_string: str = Field(
        default=(
            "DefaultEndpointsProtocol=http;"
            "AccountName=devstoreaccount1;"
            f"AccountKey={AZURITE_ACCOUNT_KEY};"
            "BlobEndpoint=http://127.0.0.1:10000/devstoreaccount1;"
        ),
        alias="AZURITE_BLOB_CONNECTION_STRING",
    )
    azurite_queue_connection_string: str = Field(
        default=(
            "DefaultEndpointsProtocol=http;"
            "AccountName=devstoreaccount1;"
            f"AccountKey={AZURITE_ACCOUNT_KEY};"
            "QueueEndpoint=http://127.0.0.1:10001/devstoreaccount1;"
        ),
        alias="AZURITE_QUEUE_CONNECTION_STRING",
    )
    blob_container_name: str = Field(default="documents", alias="BLOB_CONTAINER_NAME")
    queue_name: str = Field(default="jobs", alias="QUEUE_NAME")
    smtp_host: str = Field(default="127.0.0.1", alias="SMTP_HOST")
    smtp_port: int = Field(default=1025, alias="SMTP_PORT")
    # Mail relay auth/TLS mode. Defaults reproduce the historical
    # unauthenticated/plaintext behavior (e.g. local Mailpit catcher, or a
    # legacy internal open relay). Set to "basic"/"starttls" (or "smtps")
    # for authenticated relays (M365 SMTP AUTH, SendGrid, Mailgun, or a
    # private relay reachable only over a VNet/private endpoint).
    mail_auth_mode: Literal["none", "basic"] = Field(default="none", alias="MAIL_AUTH_MODE")
    mail_tls_mode: Literal["none", "starttls", "smtps"] = Field(
        default="none", alias="MAIL_TLS_MODE"
    )
    smtp_username: str | None = Field(default=None, alias="SMTP_USERNAME")
    smtp_password: str | None = Field(default=None, alias="SMTP_PASSWORD")
    mail_from_address: str = Field(
        default="enterprise-idp@localhost", alias="MAIL_FROM_ADDRESS"
    )
    web_origin: str = Field(default="http://localhost:3000", alias="WEB_ORIGIN")
    next_public_api_base_url: str = Field(
        default="http://localhost:8000",
        alias="NEXT_PUBLIC_API_BASE_URL",
    )
    jwt_secret: str = Field(default_factory=_ephemeral_jwt_secret, alias="JWT_SECRET")
    jwt_algorithm: str = Field(default="HS256", alias="JWT_ALGORITHM")
    jwt_expiry_minutes: int = Field(default=8 * 60, alias="JWT_EXPIRY_MINUTES")
    # Short-lived on purpose: `POST /auth/token` mints these for scripts and
    # ad-hoc testing, not for long-running browser sessions (that's the
    # session cookie above, governed by `jwt_expiry_minutes`).
    api_token_expiry_minutes: int = Field(default=60, alias="API_TOKEN_EXPIRY_MINUTES")
    session_cookie_name: str = Field(default="cl_idp_session", alias="SESSION_COOKIE_NAME")
    session_cookie_secure: bool = Field(default=False, alias="SESSION_COOKIE_SECURE")
    # "lax" works for local dev (web/api share the "localhost" site regardless
    # of port). Deployments where web and api live on different subdomains of
    # a public-suffix domain (e.g. Azure App Service's *.azurewebsites.net)
    # are cross-site for cookie purposes — browsers silently drop a "lax"
    # cookie on the credentialed fetch/XHR calls the frontend makes, so those
    # environments must set this to "none" (which requires
    # SESSION_COOKIE_SECURE=true; browsers reject SameSite=None without
    # Secure).
    session_cookie_samesite: Literal["lax", "strict", "none"] = Field(
        default="lax", alias="SESSION_COOKIE_SAMESITE"
    )
    service_api_token: str = Field(default="", alias="SERVICE_API_TOKEN")
    demo_it_admin_email: str = Field(default="", alias="DEMO_IT_ADMIN_EMAIL")
    demo_it_admin_password: str = Field(default="", alias="DEMO_IT_ADMIN_PASSWORD")
    demo_reviewer_email: str = Field(default="", alias="DEMO_REVIEWER_EMAIL")
    demo_reviewer_password: str = Field(default="", alias="DEMO_REVIEWER_PASSWORD")
    demo_end_user_email: str = Field(default="", alias="DEMO_END_USER_EMAIL")
    demo_end_user_password: str = Field(default="", alias="DEMO_END_USER_PASSWORD")
    applicationinsights_connection_string: str | None = Field(
        default=None,
        alias="APPLICATIONINSIGHTS_CONNECTION_STRING",
    )
    otel_exporter_otlp_endpoint: str | None = Field(
        default=None,
        alias="OTEL_EXPORTER_OTLP_ENDPOINT",
    )
    cosmos_tls_insecure: bool = Field(default=False, alias="COSMOS_TLS_INSECURE")
    cu_endpoint: str = Field(default="", alias="CU_ENDPOINT")
    cu_api_key: str | None = Field(default=None, alias="CU_API_KEY")
    cu_model_deployment: str = Field(default="", alias="CU_MODEL_DEPLOYMENT")

    # Foundry AI Agent Judge: a best-effort pre-judgement that runs after
    # extraction, immediately before a job becomes human-reviewable. It only
    # ever adjudicates fields already flagged by `confidenceViolations`
    # (low-confidence) and never blocks or fails the job itself.
    judge_enabled: bool = Field(default=False, alias="JUDGE_ENABLED")
    # Defaults to deriving from `cu_endpoint` (same Foundry account, different
    # API surface: `*.cognitiveservices.azure.com` -> `*.services.ai.azure.com
    # /api/projects/{project}`) when unset — see `app.judge.client`.
    judge_project_endpoint: str | None = Field(default=None, alias="JUDGE_PROJECT_ENDPOINT")
    judge_model_deployment: str = Field(default="gpt-5-mini", alias="JUDGE_MODEL_DEPLOYMENT")
    judge_agent_name: str = Field(default="cl-idp-review-judge", alias="JUDGE_AGENT_NAME")
    judge_timeout_seconds: float = Field(default=45.0, alias="JUDGE_TIMEOUT_SECONDS")
    # Upper bound on how many flagged fields are sent to the judge per job,
    # to bound latency/cost on pathological documents with many violations.
    judge_max_fields: int = Field(default=25, alias="JUDGE_MAX_FIELDS")

    @field_validator("jwt_secret", mode="before")
    @classmethod
    def generate_jwt_secret_when_blank(cls, value: object) -> object:
        if value is None or value == "":
            return _ephemeral_jwt_secret()
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
