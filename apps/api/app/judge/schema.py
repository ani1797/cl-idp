"""Response contract and parsing for the Foundry AI Agent Judge.

The schema's property order is deliberate: the model is asked to reason
(`documentValue` -> `matches` -> `rationale`) *before* committing to the
final `verdict`. An earlier design that asked for `verdict` first produced
internally-inconsistent answers (a `rationale` explaining the value matched
the document, paired with `verdict: "fix"`). Reordering fixed it across
repeated runs against a real Foundry agent — see
`apps/api/scripts/spikes/judge_spike.py` for the comparison that led here.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from app.models.public import JudgeFinding, JudgeReview, JudgeStatus, JudgeVerdict

_CODE_FENCE_PATTERN = re.compile(r"^```(?:json)?\s*|\s*```$", re.MULTILINE)

JUDGE_RESPONSE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "path": {"type": "string"},
                    "documentValue": {
                        "type": "string",
                        "description": (
                            "The value as literally read from the document text for "
                            "this field, or empty string if absent/illegible."
                        ),
                    },
                    "matches": {
                        "type": "boolean",
                        "description": "True if documentValue and extractedValue represent the same value.",
                    },
                    "rationale": {"type": "string"},
                    "verdict": {
                        "type": "string",
                        "enum": ["ok", "fix", "unknown"],
                        "description": (
                            "Must be 'ok' if matches=true, 'fix' if matches=false and "
                            "documentValue is known, 'unknown' if documentValue could "
                            "not be determined."
                        ),
                    },
                    "suggestedValue": {"type": ["string", "null"]},
                },
                "required": [
                    "path",
                    "documentValue",
                    "matches",
                    "rationale",
                    "verdict",
                    "suggestedValue",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["findings"],
    "additionalProperties": False,
}

JUDGE_RESPONSE_SCHEMA_NAME = "judge_findings"


class JudgeParsingError(ValueError):
    """Raised when the agent's raw reply cannot be recovered as the expected
    top-level JSON shape at all (not when an individual finding is odd —
    those degrade to an `unknown` verdict instead, see `parse_judge_findings`)."""


def _strip_code_fence(text: str) -> str:
    return _CODE_FENCE_PATTERN.sub("", text.strip()).strip()


def parse_judge_findings(
    raw_text: str,
    *,
    flagged_fields: Mapping[str, str | None],
) -> list[JudgeFinding]:
    """Parse the agent's raw reply into one `JudgeFinding` per flagged path.

    Tolerant of real-world agent output quirks:
    - fenced ```json code blocks
    - a finding naming a path outside `flagged_fields` (hallucinated — dropped)
    - a flagged path missing from the response (backfilled as `unknown`)
    - an invalid/missing `verdict` (downgraded to `unknown`)
    - a `fix` verdict with no usable corrected value (downgraded to `unknown`,
      since a "fix" with nothing to fix to is not actionable)

    Raises `JudgeParsingError` only when the top-level JSON object or its
    `findings` array cannot be recovered at all.
    """
    try:
        payload = json.loads(_strip_code_fence(raw_text))
    except (json.JSONDecodeError, TypeError) as exc:
        raise JudgeParsingError(f"Judge reply was not valid JSON: {exc}") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("findings"), list):
        raise JudgeParsingError("Judge reply JSON was missing a 'findings' array.")

    by_path: dict[str, JudgeFinding] = {}
    for raw_finding in payload["findings"]:
        if not isinstance(raw_finding, dict):
            continue
        path = raw_finding.get("path")
        if not isinstance(path, str) or path not in flagged_fields:
            continue  # hallucinated or duplicate path — drop rather than trust it

        verdict = _coerce_verdict(raw_finding.get("verdict"))
        suggested_value = raw_finding.get("suggestedValue")
        document_value = raw_finding.get("documentValue")
        if verdict is JudgeVerdict.FIX:
            fix_value = (
                suggested_value
                if isinstance(suggested_value, str) and suggested_value
                else (
                    document_value if isinstance(document_value, str) and document_value else None
                )
            )
            if fix_value is None:
                verdict = JudgeVerdict.UNKNOWN
                suggested_value = None
            else:
                suggested_value = fix_value
        else:
            suggested_value = None

        rationale = raw_finding.get("rationale")
        by_path[path] = JudgeFinding(
            path=path,
            verdict=verdict,
            extractedValue=flagged_fields[path],
            suggestedValue=suggested_value,
            rationale=rationale
            if isinstance(rationale, str) and rationale
            else "No rationale provided.",
            judgeConfidence=None,
        )

    # Every flagged path must have an opinion, even if the agent's response
    # silently dropped one — the UI should never guess, so absence becomes
    # an explicit "unknown" rather than no pill at all.
    for path, extracted_value in flagged_fields.items():
        if path not in by_path:
            by_path[path] = JudgeFinding(
                path=path,
                verdict=JudgeVerdict.UNKNOWN,
                extractedValue=extracted_value,
                suggestedValue=None,
                rationale="The judge did not return a finding for this field.",
                judgeConfidence=None,
            )

    return [by_path[path] for path in flagged_fields]


def _coerce_verdict(raw_verdict: Any) -> JudgeVerdict:
    try:
        return JudgeVerdict(raw_verdict)
    except ValueError:
        return JudgeVerdict.UNKNOWN


def _rollup_recommendation(findings: list[JudgeFinding]) -> JudgeVerdict:
    verdicts = {finding.verdict for finding in findings}
    if JudgeVerdict.FIX in verdicts:
        return JudgeVerdict.FIX
    if JudgeVerdict.UNKNOWN in verdicts:
        return JudgeVerdict.UNKNOWN
    return JudgeVerdict.OK


def build_judge_review(
    raw_text: str,
    *,
    flagged_fields: Mapping[str, str | None],
    model: str | None,
    evaluated_at: datetime,
) -> JudgeReview:
    """Parse a raw agent reply into a persisted `JudgeReview`.

    Never raises: a reply that cannot be parsed at all becomes a
    `status=failed` review with no findings, which the worker treats like
    any other best-effort judge failure (no recommendation shown)."""
    try:
        findings = parse_judge_findings(raw_text, flagged_fields=flagged_fields)
    except JudgeParsingError as exc:
        return JudgeReview(
            status=JudgeStatus.FAILED,
            recommendation=JudgeVerdict.UNKNOWN,
            findings=[],
            evaluatedAt=evaluated_at,
            model=model,
            error=str(exc),
        )

    return JudgeReview(
        status=JudgeStatus.COMPLETED,
        recommendation=_rollup_recommendation(findings),
        findings=findings,
        evaluatedAt=evaluated_at,
        model=model,
        error=None,
    )
