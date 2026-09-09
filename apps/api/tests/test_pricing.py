from __future__ import annotations

import pytest

from app.pricing import CU_TOTAL_USD_PER_PAGE, estimate_document_cost_usd


def test_estimate_document_cost_usd_scales_linearly_with_pages() -> None:
    assert estimate_document_cost_usd(0) == 0.0
    assert estimate_document_cost_usd(1) == pytest.approx(CU_TOTAL_USD_PER_PAGE)
    assert estimate_document_cost_usd(10) == pytest.approx(10 * CU_TOTAL_USD_PER_PAGE)


def test_estimate_document_cost_usd_clamps_negative_page_counts() -> None:
    assert estimate_document_cost_usd(-5) == 0.0
