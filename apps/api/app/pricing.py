"""Cost estimation for Azure AI Content Understanding usage.

Every job in this system runs through a custom (schema-based) analyzer, which
Azure bills as two per-page line items (2025 pricing,
https://azure.microsoft.com/en-us/pricing/details/content-understanding/):

- Document content extraction (layout/structure): $5.00 / 1,000 pages
- Field extraction (schema-driven generative extraction): $14.14 / 1,000 pages

These figures are a best-effort estimate for cost visibility in the app and
dashboards — they are derived from published list pricing, not from actual
Azure billing/invoice data, and do not account for discounts, free tiers, or
contextualization/token-based charges.
"""

from __future__ import annotations

CU_CONTENT_EXTRACTION_USD_PER_PAGE = 5.00 / 1000
CU_FIELD_EXTRACTION_USD_PER_PAGE = 14.14 / 1000
CU_TOTAL_USD_PER_PAGE = CU_CONTENT_EXTRACTION_USD_PER_PAGE + CU_FIELD_EXTRACTION_USD_PER_PAGE


def estimate_document_cost_usd(page_count: int) -> float:
    """Estimated Azure AI Content Understanding cost for analyzing a
    ``page_count``-page document with a custom (schema-based) analyzer."""
    return round(max(page_count, 0) * CU_TOTAL_USD_PER_PAGE, 6)
