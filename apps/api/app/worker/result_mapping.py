from __future__ import annotations

import re
from statistics import fmean
from dataclasses import dataclass
from typing import Any

from app.models import (
    AnalyzerRef,
    ArrayField,
    BooleanField,
    DateField,
    Field,
    IntegerField,
    NumberField,
    ObjectField,
    PageInfo,
    PageUnit,
    StringField,
    TimeField,
)

SOURCE_PATTERN = re.compile(r"^D\(\s*(\d+)\s*,\s*(.+)\s*\)$")
SCALAR_VALUE_KEYS = {
    "string": "valueString",
    "date": "valueDate",
    "time": "valueTime",
    "number": "valueNumber",
    "integer": "valueInteger",
    "boolean": "valueBoolean",
}


class ResultMappingError(ValueError):
    pass


@dataclass(frozen=True)
class MappedJobResult:
    detected_form: str | None
    detected_form_name: str | None
    unclassified: bool
    pages: list[PageInfo]
    fields: list[Field]
    confidence_violations: list[str]


@dataclass(frozen=True)
class ConfidenceBearingLeaf:
    path: str
    confidence: float


def map_analysis_result(
    result_body: dict[str, Any],
    *,
    allowed_analyzers: list[AnalyzerRef],
    confidence_threshold: float,
) -> MappedJobResult:
    contents = result_body.get("result", {}).get("contents")
    if not isinstance(contents, list):
        raise ResultMappingError("Content Understanding result was missing result.contents.")

    routing_content = _find_routing_content(contents)
    if routing_content is None:
        raise ResultMappingError("Content Understanding result had no routing content category.")

    detected_form = _extract_detected_form(routing_content)
    extraction_content = _find_extraction_content(contents)
    pages = _pages_from_content(extraction_content or routing_content)

    if detected_form == "other":
        return MappedJobResult(
            detected_form=None,
            detected_form_name=None,
            unclassified=True,
            pages=pages,
            fields=[],
            confidence_violations=[],
        )

    top_level_fields = _map_top_level_fields(extraction_content, pages)
    confidence_violations = compute_confidence_violations(
        top_level_fields,
        threshold=confidence_threshold,
    )
    analyzer_names = {item.id: item.name for item in allowed_analyzers}
    if detected_form is None:
        raise ResultMappingError("Matched result did not include a detected form category.")
    return MappedJobResult(
        detected_form=detected_form,
        detected_form_name=analyzer_names.get(detected_form),
        unclassified=False,
        pages=pages,
        fields=top_level_fields,
        confidence_violations=confidence_violations,
    )


def compute_confidence_violations(fields: list[Field], *, threshold: float) -> list[str]:
    confidence_bearing_leaves: list[ConfidenceBearingLeaf] = []
    for field in fields:
        _collect_confidence_bearing_leaves(field, leaves=confidence_bearing_leaves)

    if not confidence_bearing_leaves:
        return []

    aggregate_confidence = fmean(leaf.confidence for leaf in confidence_bearing_leaves)
    if aggregate_confidence >= threshold:
        return []

    return [leaf.path for leaf in confidence_bearing_leaves if leaf.confidence < threshold]


def _collect_confidence_bearing_leaves(
    field: Field,
    *,
    leaves: list[ConfidenceBearingLeaf],
) -> None:
    if isinstance(field, ArrayField):
        for item in field.items or []:
            _collect_confidence_bearing_leaves(item, leaves=leaves)
        return

    if isinstance(field, ObjectField):
        for child in (field.properties or {}).values():
            _collect_confidence_bearing_leaves(child, leaves=leaves)
        return

    if field.confidence is not None:
        leaves.append(ConfidenceBearingLeaf(path=field.path, confidence=field.confidence))


def _find_routing_content(contents: list[Any]) -> dict[str, Any] | None:
    for content in contents:
        if not isinstance(content, dict):
            continue
        if _extract_detected_form(content) is not None:
            return content
    return None


def _extract_detected_form(content: dict[str, Any]) -> str | None:
    raw_segments = content.get("segments")
    if not isinstance(raw_segments, list):
        return None
    for segment in raw_segments:
        if not isinstance(segment, dict):
            continue
        category = segment.get("category")
        if isinstance(category, str) and category:
            return category
    return None


def _find_extraction_content(contents: list[Any]) -> dict[str, Any] | None:
    for content in contents:
        if not isinstance(content, dict):
            continue
        if "fields" in content and isinstance(content.get("fields"), dict):
            return content
    return None


def _pages_from_content(content: dict[str, Any]) -> list[PageInfo]:
    raw_pages = content.get("pages")
    if not isinstance(raw_pages, list):
        return []

    unit = content.get("unit")
    pages: list[PageInfo] = []
    for page in raw_pages:
        if not isinstance(page, dict):
            continue
        page_number = page.get("pageNumber")
        width = page.get("width")
        height = page.get("height")
        if not isinstance(page_number, int) or not isinstance(width, (int, float)) or not isinstance(
            height, (int, float)
        ):
            continue
        if unit not in {PageUnit.INCH.value, PageUnit.PIXEL.value}:
            raise ResultMappingError(f"Unsupported page unit: {unit!r}")
        angle = page.get("angle")
        pages.append(
            PageInfo(
                page=page_number,
                width=float(width),
                height=float(height),
                unit=PageUnit(unit),
                angle=float(angle) if isinstance(angle, (int, float)) else None,
            )
        )
    return pages


def _map_top_level_fields(
    extraction_content: dict[str, Any] | None,
    pages: list[PageInfo],
) -> list[Field]:
    if extraction_content is None:
        return []

    raw_fields = extraction_content.get("fields")
    if not isinstance(raw_fields, dict):
        return []

    page_lookup = {page.page: page for page in pages}
    return [
        _map_field(
            name=name,
            path=_pointer_for("", name),
            raw_field=raw_field,
            page_lookup=page_lookup,
        )
        for name, raw_field in raw_fields.items()
        if isinstance(name, str) and isinstance(raw_field, dict)
    ]


def _map_field(
    *,
    name: str,
    path: str,
    raw_field: dict[str, Any],
    page_lookup: dict[int, PageInfo],
) -> Field:
    raw_type = raw_field.get("type")
    if not isinstance(raw_type, str) or not raw_type:
        raise ResultMappingError(f"Field at {path} was missing a valid type.")

    if raw_type == "array":
        raw_items = raw_field.get("valueArray")
        if raw_items is None:
            items: list[Field] | None = None
        elif isinstance(raw_items, list):
            items = [
                _map_field(
                    name=str(index),
                    path=_pointer_for(path, str(index)),
                    raw_field=item,
                    page_lookup=page_lookup,
                )
                for index, item in enumerate(raw_items)
                if isinstance(item, dict)
            ]
        else:
            raise ResultMappingError(f"Array field at {path} had a non-list valueArray.")
        return ArrayField(name=name, path=path, type="array", items=items)

    if raw_type == "object":
        raw_properties = raw_field.get("valueObject")
        if raw_properties is None:
            properties: dict[str, Field] | None = None
        elif isinstance(raw_properties, dict):
            properties = {
                child_name: _map_field(
                    name=child_name,
                    path=_pointer_for(path, child_name),
                    raw_field=child_value,
                    page_lookup=page_lookup,
                )
                for child_name, child_value in raw_properties.items()
                if isinstance(child_name, str) and isinstance(child_value, dict)
            }
        else:
            raise ResultMappingError(f"Object field at {path} had a non-object valueObject.")
        return ObjectField(name=name, path=path, type="object", properties=properties)

    value_key = SCALAR_VALUE_KEYS.get(raw_type)
    if value_key is None:
        raise ResultMappingError(f"Unsupported field type {raw_type!r} at {path}.")

    confidence = raw_field.get("confidence")
    source = raw_field.get("source")
    page_number, bounding_box = _normalize_source(source, page_lookup)
    resolved_confidence = float(confidence) if isinstance(confidence, (int, float)) else None
    value = raw_field.get(value_key)
    if raw_type == "string":
        return StringField(
            name=name,
            path=path,
            type="string",
            confidence=resolved_confidence,
            boundingBox=bounding_box,
            page=page_number,
            reviewedValue=None,
            value=value if isinstance(value, str) else None,
        )
    if raw_type == "date":
        return DateField(
            name=name,
            path=path,
            type="date",
            confidence=resolved_confidence,
            boundingBox=bounding_box,
            page=page_number,
            reviewedValue=None,
            value=value if isinstance(value, str) else None,
        )
    if raw_type == "time":
        return TimeField(
            name=name,
            path=path,
            type="time",
            confidence=resolved_confidence,
            boundingBox=bounding_box,
            page=page_number,
            reviewedValue=None,
            value=value if isinstance(value, str) else None,
        )
    if raw_type == "number":
        return NumberField(
            name=name,
            path=path,
            type="number",
            confidence=resolved_confidence,
            boundingBox=bounding_box,
            page=page_number,
            reviewedValue=None,
            value=float(value) if isinstance(value, (int, float)) else None,
        )
    if raw_type == "integer":
        return IntegerField(
            name=name,
            path=path,
            type="integer",
            confidence=resolved_confidence,
            boundingBox=bounding_box,
            page=page_number,
            reviewedValue=None,
            value=int(value) if isinstance(value, int) else None,
        )
    return BooleanField(
        name=name,
        path=path,
        type="boolean",
        confidence=resolved_confidence,
        boundingBox=bounding_box,
        page=page_number,
        reviewedValue=None,
        value=value if isinstance(value, bool) else None,
    )


def _normalize_source(
    source: Any,
    page_lookup: dict[int, PageInfo],
) -> tuple[int | None, list[float] | None]:
    if not isinstance(source, str) or not source:
        return None, None

    match = SOURCE_PATTERN.match(source)
    if match is None:
        return None, None

    page_number = int(match.group(1))
    page = page_lookup.get(page_number)
    if page is None or page.width <= 0 or page.height <= 0:
        return page_number, None

    raw_coordinates = [part.strip() for part in match.group(2).split(",")]
    if len(raw_coordinates) != 8:
        return page_number, None
    try:
        numeric_coordinates = [float(value) for value in raw_coordinates]
    except ValueError:
        return page_number, None

    normalized: list[float] = []
    for index, coordinate in enumerate(numeric_coordinates):
        divisor = page.width if index % 2 == 0 else page.height
        normalized.append(coordinate / divisor)
    return page_number, normalized


def _pointer_for(parent: str, token: str) -> str:
    escaped = token.replace("~", "~0").replace("/", "~1")
    return f"{parent}/{escaped}" if parent else f"/{escaped}"
