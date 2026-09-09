from __future__ import annotations

from app.cu.catalog import CURATED_PREBUILT_ANALYZERS

MAX_CATEGORY_NAME_AND_DESCRIPTION_LENGTH = 120
OTHER_CATEGORY_KEY = "other"
OTHER_CATEGORY_DESCRIPTION = "Any document not matching the categories above"

_PREBUILT_DESCRIPTION_BY_ID = {
    analyzer.id: analyzer.description or analyzer.name for analyzer in CURATED_PREBUILT_ANALYZERS
}


def derive_category_description(
    *,
    category_name: str,
    analyzer_id: str,
    analyzer_description: str | None,
) -> str:
    base_description = (
        _PREBUILT_DESCRIPTION_BY_ID.get(analyzer_id) or analyzer_description or analyzer_id
    )
    return truncate_category_description(
        category_name=category_name,
        description=base_description,
    )


def truncate_category_description(*, category_name: str, description: str) -> str:
    max_description_length = MAX_CATEGORY_NAME_AND_DESCRIPTION_LENGTH - len(category_name)
    if max_description_length <= 0:
        return ""
    return description[:max_description_length]
