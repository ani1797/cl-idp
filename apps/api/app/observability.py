from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Protocol, cast

from opentelemetry import metrics
from opentelemetry._logs import set_logger_provider
from opentelemetry.metrics import Meter, set_meter_provider
from opentelemetry.sdk._logs import LoggerProvider, LoggingHandler
from opentelemetry.sdk._logs.export import BatchLogRecordProcessor, LogRecordExporter
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import (
    ConsoleMetricExporter,
    MetricExporter,
    MetricReader,
    PeriodicExportingMetricReader,
)
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import SpanProcessor, TracerProvider
from opentelemetry.sdk.trace.export import (
    BatchSpanProcessor,
    ConsoleSpanExporter,
    SimpleSpanProcessor,
    SpanExporter,
)
from opentelemetry.trace import Span, set_tracer_provider

from app.config import Settings

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s correlation_id=%(correlation_id)s %(message)s"
METRIC_EXPORT_INTERVAL_MILLIS = 60_000  # OpenTelemetry spec default (60s).
CONSOLE_METRIC_EXPORT_INTERVAL_MILLIS = 3_600_000  # 1h: no live consumer to export to.

_correlation_id: ContextVar[str | None] = ContextVar("correlation_id", default=None)
_log_record_factory_installed = False


class AzureMonitorTraceExporterFactory(Protocol):
    def __call__(self, *, connection_string: str) -> SpanExporter: ...


def configure_logging(*, level: int = logging.INFO) -> None:
    global _log_record_factory_installed

    if not _log_record_factory_installed:
        base_factory = logging.getLogRecordFactory()

        def record_factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
            record = base_factory(*args, **kwargs)
            record.correlation_id = get_correlation_id() or "-"
            return record

        logging.setLogRecordFactory(record_factory)
        _log_record_factory_installed = True

    root_logger = logging.getLogger()
    if not root_logger.handlers:
        logging.basicConfig(level=level, format=LOG_FORMAT)
    elif root_logger.level > level:
        root_logger.setLevel(level)


def get_correlation_id() -> str | None:
    return _correlation_id.get()


@contextmanager
def correlation_scope(correlation_id: str | None) -> Iterator[None]:
    token = _correlation_id.set(correlation_id)
    try:
        yield
    finally:
        _correlation_id.reset(token)


def set_span_attributes(
    span: Span,
    *,
    correlation_id: str | None = None,
    job_id: str | None = None,
    process_id: str | None = None,
) -> None:
    if correlation_id is not None:
        span.set_attribute("correlation_id", correlation_id)
    if job_id is not None:
        span.set_attribute("job_id", job_id)
    if process_id is not None:
        span.set_attribute("process_id", process_id)


def create_span_exporter(settings: Settings) -> SpanExporter:
    # Precedence: a local OTLP collector (docker-compose dev stack) wins over
    # the production Azure Monitor exporter, which wins over the console
    # fallback used when neither is configured.
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
            OTLPSpanExporter,
        )

        return OTLPSpanExporter(endpoint=_otlp_signal_endpoint(settings, "traces"))
    if settings.applicationinsights_connection_string:
        exporter_class = _load_azure_monitor_trace_exporter()
        return exporter_class(connection_string=settings.applicationinsights_connection_string)
    return ConsoleSpanExporter()


def create_metric_reader(settings: Settings) -> MetricReader:
    exporter: MetricExporter
    # The console fallback has no consumer watching it in real time (unlike
    # the OTLP collector case, which feeds a live Grafana dashboard), and a
    # short-lived process (e.g. a test run) can otherwise race the exporter's
    # background export thread against interpreter shutdown. Export rarely
    # in that case; export promptly when a real collector is configured.
    if settings.otel_exporter_otlp_endpoint:
        from opentelemetry.exporter.otlp.proto.http.metric_exporter import (
            OTLPMetricExporter,
        )

        exporter = OTLPMetricExporter(endpoint=_otlp_signal_endpoint(settings, "metrics"))
        export_interval_millis = METRIC_EXPORT_INTERVAL_MILLIS
    else:
        exporter = ConsoleMetricExporter()
        export_interval_millis = CONSOLE_METRIC_EXPORT_INTERVAL_MILLIS
    return PeriodicExportingMetricReader(
        exporter,
        export_interval_millis=export_interval_millis,
    )


def create_log_exporter(settings: Settings) -> LogRecordExporter | None:
    # There is no OTLP log exporter equivalent for Azure Monitor/console in
    # this codebase; local structured logs are already visible on stdout via
    # `configure_logging`. Only wire OTLP log export when a collector (e.g.
    # the docker-compose Grafana LGTM stack) is actually configured to
    # receive it.
    if not settings.otel_exporter_otlp_endpoint:
        return None
    from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter

    return OTLPLogExporter(endpoint=_otlp_signal_endpoint(settings, "logs"))


def _otlp_signal_endpoint(settings: Settings, signal: str) -> str:
    base = (settings.otel_exporter_otlp_endpoint or "").rstrip("/")
    return f"{base}/v1/{signal}"


def _load_azure_monitor_trace_exporter() -> AzureMonitorTraceExporterFactory:
    try:
        from azure.monitor.opentelemetry.exporter import (  # type: ignore[import-untyped]
            AzureMonitorTraceExporter,
        )
    except ModuleNotFoundError as exc:  # pragma: no cover - import failure path is configuration-only
        raise RuntimeError(
            "APPLICATIONINSIGHTS_CONNECTION_STRING is set but "
            "azure-monitor-opentelemetry-exporter is not installed."
        ) from exc
    return cast(AzureMonitorTraceExporterFactory, AzureMonitorTraceExporter)


_initialized_services: set[str] = set()


def init_observability(*, service_name: str, settings: Settings) -> Meter:
    """Wire up logging, tracing, and metrics for a process (API or worker).

    Returns the service's `Meter` so callers can create counters/histograms.
    Idempotent per process/`service_name`: only the first call installs the
    tracer/meter/logger providers (each of which owns background export
    threads), so repeated app construction -- e.g. once per test -- does not
    leak exporter threads.
    """
    if service_name in _initialized_services:
        return metrics.get_meter(service_name)
    _initialized_services.add(service_name)

    configure_logging()
    resource = Resource.create({"service.name": service_name})

    span_exporter = create_span_exporter(settings)
    tracer_provider = TracerProvider(resource=resource)
    # Batching (background export thread) is only worth the overhead when
    # actually shipping spans off-process (OTLP/Azure Monitor); for the
    # console fallback, export synchronously so there is no lingering
    # background thread once the process exits.
    span_processor: SpanProcessor = (
        SimpleSpanProcessor(span_exporter)
        if isinstance(span_exporter, ConsoleSpanExporter)
        else BatchSpanProcessor(span_exporter)
    )
    tracer_provider.add_span_processor(span_processor)
    set_tracer_provider(tracer_provider)

    meter_provider = MeterProvider(
        resource=resource,
        metric_readers=[create_metric_reader(settings)],
    )
    set_meter_provider(meter_provider)

    log_exporter = create_log_exporter(settings)
    if log_exporter is not None:
        logger_provider = LoggerProvider(resource=resource)
        logger_provider.add_log_record_processor(BatchLogRecordProcessor(log_exporter))
        set_logger_provider(logger_provider)
        logging.getLogger().addHandler(LoggingHandler(logger_provider=logger_provider))

    return metrics.get_meter(service_name)
