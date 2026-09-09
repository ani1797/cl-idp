from __future__ import annotations

import logging

import pytest
from opentelemetry.exporter.otlp.proto.http._log_exporter import OTLPLogExporter
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.metrics.export import ConsoleMetricExporter
from opentelemetry.sdk.trace.export import ConsoleSpanExporter

from app.config import get_settings
from app.observability import (
    configure_logging,
    correlation_scope,
    create_log_exporter,
    create_metric_reader,
    create_span_exporter,
)


def test_create_span_exporter_defaults_to_console() -> None:
    settings = get_settings().model_copy(update={"applicationinsights_connection_string": None})

    exporter = create_span_exporter(settings)

    assert isinstance(exporter, ConsoleSpanExporter)


def test_create_span_exporter_uses_azure_monitor_when_connection_string_is_set(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(
        update={"applicationinsights_connection_string": "InstrumentationKey=test-key"}
    )
    captured: dict[str, str] = {}

    class FakeAzureMonitorTraceExporter:
        def __init__(self, *, connection_string: str) -> None:
            captured["connection_string"] = connection_string

    monkeypatch.setattr(
        "app.observability._load_azure_monitor_trace_exporter",
        lambda: FakeAzureMonitorTraceExporter,
    )

    exporter = create_span_exporter(settings)

    assert isinstance(exporter, FakeAzureMonitorTraceExporter)
    assert captured["connection_string"] == "InstrumentationKey=test-key"


def test_create_span_exporter_prefers_otlp_endpoint_over_azure_monitor() -> None:
    settings = get_settings().model_copy(
        update={
            "otel_exporter_otlp_endpoint": "http://otel-collector:4318",
            "applicationinsights_connection_string": "InstrumentationKey=test-key",
        }
    )

    exporter = create_span_exporter(settings)

    assert isinstance(exporter, OTLPSpanExporter)


def test_create_metric_reader_defaults_to_console_exporter() -> None:
    settings = get_settings().model_copy(update={"otel_exporter_otlp_endpoint": None})

    reader = create_metric_reader(settings)

    assert isinstance(reader._exporter, ConsoleMetricExporter)


def test_create_metric_reader_uses_otlp_when_endpoint_is_set() -> None:
    settings = get_settings().model_copy(
        update={"otel_exporter_otlp_endpoint": "http://otel-collector:4318"}
    )

    reader = create_metric_reader(settings)

    assert isinstance(reader._exporter, OTLPMetricExporter)


def test_create_log_exporter_is_none_without_otlp_endpoint() -> None:
    settings = get_settings().model_copy(update={"otel_exporter_otlp_endpoint": None})

    assert create_log_exporter(settings) is None


def test_create_log_exporter_uses_otlp_when_endpoint_is_set() -> None:
    settings = get_settings().model_copy(
        update={"otel_exporter_otlp_endpoint": "http://otel-collector:4318"}
    )

    exporter = create_log_exporter(settings)

    assert isinstance(exporter, OTLPLogExporter)


def test_correlation_scope_injects_correlation_id_into_log_records(
    caplog: pytest.LogCaptureFixture,
) -> None:
    configure_logging()
    logger = logging.getLogger("tests.observability")
    caplog.set_level(logging.INFO)

    with correlation_scope("corr-123"):
        logger.info("hello observability")

    record = next(record for record in caplog.records if record.getMessage() == "hello observability")
    assert getattr(record, "correlation_id", None) == "corr-123"

