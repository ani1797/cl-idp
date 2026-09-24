from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
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
    web_origin: str = Field(default="http://localhost:3000", alias="WEB_ORIGIN")
    next_public_api_base_url: str = Field(
        default="http://localhost:8000",
        alias="NEXT_PUBLIC_API_BASE_URL",
    )
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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
