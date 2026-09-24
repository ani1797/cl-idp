from app.config import Settings
from app.db.base import DataStore, JobFilters
from app.db.cosmos import CosmosService
from app.db.exceptions import DataStoreError, DocumentNotFoundError
from app.db.mongo import MongoService

__all__ = [
    "CosmosService",
    "DataStore",
    "DataStoreError",
    "DocumentNotFoundError",
    "JobFilters",
    "MongoService",
    "create_data_store",
]


def create_data_store(settings: Settings) -> DataStore:
    """Select and construct the configured `DataStore` backend.

    `settings.db_backend` is `"mongo"` (default, Canada Life's approved
    production stack) or `"cosmos"` (config-selectable fallback).
    """
    if settings.db_backend == "cosmos":
        return CosmosService(settings)
    if settings.db_backend == "mongo":
        return MongoService(settings)
    raise ValueError(f"Unsupported DB_BACKEND: {settings.db_backend!r} (expected 'mongo' or 'cosmos')")
