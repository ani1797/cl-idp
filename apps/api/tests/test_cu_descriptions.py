from __future__ import annotations

from app.cu import derive_category_description, truncate_category_description


def test_prebuilt_category_description_uses_curated_catalog() -> None:
    assert derive_category_description(
        category_name="prebuilt-invoice",
        analyzer_id="prebuilt-invoice",
        analyzer_description="ignored",
    ) == "Supplier invoices and utility bills"


def test_custom_category_description_uses_analyzer_description_and_truncates_to_fit() -> None:
    category_name = "custom-analyzer-id"
    description = "X" * 200

    rendered = derive_category_description(
        category_name=category_name,
        analyzer_id=category_name,
        analyzer_description=description,
    )

    assert rendered == description[: 120 - len(category_name)]
    assert len(category_name) + len(rendered) == 120


def test_category_description_falls_back_to_analyzer_id() -> None:
    assert derive_category_description(
        category_name="custom-analyzer-id",
        analyzer_id="custom-analyzer-id",
        analyzer_description=None,
    ) == "custom-analyzer-id"


def test_truncate_category_description_returns_empty_string_when_name_consumes_limit() -> None:
    assert truncate_category_description(category_name="x" * 120, description="ignored") == ""
