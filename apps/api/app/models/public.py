from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
from pydantic import Field as PydanticField


class ModelBase(BaseModel):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)


class Error(ModelBase):
    code: str
    message: str
    details: dict[str, Any] | None = None


class HealthStatus(StrEnum):
    OK = "ok"
    DEGRADED = "degraded"


class DependencyStatus(StrEnum):
    OK = "ok"
    UNAVAILABLE = "unavailable"


class Health(ModelBase):
    status: HealthStatus
    dependencies: dict[str, DependencyStatus] | None = None
    version: str | None = None


class AnalyzerRef(ModelBase):
    id: str
    name: str


class AnalyzerKind(StrEnum):
    PREBUILT = "prebuilt"
    CUSTOM = "custom"


class Analyzer(ModelBase):
    id: str
    name: str
    description: str | None = None
    kind: AnalyzerKind


class BusinessProcessInput(ModelBase):
    name: str
    description: str
    allowedAnalyzerIds: list[str] = PydanticField(min_length=1, max_length=199)
    confidenceThreshold: float = PydanticField(ge=0, le=1)
    ownerEmail: EmailStr

    @field_validator("allowedAnalyzerIds")
    @classmethod
    def validate_unique_analyzer_ids(cls, analyzer_ids: list[str]) -> list[str]:
        if len(analyzer_ids) != len(set(analyzer_ids)):
            raise ValueError("allowedAnalyzerIds must be unique")
        return analyzer_ids


class RoutingAnalyzerStatus(StrEnum):
    BUILDING = "building"
    READY = "ready"
    FAILED = "failed"


class BusinessProcess(BusinessProcessInput):
    id: str
    allowedAnalyzers: list[AnalyzerRef]
    routingAnalyzerStatus: RoutingAnalyzerStatus
    routingAnalyzerError: str | None = None
    createdAt: datetime
    updatedAt: datetime


class JobsSummary(ModelBase):
    total: int
    needsReview: int
    failed: int
    unclassified: int
    totalEstimatedCostUsd: float


class JobRef(ModelBase):
    jobId: str


class JobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


class PageUnit(StrEnum):
    INCH = "inch"
    PIXEL = "pixel"


class PageInfo(ModelBase):
    page: int
    width: float
    height: float
    unit: PageUnit
    angle: float | None = None


type BoundingBox = Annotated[list[float], PydanticField(min_length=8, max_length=8)]


class ExtractedFieldBase(ModelBase):
    name: str
    path: str
    type: str


class ScalarFieldBase(ExtractedFieldBase):
    confidence: float | None = PydanticField(default=None, ge=0, le=1)
    boundingBox: BoundingBox | None = None
    page: int | None = None
    reviewedValue: str | None = None


class StringField(ScalarFieldBase):
    type: Literal["string"]
    value: str | None = None


class DateField(ScalarFieldBase):
    type: Literal["date"]
    value: str | None = None


class TimeField(ScalarFieldBase):
    type: Literal["time"]
    value: str | None = None


class NumberField(ScalarFieldBase):
    type: Literal["number"]
    value: float | None = None


class IntegerField(ScalarFieldBase):
    type: Literal["integer"]
    value: int | None = None


class BooleanField(ScalarFieldBase):
    type: Literal["boolean"]
    value: bool | None = None


class ArrayField(ExtractedFieldBase):
    type: Literal["array"]
    items: list[Field] | None = None


class ObjectField(ExtractedFieldBase):
    type: Literal["object"]
    properties: dict[str, Field] | None = None


type Field = Annotated[
    StringField
    | DateField
    | TimeField
    | NumberField
    | IntegerField
    | BooleanField
    | ArrayField
    | ObjectField,
    PydanticField(discriminator="type"),
]

ArrayField.model_rebuild()
ObjectField.model_rebuild()


class Job(ModelBase):
    id: str
    processId: str
    fileName: str
    status: JobStatus
    submittedAt: datetime
    completedAt: datetime | None = None
    detectedForm: str | None = None
    detectedFormName: str | None = None
    unclassified: bool | None = None
    retryOfJobId: str | None = None
    pages: list[PageInfo] | None = None
    fields: list[Field] | None = None
    fieldCount: int | None = None
    averageConfidence: float | None = None
    confidenceViolations: list[str] | None = None
    estimatedCostUsd: float | None = None
    error: str | None = None
    reviewedAt: datetime | None = None


class ReviewedField(ModelBase):
    path: str
    value: str


class ReviewJobRequest(ModelBase):
    fields: Annotated[list[ReviewedField], PydanticField(min_length=1)]
