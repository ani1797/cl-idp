from __future__ import annotations

from app.cu.client import CuClient, UnknownAnalyzerError
from app.models import Analyzer, AnalyzerKind, AnalyzerRef

CURATED_PREBUILT_ANALYZERS: tuple[Analyzer, ...] = (
    Analyzer(
        id="prebuilt-invoice",
        name="Invoice",
        description="Supplier invoices and utility bills",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-receipt",
        name="Receipt",
        description="Point-of-sale and dining receipts",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-purchaseOrder",
        name="Purchase Order",
        description="Purchase orders and procurement forms",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-bankStatement.us",
        name="Bank Statement (US)",
        description="US bank account statements",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-idDocument",
        name="ID Document",
        description="Passports, licenses, and identity documents",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-creditCard",
        name="Credit Card",
        description="Credit card applications and account documents",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-tax.us.1040",
        name="US Tax Form 1040",
        description="US individual income tax returns (Form 1040)",
        kind=AnalyzerKind.PREBUILT,
    ),
    Analyzer(
        id="prebuilt-document",
        name="General Document",
        description="General documents for broad document understanding",
        kind=AnalyzerKind.PREBUILT,
    ),
)

CURATED_PREBUILT_ANALYZER_IDS = {analyzer.id for analyzer in CURATED_PREBUILT_ANALYZERS}
APP_OWNED_ANALYZER_PREFIX = "idp_"


def list_available_analyzers(cu_client: CuClient) -> list[Analyzer]:
    live_analyzers = cu_client.list_analyzers()
    custom_analyzers: list[Analyzer] = []

    for analyzer in live_analyzers:
        if (
            analyzer.analyzer_id.startswith(APP_OWNED_ANALYZER_PREFIX)
            or analyzer.tags.get("createdBy") == "cl-idp"
        ):
            continue
        if analyzer.analyzer_id.startswith("prebuilt-"):
            continue
        if analyzer.analyzer_id in CURATED_PREBUILT_ANALYZER_IDS:
            continue
        custom_analyzers.append(
            Analyzer(
                id=analyzer.analyzer_id,
                name=analyzer.name,
                description=analyzer.description,
                kind=AnalyzerKind.CUSTOM,
            )
        )

    custom_analyzers.sort(key=lambda item: (item.name.lower(), item.id.lower()))
    return [*CURATED_PREBUILT_ANALYZERS, *custom_analyzers]


def get_available_analyzers_by_id(cu_client: CuClient) -> dict[str, Analyzer]:
    return {analyzer.id: analyzer for analyzer in list_available_analyzers(cu_client)}


def resolve_allowed_analyzers(selected_ids: list[str], cu_client: CuClient) -> list[AnalyzerRef]:
    if "other" in selected_ids:
        raise ValueError("The analyzer ID 'other' is reserved and cannot be selected.")

    available_by_id = get_available_analyzers_by_id(cu_client)
    for analyzer_id in selected_ids:
        if analyzer_id not in available_by_id:
            raise UnknownAnalyzerError(analyzer_id)

    return [
        AnalyzerRef(id=analyzer_id, name=available_by_id[analyzer_id].name)
        for analyzer_id in selected_ids
    ]
