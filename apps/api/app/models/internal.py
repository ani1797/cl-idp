from __future__ import annotations

from pydantic import EmailStr
from pydantic import Field as PydanticField

from app.models.public import BusinessProcess, Job, ModelBase


class BusinessProcessDocument(BusinessProcess):
    routingAnalyzerId: str | None = None
    derivedAnalyzerIds: dict[str, str] = PydanticField(default_factory=dict)


class JobDocument(Job):
    correlationId: str
    contentType: str
    blobPath: str
    attempts: int = 0
    notificationSent: bool = False


class JobQueueMessage(ModelBase):
    jobId: str
    processId: str
    correlationId: str
    blobPath: str
    routingAnalyzerId: str
    confidenceThreshold: float = PydanticField(ge=0, le=1)
    ownerEmail: EmailStr
