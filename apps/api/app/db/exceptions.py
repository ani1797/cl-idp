from __future__ import annotations


class DataStoreError(Exception):
    """Base class for all backend-agnostic datastore errors.

    Both `MongoService` and `CosmosService` translate their respective
    driver exceptions into this hierarchy so routers/worker code never
    needs to import a specific driver's exception types.
    """


class DocumentNotFoundError(DataStoreError):
    """Raised when a requested process or job document does not exist."""
