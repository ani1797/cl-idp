from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from app.config import Settings
from app.cu.catalog import get_available_analyzers_by_id
from app.cu.client import CREATED_BY_TAG, CuApiError, CuClient, UnknownAnalyzerError
from app.cu.descriptions import (
    OTHER_CATEGORY_DESCRIPTION,
    OTHER_CATEGORY_KEY,
    derive_category_description,
)
from app.cu.ids import derived_analyzer_id, routing_analyzer_id
from app.db import CosmosService
from app.models import Analyzer, BusinessProcessDocument, RoutingAnalyzerStatus

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ResolvedRoutingTarget:
    selected_analyzer_id: str
    target_analyzer_id: str
    category_description: str
    derived_analyzer_id: str | None = None


def provision_process_routing_analyzer(
    *,
    settings: Settings,
    cosmos: CosmosService,
    process_id: str,
) -> None:
    client = CuClient(settings)
    try:
        _provision_process_routing_analyzer(cosmos=cosmos, client=client, process_id=process_id)
    finally:
        client.close()


def _provision_process_routing_analyzer(
    *,
    cosmos: CosmosService,
    client: CuClient,
    process_id: str,
) -> None:
    process = cosmos.read_process(process_id)
    update_routing_state(
        cosmos,
        process_id=process.id,
        status=RoutingAnalyzerStatus.BUILDING,
        routing_analyzer_id_value=None,
        derived_analyzer_ids={},
        error=None,
    )

    try:
        available_analyzers = get_available_analyzers_by_id(client)
        resolved_targets = resolve_routing_targets(
            process=process,
            available_analyzers=available_analyzers,
            client=client,
        )
        routing_id = routing_analyzer_id(process.id)
        completion_model_name = client.resolve_completion_model_name()
        routing_payload = build_routing_analyzer_payload(
            process=process,
            targets=resolved_targets,
            completion_model_name=completion_model_name,
        )
        client.create_or_replace_analyzer(routing_id, routing_payload)
        routing_record = client.wait_for_analyzer_terminal_status(routing_id)
        if routing_record.status != "ready":
            raise RuntimeError(f"Routing analyzer {routing_id} finished with status {routing_record.status}.")

        update_routing_state(
            cosmos,
            process_id=process.id,
            status=RoutingAnalyzerStatus.READY,
            routing_analyzer_id_value=routing_id,
            derived_analyzer_ids={
                target.selected_analyzer_id: target.derived_analyzer_id
                for target in resolved_targets
                if target.derived_analyzer_id is not None
            },
            error=None,
        )
    except Exception as exc:  # pragma: no cover - terminal update path exercised in live tests
        logger.exception("Routing analyzer provisioning failed for process %s", process_id)
        update_routing_state(
            cosmos,
            process_id=process_id,
            status=RoutingAnalyzerStatus.FAILED,
            routing_analyzer_id_value=routing_analyzer_id(process_id),
            derived_analyzer_ids={},
            error=str(exc),
        )


def resolve_routing_targets(
    *,
    process: BusinessProcessDocument,
    available_analyzers: dict[str, Analyzer],
    client: CuClient,
) -> list[ResolvedRoutingTarget]:
    resolved_targets: list[ResolvedRoutingTarget] = []
    for analyzer_id in process.allowedAnalyzerIds:
        analyzer = available_analyzers.get(analyzer_id)
        if analyzer is None:
            raise UnknownAnalyzerError(analyzer_id)

        description = derive_category_description(
            category_name=analyzer_id,
            analyzer_id=analyzer_id,
            analyzer_description=analyzer.description,
        )
        derived_id = derived_analyzer_id(process.id, analyzer_id)
        derived_payload = build_derived_analyzer_payload(process_id=process.id, analyzer_id=analyzer_id)

        try:
            client.create_or_replace_analyzer(derived_id, derived_payload)
        except CuApiError as exc:
            if exc.code == "InvalidBaseAnalyzerId":
                resolved_targets.append(
                    ResolvedRoutingTarget(
                        selected_analyzer_id=analyzer_id,
                        target_analyzer_id=analyzer_id,
                        category_description=description,
                    )
                )
                continue
            raise RuntimeError(
                f"Failed to derive analyzer from {analyzer_id}: {exc}"
            ) from exc

        derived_record = client.wait_for_analyzer_terminal_status(derived_id)
        if derived_record.status != "ready":
            raise RuntimeError(
                f"Derived analyzer {derived_id} for {analyzer_id} finished with status "
                f"{derived_record.status}."
            )

        resolved_targets.append(
            ResolvedRoutingTarget(
                selected_analyzer_id=analyzer_id,
                target_analyzer_id=derived_id,
                category_description=description,
                derived_analyzer_id=derived_id,
            )
        )

    return resolved_targets


def build_derived_analyzer_payload(*, process_id: str, analyzer_id: str) -> dict[str, object]:
    return {
        "description": f"Enterprise IDP derived analyzer for {analyzer_id}",
        "tags": {
            "createdBy": CREATED_BY_TAG,
            "processId": process_id,
        },
        "baseAnalyzerId": analyzer_id,
        "config": {
            "estimateFieldSourceAndConfidence": True,
        },
    }


def build_routing_analyzer_payload(
    *,
    process: BusinessProcessDocument,
    targets: list[ResolvedRoutingTarget],
    completion_model_name: str,
) -> dict[str, object]:
    content_categories = {
        target.selected_analyzer_id: {
            "description": target.category_description,
            "analyzerId": target.target_analyzer_id,
        }
        for target in targets
    }
    content_categories[OTHER_CATEGORY_KEY] = {"description": OTHER_CATEGORY_DESCRIPTION}

    return {
        "description": f"Enterprise IDP routing analyzer for process {process.name}",
        "tags": {
            "createdBy": CREATED_BY_TAG,
            "processId": process.id,
        },
        "baseAnalyzerId": "prebuilt-document",
        "models": {"completion": completion_model_name},
        "config": {
            "enableSegment": False,
            "omitContent": False,
            "contentCategories": content_categories,
        },
    }


def update_routing_state(
    cosmos: CosmosService,
    *,
    process_id: str,
    status: RoutingAnalyzerStatus,
    routing_analyzer_id_value: str | None,
    derived_analyzer_ids: dict[str, str],
    error: str | None,
) -> BusinessProcessDocument:
    process = cosmos.read_process(process_id)
    updated = process.model_copy(
        update={
            "routingAnalyzerStatus": status,
            "routingAnalyzerId": routing_analyzer_id_value,
            "derivedAnalyzerIds": derived_analyzer_ids,
            "routingAnalyzerError": error,
            "updatedAt": datetime.now(UTC),
        }
    )
    return cosmos.upsert_process(updated)
