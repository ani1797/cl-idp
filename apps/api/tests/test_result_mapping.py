from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from app.models import (
    AnalyzerRef,
    ArrayField,
    Field,
    IntegerField,
    NumberField,
    ObjectField,
    PageUnit,
    StringField,
)
from app.worker.result_mapping import compute_confidence_violations, map_analysis_result

FIXTURES = Path(__file__).parent / "fixtures"
ALLOWED_ANALYZERS = [
    AnalyzerRef(id="prebuilt-invoice", name="Invoice"),
    AnalyzerRef(id="prebuilt-receipt", name="Receipt"),
    AnalyzerRef(id="custom-po-form", name="Purchase Order (custom)"),
]


def load_fixture(name: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((FIXTURES / name).read_text()))


def test_maps_routed_direct_prebuilt_result_with_nested_fields_and_violations() -> None:
    mapped = map_analysis_result(
        load_fixture("routed_direct_prebuilt_invoice.json"),
        allowed_analyzers=ALLOWED_ANALYZERS,
        confidence_threshold=0.8,
    )

    assert mapped.detected_form == "prebuilt-invoice"
    assert mapped.detected_form_name == "Invoice"
    assert mapped.unclassified is False
    assert mapped.confidence_violations == [
        "/InvoiceDate",
        "/AmountDue/Amount",
        "/LineItems/0/Description",
    ]

    assert len(mapped.pages) == 1
    assert mapped.pages[0].page == 1
    assert mapped.pages[0].width == 1000.0
    assert mapped.pages[0].height == 2000.0
    assert mapped.pages[0].unit == PageUnit.PIXEL
    assert mapped.pages[0].angle == 0.0

    customer_name = mapped.fields[0]
    assert isinstance(customer_name, StringField)
    assert customer_name.path == "/CustomerName"
    assert customer_name.value == "Contoso"
    assert customer_name.boundingBox == [0.1, 0.1, 0.3, 0.1, 0.3, 0.13, 0.1, 0.13]
    assert customer_name.page == 1

    amount_due = next(field for field in mapped.fields if field.name == "AmountDue")
    assert isinstance(amount_due, ObjectField)
    assert set((amount_due.properties or {}).keys()) == {"Amount", "CurrencyCode"}
    amount = (amount_due.properties or {})["Amount"]
    assert isinstance(amount, NumberField)
    assert amount.path == "/AmountDue/Amount"
    assert amount.boundingBox == [0.6, 0.2, 0.72, 0.2, 0.72, 0.23, 0.6, 0.23]

    line_items = next(field for field in mapped.fields if field.name == "LineItems")
    assert isinstance(line_items, ArrayField)
    assert len(line_items.items or []) == 1
    first_item = (line_items.items or [])[0]
    assert isinstance(first_item, ObjectField)
    description = (first_item.properties or {})["Description"]
    assert isinstance(description, StringField)
    assert description.path == "/LineItems/0/Description"

    quantity = (first_item.properties or {})["Quantity"]
    assert isinstance(quantity, IntegerField)
    assert quantity.confidence is None
    assert quantity.path not in mapped.confidence_violations


def test_maps_routed_result_when_extraction_target_is_a_derived_analyzer() -> None:
    mapped = map_analysis_result(
        load_fixture("routed_derived_receipt.json"),
        allowed_analyzers=ALLOWED_ANALYZERS,
        confidence_threshold=0.8,
    )

    assert mapped.detected_form == "prebuilt-receipt"
    assert mapped.detected_form_name == "Receipt"
    assert mapped.unclassified is False
    assert mapped.confidence_violations == []
    assert mapped.pages[0].unit == PageUnit.INCH
    assert mapped.pages[0].angle == 1.25

    merchant_name = mapped.fields[0]
    assert isinstance(merchant_name, StringField)
    assert merchant_name.boundingBox == [
        1.0 / 8.5,
        1.5 / 11.0,
        3.0 / 8.5,
        1.5 / 11.0,
        3.0 / 8.5,
        1.8 / 11.0,
        1.0 / 8.5,
        1.8 / 11.0,
    ]


def test_maps_other_category_to_unclassified_success() -> None:
    mapped = map_analysis_result(
        load_fixture("live_captured_routed_other.json"),
        allowed_analyzers=ALLOWED_ANALYZERS,
        confidence_threshold=0.8,
    )

    assert mapped.detected_form is None
    assert mapped.detected_form_name is None
    assert mapped.unclassified is True
    assert mapped.fields == []
    assert mapped.confidence_violations == []
    assert mapped.pages[0].page == 1


def test_maps_live_captured_direct_prebuilt_result_with_missing_confidence() -> None:
    mapped = map_analysis_result(
        load_fixture("live_captured_routed_direct_prebuilt_invoice.json"),
        allowed_analyzers=ALLOWED_ANALYZERS,
        confidence_threshold=0.99,
    )

    assert mapped.detected_form == "prebuilt-invoice"
    assert mapped.detected_form_name == "Invoice"
    assert mapped.unclassified is False
    assert "/AmountDue/Amount" in mapped.confidence_violations
    assert "/AmountDue/CurrencyCode" not in mapped.confidence_violations
    assert {field.name for field in mapped.fields} >= {"AmountDue", "CustomerName", "InvoiceId"}


def test_maps_classified_zero_field_result_to_empty_fields_without_unclassified() -> None:
    mapped = map_analysis_result(
        load_fixture("routed_zero_fields.json"),
        allowed_analyzers=ALLOWED_ANALYZERS,
        confidence_threshold=0.8,
    )

    assert mapped.detected_form == "custom-po-form"
    assert mapped.detected_form_name == "Purchase Order (custom)"
    assert mapped.unclassified is False
    assert mapped.fields == []
    assert mapped.confidence_violations == []


def test_compute_confidence_violations_returns_low_leaf_when_aggregate_is_below_threshold() -> None:
    fields = [number_field("/invoiceTotal", confidence=0.62)]

    violations = compute_confidence_violations(fields, threshold=0.8)

    assert violations == ["/invoiceTotal"]


def test_compute_confidence_violations_returns_no_paths_when_low_leaf_average_meets_threshold() -> None:
    fields = [
        number_field("/invoiceTotal", confidence=0.2),
        number_field("/subtotal", confidence=1.0),
        number_field("/tax", confidence=1.0),
    ]

    violations = compute_confidence_violations(fields, threshold=0.7)

    assert violations == []


def test_compute_confidence_violations_flattens_nested_arrays_and_objects_once() -> None:
    fields = [
        ObjectField(
            name="invoice",
            path="/invoice",
            type="object",
            properties={
                "lineItems": ArrayField(
                    name="lineItems",
                    path="/invoice/lineItems",
                    type="array",
                    items=[
                        ObjectField(
                            name="0",
                            path="/invoice/lineItems/0",
                            type="object",
                            properties={
                                "description": string_field(
                                    "/invoice/lineItems/0/description",
                                    confidence=0.61,
                                ),
                                "quantity": number_field(
                                    "/invoice/lineItems/0/quantity",
                                    confidence=0.95,
                                ),
                            },
                        ),
                        ObjectField(
                            name="1",
                            path="/invoice/lineItems/1",
                            type="object",
                            properties={
                                "description": string_field(
                                    "/invoice/lineItems/1/description",
                                    confidence=0.52,
                                ),
                            },
                        ),
                    ],
                )
            },
        )
    ]

    violations = compute_confidence_violations(fields, threshold=0.75)

    assert violations == [
        "/invoice/lineItems/0/description",
        "/invoice/lineItems/1/description",
    ]


def test_compute_confidence_violations_excludes_missing_confidence_from_mean_and_paths() -> None:
    fields = [
        number_field("/invoiceTotal", confidence=0.6),
        number_field("/taxAmount", confidence=None),
        number_field("/subtotal", confidence=1.0),
    ]

    violations = compute_confidence_violations(fields, threshold=0.7)

    assert violations == []


def test_compute_confidence_violations_returns_no_paths_for_empty_or_all_missing_confidence() -> None:
    assert compute_confidence_violations([], threshold=0.8) == []
    assert compute_confidence_violations(
        [
            string_field("/invoiceId", confidence=None),
            number_field("/invoiceTotal", confidence=None),
        ],
        threshold=0.8,
    ) == []


def test_compute_confidence_violations_treats_aggregate_equal_to_threshold_as_no_review() -> None:
    fields = [
        number_field("/invoiceTotal", confidence=0.6),
        number_field("/subtotal", confidence=0.8),
    ]

    violations = compute_confidence_violations(fields, threshold=0.7)

    assert violations == []


def number_field(path: str, *, confidence: float | None) -> NumberField:
    return NumberField(
        name=path.removeprefix("/").split("/")[-1],
        path=path,
        type="number",
        value=100.0,
        confidence=confidence,
        boundingBox=None,
        page=1,
        reviewedValue=None,
    )


def string_field(path: str, *, confidence: float | None) -> StringField:
    return StringField(
        name=path.removeprefix("/").split("/")[-1],
        path=path,
        type="string",
        value="value",
        confidence=confidence,
        boundingBox=None,
        page=1,
        reviewedValue=None,
    )
