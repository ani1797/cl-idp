"""Prompt construction for the Foundry AI Agent Judge.

The judge only ever sees two things: the document's OCR/markdown text (CU
already returns this for free alongside structured fields — see
`app.worker.result_mapping._find_extraction_content`) and the specific
fields a business process flagged as low-confidence. It never re-runs
extraction and never sees fields that were not flagged.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.models.public import ArrayField, Field, ObjectField, ScalarFieldBase

JUDGE_INSTRUCTIONS = """You are a meticulous document-review judge for an intelligent document
processing pipeline. You will be given the full OCR/markdown text of a scanned
form and a table of fields that an automated extraction model flagged as
low-confidence. Judge ONLY those flagged fields, one at a time, against the
document text.

For each field, first independently read the value from the document text into
documentValue, then compare it to the extractedValue to set matches, then explain
your reasoning in rationale, and only then set verdict consistently with matches:
- matches=true -> verdict="ok"
- matches=false and you are confident in documentValue -> verdict="fix", and set
  suggestedValue to documentValue
- you cannot determine documentValue (illegible, absent, ambiguous) -> verdict="unknown",
  documentValue="", suggestedValue=null

Rules:
- Never guess. If you are not confident, say "unknown".
- Only comment on fields in the given list. Do not invent new paths.
- Be skeptical of your own first impression; re-read the relevant document text before deciding.
- Respond ONLY with the structured JSON specified by the response format.
"""


@dataclass(frozen=True)
class FlaggedField:
    path: str
    label: str
    type: str
    value: str | None
    confidence: float | None


def collect_flagged_fields(
    fields: list[Field],
    *,
    confidence_violations: list[str],
    max_fields: int,
) -> list[FlaggedField]:
    """Resolve each `confidenceViolations` path to its field, in violation
    order, capped at `max_fields` (lowest-confidence fields are listed
    first in `confidence_violations`, so truncation keeps the fields most
    likely to be genuine mistakes)."""
    by_path: dict[str, ScalarFieldBase] = {}
    for field in fields:
        _index_scalar_fields(field, by_path=by_path)

    flagged: list[FlaggedField] = []
    for path in confidence_violations:
        leaf = by_path.get(path)
        if leaf is None:
            continue
        flagged.append(
            FlaggedField(
                path=path,
                label=leaf.name,
                type=leaf.type,
                value=_stringify(leaf.value),
                confidence=leaf.confidence,
            )
        )
        if len(flagged) >= max_fields:
            break
    return flagged


def _index_scalar_fields(field: Field, *, by_path: dict[str, ScalarFieldBase]) -> None:
    if isinstance(field, ArrayField):
        for item in field.items or []:
            _index_scalar_fields(item, by_path=by_path)
        return
    if isinstance(field, ObjectField):
        for child in (field.properties or {}).values():
            _index_scalar_fields(child, by_path=by_path)
        return
    by_path[field.path] = field


def _stringify(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def build_user_message(markdown: str, fields: list[FlaggedField]) -> str:
    lines = [
        "# Document text (OCR/markdown)\n",
        markdown.strip(),
        "\n\n# Flagged fields to judge\n",
    ]
    for field in fields:
        lines.append(
            f"- path: {field.path}\n"
            f"  label: {field.label}\n"
            f"  type: {field.type}\n"
            f"  extractedValue: {field.value!r}\n"
            f"  confidence: {field.confidence}"
        )
    lines.append("\nJudge only the fields listed above.")
    return "\n".join(lines)
