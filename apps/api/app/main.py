from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterable
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

from azure.cosmos.exceptions import CosmosResourceNotFoundError
from fastapi import BackgroundTasks, FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from opentelemetry import metrics, trace
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.metrics import CallbackOptions, Observation

from app.config import get_settings
from app.cu import (
    ContentUnderstandingError,
    CuClient,
    UnknownAnalyzerError,
    list_available_analyzers,
    provision_process_routing_analyzer,
    resolve_allowed_analyzers,
)
from app.db.cosmos import CosmosService
from app.models import (
    Analyzer,
    BusinessProcess,
    BusinessProcessDocument,
    BusinessProcessInput,
    DependencyStatus,
    Error,
    Health,
    HealthStatus,
    RoutingAnalyzerStatus,
)
from app.observability import init_observability
from app.routers import register_jobs_routes, register_trigger_routes
from app.storage import BlobService, QueueService

API_VERSION = "0.2.0"
API_DESCRIPTION = (
    "API for onboarding business processes, discovering available Azure AI "
    "Content Understanding analyzers, and triggering/reviewing document "
    "inference pipeline runs."
)
OPENAPI_TAGS = [
    {"name": "processes", "description": "Business process configuration"},
    {"name": "analyzers", "description": "Available Azure AI Content Understanding analyzers"},
    {"name": "jobs", "description": "Pipeline trigger, job polling, and review/approve"},
    {"name": "system", "description": "Service health"},
]


def initialize_observability(app: FastAPI) -> None:
    if getattr(app.state, "otel_initialized", False):
        return

    settings = get_settings()
    init_observability(service_name="enterprise-idp-api", settings=settings)
    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=trace.get_tracer_provider(),
        meter_provider=metrics.get_meter_provider(),
    )

    def _observe_business_processes_onboarded(
        options: CallbackOptions,
    ) -> Iterable[Observation]:
        _ = options
        cosmos = getattr(app.state, "cosmos_service", None)
        if cosmos is None:
            return
        yield Observation(len(cosmos.list_processes()))

    meter = metrics.get_meter(__name__)
    meter.create_observable_gauge(
        "idp.business_processes_onboarded",
        callbacks=[_observe_business_processes_onboarded],
        description="Current number of business processes onboarded in the system.",
    )

    app.state.otel_initialized = True


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    cosmos = CosmosService(settings)
    blob = BlobService(settings)
    queue = QueueService(settings)
    cu_client = CuClient(settings)

    cosmos.ensure_containers()
    blob.ensure_container()
    queue.ensure_queue()

    app.state.settings = settings
    app.state.cosmos_service = cosmos
    app.state.blob_service = blob
    app.state.queue_service = queue
    app.state.cu_client = cu_client
    try:
        yield
    finally:
        cu_client.close()


def error_response(
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content=Error(code=code, message=message, details=details).model_dump(mode="json"),
    )


def cosmos_service(application: FastAPI) -> CosmosService:
    return cast(CosmosService, application.state.cosmos_service)


def blob_service(application: FastAPI) -> BlobService:
    return cast(BlobService, application.state.blob_service)


def cu_client(application: FastAPI) -> CuClient:
    return cast(CuClient, application.state.cu_client)


def json_safe(value: object) -> object:
    return json.loads(json.dumps(value, default=str))


def analyzer_ids_changed(previous: list[str], current: list[str]) -> bool:
    return set(previous) != set(current)


def schedule_routing_analyzer_provisioning(
    application: FastAPI,
    background_tasks: BackgroundTasks,
    process: BusinessProcessDocument,
) -> None:
    background_tasks.add_task(
        provision_process_routing_analyzer,
        settings=application.state.settings,
        cosmos=cosmos_service(application),
        process_id=process.id,
    )


def register_routes(application: FastAPI) -> None:
    @application.exception_handler(RequestValidationError)
    async def request_validation_exception_handler(
        request: Request,
        exc: RequestValidationError,
    ) -> JSONResponse:
        _ = request
        return error_response(
            status_code=400,
            code="bad_request",
            message="The request was invalid.",
            details={"errors": json_safe(exc.errors())},
        )

    @application.get("/healthz", response_model=Health, responses={503: {"model": Health}})
    async def healthz(response: Response) -> Health:
        dependencies = {
            "cosmos": (
                DependencyStatus.OK
                if application.state.cosmos_service.check_health()
                else DependencyStatus.UNAVAILABLE
            ),
            "blob": (
                DependencyStatus.OK
                if application.state.blob_service.check_health()
                else DependencyStatus.UNAVAILABLE
            ),
            "queue": (
                DependencyStatus.OK
                if application.state.queue_service.check_health()
                else DependencyStatus.UNAVAILABLE
            ),
        }
        overall_status = (
            HealthStatus.OK
            if all(status == DependencyStatus.OK for status in dependencies.values())
            else HealthStatus.DEGRADED
        )
        if overall_status == HealthStatus.DEGRADED:
            response.status_code = 503
        return Health(status=overall_status, dependencies=dependencies, version=application.version)

    @application.get(
        "/analyzers",
        response_model=list[Analyzer],
        responses={502: {"model": Error}},
        tags=["analyzers"],
    )
    async def list_analyzers_endpoint() -> list[Analyzer] | JSONResponse:
        try:
            return list_available_analyzers(cu_client(application))
        except ContentUnderstandingError:
            return error_response(
                status_code=502,
                code="content_understanding_unavailable",
                message="Content Understanding was unavailable while listing analyzers.",
            )

    @application.get("/processes", response_model=list[BusinessProcess], tags=["processes"])
    async def list_processes_endpoint() -> list[BusinessProcess]:
        return cast(list[BusinessProcess], cosmos_service(application).list_processes())

    @application.post(
        "/processes",
        response_model=BusinessProcess,
        status_code=201,
        responses={400: {"model": Error}, 409: {"model": Error}, 502: {"model": Error}},
        tags=["processes"],
    )
    async def create_process_endpoint(
        payload: BusinessProcessInput,
        background_tasks: BackgroundTasks,
    ) -> BusinessProcess | JSONResponse:
        existing_process = cosmos_service(application).find_process_by_name(payload.name)
        if existing_process is not None:
            return error_response(
                status_code=409,
                code="duplicate_process_name",
                message="A business process with this name already exists.",
                details={"processId": existing_process.id},
            )

        try:
            allowed_analyzers = resolve_allowed_analyzers(
                payload.allowedAnalyzerIds,
                cu_client(application),
            )
        except ValueError as exc:
            return error_response(
                status_code=400,
                code="invalid_analyzer_selection",
                message=str(exc),
            )
        except UnknownAnalyzerError as exc:
            return error_response(
                status_code=400,
                code="invalid_analyzer_selection",
                message=str(exc),
                details={"analyzerId": exc.analyzer_id},
            )
        except ContentUnderstandingError:
            return error_response(
                status_code=502,
                code="content_understanding_unavailable",
                message="Content Understanding was unavailable while resolving analyzers.",
            )

        now = datetime.now(UTC)
        process = BusinessProcessDocument(
            id=str(uuid4()),
            name=payload.name,
            description=payload.description,
            allowedAnalyzerIds=payload.allowedAnalyzerIds,
            allowedAnalyzers=allowed_analyzers,
            confidenceThreshold=payload.confidenceThreshold,
            ownerEmail=payload.ownerEmail,
            routingAnalyzerStatus=RoutingAnalyzerStatus.BUILDING,
            routingAnalyzerError=None,
            createdAt=now,
            updatedAt=now,
        )
        saved_process = cosmos_service(application).upsert_process(process)
        schedule_routing_analyzer_provisioning(application, background_tasks, saved_process)
        return saved_process

    @application.get(
        "/processes/{processId}",
        response_model=BusinessProcess,
        responses={404: {"model": Error}},
        tags=["processes"],
    )
    async def get_process_endpoint(processId: str) -> BusinessProcess | JSONResponse:
        try:
            return cosmos_service(application).read_process(processId)
        except CosmosResourceNotFoundError:
            return error_response(
                status_code=404,
                code="process_not_found",
                message="The requested business process was not found.",
            )

    @application.put(
        "/processes/{processId}",
        response_model=BusinessProcess,
        responses={400: {"model": Error}, 404: {"model": Error}, 409: {"model": Error}, 502: {"model": Error}},
        tags=["processes"],
    )
    async def update_process_endpoint(
        processId: str,
        payload: BusinessProcessInput,
        background_tasks: BackgroundTasks,
    ) -> BusinessProcess | JSONResponse:
        try:
            existing_process = cosmos_service(application).read_process(processId)
        except CosmosResourceNotFoundError:
            return error_response(
                status_code=404,
                code="process_not_found",
                message="The requested business process was not found.",
            )

        name_collision = cosmos_service(application).find_process_by_name(payload.name)
        if name_collision is not None and name_collision.id != processId:
            return error_response(
                status_code=409,
                code="duplicate_process_name",
                message="Another business process with this name already exists.",
                details={"processId": name_collision.id},
            )

        try:
            allowed_analyzers = resolve_allowed_analyzers(
                payload.allowedAnalyzerIds,
                cu_client(application),
            )
        except ValueError as exc:
            return error_response(
                status_code=400,
                code="invalid_analyzer_selection",
                message=str(exc),
            )
        except UnknownAnalyzerError as exc:
            return error_response(
                status_code=400,
                code="invalid_analyzer_selection",
                message=str(exc),
                details={"analyzerId": exc.analyzer_id},
            )
        except ContentUnderstandingError:
            return error_response(
                status_code=502,
                code="content_understanding_unavailable",
                message="Content Understanding was unavailable while resolving analyzers.",
            )

        changed = analyzer_ids_changed(
            existing_process.allowedAnalyzerIds,
            payload.allowedAnalyzerIds,
        )
        updated_process = existing_process.model_copy(
            update={
                "name": payload.name,
                "description": payload.description,
                "allowedAnalyzerIds": payload.allowedAnalyzerIds,
                "allowedAnalyzers": allowed_analyzers,
                "confidenceThreshold": payload.confidenceThreshold,
                "ownerEmail": payload.ownerEmail,
                "routingAnalyzerStatus": (
                    RoutingAnalyzerStatus.BUILDING
                    if changed
                    else existing_process.routingAnalyzerStatus
                ),
                "routingAnalyzerError": None if changed else existing_process.routingAnalyzerError,
                "updatedAt": datetime.now(UTC),
            }
        )
        saved_process = cosmos_service(application).upsert_process(updated_process)
        if changed:
            schedule_routing_analyzer_provisioning(application, background_tasks, saved_process)
        return saved_process

    @application.delete(
        "/processes/{processId}",
        status_code=204,
        responses={404: {"model": Error}},
        tags=["processes"],
    )
    async def delete_process_endpoint(processId: str) -> Response:
        try:
            cosmos_service(application).read_process(processId)
        except CosmosResourceNotFoundError:
            return error_response(
                status_code=404,
                code="process_not_found",
                message="The requested business process was not found.",
            )

        for job in cosmos_service(application).list_jobs_for_process(processId):
            cosmos_service(application).delete_job(processId, job.id)

        for blob_name in blob_service(application).list_blob_names(prefix=f"{processId}/"):
            blob_service(application).delete_blob(blob_name)

        cosmos_service(application).delete_process(processId)
        return Response(status_code=204)

    register_jobs_routes(application)
    register_trigger_routes(application)


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title="Enterprise IDP API",
        description=API_DESCRIPTION,
        version=API_VERSION,
        lifespan=lifespan,
        openapi_tags=OPENAPI_TAGS,
        servers=[{"url": "/api"}],
    )
    initialize_observability(application)
    allow_origins = {settings.web_origin}
    # Local dev convenience: `localhost` and `127.0.0.1` are the same server to
    # a developer but different origins to a browser's CORS check. Accept both
    # forms of the configured web origin so local tooling can use either.
    if "://localhost" in settings.web_origin:
        allow_origins.add(settings.web_origin.replace("://localhost", "://127.0.0.1"))
    elif "://127.0.0.1" in settings.web_origin:
        allow_origins.add(settings.web_origin.replace("://127.0.0.1", "://localhost"))
    application.add_middleware(
        CORSMiddleware,
        allow_origins=sorted(allow_origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_routes(application)
    return application


app = create_app()
