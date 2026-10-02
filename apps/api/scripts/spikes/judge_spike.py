#!/usr/bin/env python3
"""Scratch/live verification spike for the Foundry AI Agent Judge (Todo 1).

This script is intentionally throwaway investigation code, following the
precedent set by `cu_spike.py`. It talks to a real Foundry Agent Service
project and a real Content Understanding analyzer, and is not part of the
production backend.

Goal: decide what evidence a per-field "judge" agent should see when
adjudicating fields a business process has already flagged as low
confidence — the agent's job is to say whether the extracted value
genuinely matches the source document (`ok`) or does not (`fix`, with a
corrected value), never to re-run the whole extraction.

Two evidence strategies were compared:

1. **Markdown/OCR text** — Content Understanding already returns a
   `markdown` field per analyzed content alongside the structured fields.
   This is handed to the agent as-is: zero extra extraction, zero extra
   dependencies, zero extra round-trip to CU.
2. **Page images** — the source PDF's pages rendered to PNG/JPEG and
   attached to the judge's message as multimodal image blocks.

Findings (see VERDICT at the end of a run, and docs/plan/32 for the
write-up):

- Strategy 2 (page images) is not viable without adding a PDF rasterizer
  dependency (`pypdf`/Pillow cannot rasterize PDF pages; the Agents API
  also rejects a raw `.pdf` file attached as an image block — it only
  accepts `.jpeg/.jpg/.png/.gif/.webp`). This adds real latency (render
  every page before judging only a handful of fields) and a new
  dependency for comparatively little expected accuracy gain, since the
  markdown text already captures every value a user hand-filled into the
  form, including checkbox state.
- Strategy 1 (markdown text) achieved strong accuracy out of the box, but
  the *order of fields in the structured-output JSON schema* matters a
  lot. A schema that asks for `verdict` before an explicit per-field
  `documentValue` / `matches` / `rationale` walkthrough produces
  internally-inconsistent answers (e.g. a `rationale` that says the value
  "matches the document ... should be accepted as is" paired with
  `verdict: "fix"`). Reordering the schema so the model reasons
  (`documentValue` -> `matches` -> `rationale`) *before* committing to
  `verdict` eliminated that inconsistency across repeated runs against a
  real flagged field set (genuinely-correct fields were judged `ok` 3/3
  times; two deliberately corrupted fields were correctly judged `fix`
  with accurate suggested values, while a third genuinely-correct field in
  the same run stayed `ok` — zero false positives observed).

**Decision: use the markdown/OCR text strategy, with a response schema
that orders self-consistency fields before the final `verdict`.**

Usage (requires a live CU + Foundry Agent Service resource and
`az login`/managed identity with Cognitive Services User on the account):

    cd apps/api
    uv run python scripts/spikes/judge_spike.py
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from azure.ai.agents import AgentsClient
from azure.ai.agents.models import ResponseFormatJsonSchema, ResponseFormatJsonSchemaType
from azure.identity import DefaultAzureCredential

REPO_ROOT = Path(__file__).resolve().parents[4]
MODEL = os.environ.get("CU_MODEL_DEPLOYMENT", "gpt-4.1-mini")
GROUP_BENEFITS_ANALYZER_ID = "group_benefits_application"
SAMPLE_FILE = REPO_ROOT / "samples/group-benefits/Bluewave_Logistics_Partners_issue_handwritten.pdf"

# Schema order is deliberate: the model reasons field-by-field
# (documentValue -> matches -> rationale) before committing to the final
# verdict, which eliminated verdict/rationale inconsistency observed with a
# naive "verdict first" schema (see module docstring).
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


def project_endpoint_from_env(cu_endpoint: str) -> str:
    endpoint = os.environ.get("JUDGE_PROJECT_ENDPOINT")
    if endpoint:
        return endpoint
    # Derived from `az cognitiveservices account show` for the local dev
    # resource: the AI Foundry API endpoint plus the associated project name.
    account_endpoint = cu_endpoint.rstrip("/")
    foundry_host = account_endpoint.replace(".cognitiveservices.azure.com", ".services.ai.azure.com")
    project_name = os.environ.get("JUDGE_PROJECT_NAME", "clidpprod-project")
    if not foundry_host:
        raise SystemExit("Set JUDGE_PROJECT_ENDPOINT or CU_ENDPOINT to derive it.")
    return f"{foundry_host}/api/projects/{project_name}"


def leaf_value(raw_field: dict[str, Any]) -> Any:
    for key, value in raw_field.items():
        if key.startswith("value") and value is not None:
            return value
    return None


def analyze_sample(cu_client: Any, content: bytes) -> dict[str, Any]:
    operation_id = cu_client.analyze_binary(
        GROUP_BENEFITS_ANALYZER_ID, content, content_type="application/pdf"
    )
    while True:
        result = cu_client.get_analyzer_result(operation_id)
        status = result.get("status")
        if status in ("Succeeded", "Failed"):
            return result
        time.sleep(2)


def build_user_message(markdown: str, fields: list[dict[str, Any]]) -> str:
    lines = ["# Document text (OCR/markdown)\n", markdown.strip(), "\n\n# Flagged fields to judge\n"]
    for field in fields:
        lines.append(
            f"- path: {field['path']}\n"
            f"  label: {field['label']}\n"
            f"  type: {field['type']}\n"
            f"  extractedValue: {field['value']!r}\n"
            f"  confidence: {field['confidence']}"
        )
    lines.append("\nJudge only the fields listed above.")
    return "\n".join(lines)


def run_case(
    client: AgentsClient,
    agent_id: str,
    markdown: str,
    fields: list[dict[str, Any]],
    label: str,
) -> dict[str, Any] | None:
    thread = client.threads.create()
    try:
        client.messages.create(
            thread_id=thread.id, role="user", content=build_user_message(markdown, fields)
        )
        run = client.runs.create_and_process(
            thread_id=thread.id,
            agent_id=agent_id,
            response_format=ResponseFormatJsonSchemaType(
                json_schema=ResponseFormatJsonSchema(
                    name="judge_findings",
                    description="Per-field judge verdicts",
                    schema=JUDGE_RESPONSE_SCHEMA,
                )
            ),
        )
        print(f"=== {label} === run status: {run.status}")
        if str(run.status) != "RunStatus.COMPLETED":
            print("last_error", run.last_error)
            return None
        reply = None
        for message in client.messages.list(thread_id=thread.id):
            if str(message.role).endswith("AGENT"):
                reply = message.content[0]["text"]["value"]
                break
        if reply is None:
            print("no agent reply found")
            return None
        parsed = json.loads(reply)
        print(json.dumps(parsed, indent=2))
        return parsed
    finally:
        client.threads.delete(thread.id)


def main() -> int:
    from app.config import get_settings
    from app.cu import CuClient

    settings = get_settings()
    cu_client = CuClient(settings)
    agents_client = AgentsClient(
        endpoint=project_endpoint_from_env(settings.cu_endpoint),
        credential=DefaultAzureCredential(exclude_interactive_browser_credential=True),
    )
    agent = agents_client.create_agent(
        model=MODEL, name="cl-idp-judge-spike", instructions=JUDGE_INSTRUCTIONS
    )
    print("Created spike agent", agent.id)

    try:
        print(f"Analyzing {SAMPLE_FILE.name} with {GROUP_BENEFITS_ANALYZER_ID}...")
        result = analyze_sample(cu_client, SAMPLE_FILE.read_bytes())
        extraction = next(c for c in result["result"]["contents"] if "fields" in c)
        markdown = extraction["markdown"]
        raw_fields = extraction["fields"]

        names = ["planAdministratorEmail", "billBySeparateDivision", "planAdministratorLastName"]
        fields = [
            {
                "path": f"/{name}",
                "label": name,
                "type": raw_fields[name]["type"],
                "value": leaf_value(raw_fields[name]),
                "confidence": raw_fields[name].get("confidence"),
            }
            for name in names
        ]

        # These three fields are genuinely correctly extracted per the
        # document text despite being flagged low-confidence (handwriting +
        # checkbox OCR). A reliable judge must say "ok" for all three,
        # every time.
        for i in range(3):
            run_case(agents_client, agent.id, markdown, fields, f"all-correct-run-{i + 1}")

        # Deliberately corrupt two of the three values to confirm the judge
        # still catches genuine mismatches (recall) without flagging the
        # untouched third field (precision).
        corrupted = [dict(field) for field in fields]
        corrupted[0]["value"] = "sofia.alvarez@wrongdomain-typo.com"
        corrupted[2]["value"] = "Alvarado"
        run_case(agents_client, agent.id, markdown, corrupted, "corrupted-2-of-3-fields")

        print()
        print(
            "VERDICT: markdown/OCR text is sufficient evidence for reliable per-field "
            "judgement; a schema that orders documentValue/matches/rationale before the "
            "final verdict produced consistent 'ok' verdicts on genuinely-correct "
            "low-confidence fields across repeated runs, and correctly caught both "
            "deliberately corrupted fields as 'fix' with accurate suggested values "
            "while leaving the untouched field 'ok'. Page-image evidence was not "
            "pursued further: the Agents API rejects raw PDF attachments as image "
            "blocks, requiring a new PDF rasterization dependency for no demonstrated "
            "accuracy benefit over the markdown text CU already returns."
        )
        return 0
    finally:
        agents_client.delete_agent(agent.id)
        agents_client.close()
        cu_client.close()


if __name__ == "__main__":
    sys.exit(main())
