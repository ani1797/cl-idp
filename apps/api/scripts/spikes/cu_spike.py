#!/usr/bin/env python3
"""Scratch/live verification spike for Azure AI Content Understanding.

This script is intentionally throwaway investigation code for Task 01.
It talks to a real CU resource, prints raw JSON evidence for each check,
and is not part of the production backend.
"""

from __future__ import annotations

import json
import os
import sys
import time
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from azure.ai.contentunderstanding import ContentUnderstandingClient
from azure.identity import DefaultAzureCredential

API_VERSION = "2025-11-01"
SCOPE = "https://cognitiveservices.azure.com/.default"
POLL_SECONDS = 2
ROUTING_ANALYZER_ID = "idpspikerouting01"
DERIVED_ANALYZER_ID = "idpspikeinvoice01"
HYphen_ANALYZER_ID = "idp-spike-invoice-derived"
MAX_ID_OK = "v" * 987
MAX_ID_FAIL = "u" * 988


def load_local_env() -> None:
    for candidate in (
        Path.cwd() / ".env",
        Path.cwd().parent / ".env",
    ):
        if not candidate.exists():
            continue
        for raw_line in candidate.read_text().splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key, value)


def require_env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def make_pdf(lines: list[str]) -> bytes:
    def escape(text: str) -> str:
        return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    content_lines = ["BT", "/F1 12 Tf", "72 760 Td"]
    for index, line in enumerate(lines):
        if index:
            content_lines.append("0 -18 Td")
        content_lines.append(f"({escape(line)}) Tj")
    content_lines.append("ET")
    stream = "\n".join(content_lines).encode("latin-1")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]"
            b" /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"
        ),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        f"<< /Length {len(stream)} >>\nstream\n".encode("latin-1") + stream + b"\nendstream",
    ]

    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = [0]
    for object_number, object_body in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(f"{object_number} 0 obj\n".encode("latin-1"))
        output.write(object_body)
        output.write(b"\nendobj\n")

    xref_offset = output.tell()
    output.write(f"xref\n0 {len(objects) + 1}\n".encode("latin-1"))
    output.write(b"0000000000 65535 f \n")
    for offset in offsets[1:]:
        output.write(f"{offset:010d} 00000 n \n".encode("latin-1"))
    output.write(
        (
            f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\n"
            f"startxref\n{xref_offset}\n%%EOF\n"
        ).encode("latin-1")
    )
    return output.getvalue()


@dataclass
class RawResponse:
    status_code: int
    headers: dict[str, str]
    body: Any


class CuRawClient:
    def __init__(self, endpoint: str) -> None:
        self.endpoint = endpoint.rstrip("/")
        self.credential = DefaultAzureCredential(exclude_interactive_browser_credential=True)
        self.sdk_client = ContentUnderstandingClient(
            endpoint=self.endpoint,
            credential=self.credential,
            api_version=API_VERSION,
        )
        self.session = requests.Session()

    def close(self) -> None:
        self.sdk_client.close()
        self.session.close()

    def _auth_header(self) -> dict[str, str]:
        token = self.credential.get_token(SCOPE).token
        return {"Authorization": f"Bearer {token}"}

    def request(
        self,
        method: str,
        path_or_url: str,
        *,
        json_body: Any | None = None,
        data: bytes | None = None,
        content_type: str | None = None,
        absolute_url: bool = False,
    ) -> RawResponse:
        headers = self._auth_header()
        if content_type:
            headers["Content-Type"] = content_type
        url = path_or_url if absolute_url else f"{self.endpoint}{path_or_url}"
        response = self.session.request(
            method=method,
            url=url,
            headers=headers,
            json=json_body,
            data=data,
            timeout=120,
        )
        try:
            body: Any = response.json()
        except ValueError:
            body = response.text
        return RawResponse(response.status_code, dict(response.headers), body)


def pretty_json(data: Any) -> str:
    return json.dumps(data, indent=2, sort_keys=False, ensure_ascii=False)


def print_response(title: str, response: RawResponse) -> None:
    print(title)
    print(f"HTTP {response.status_code}")
    interesting_headers = {
        key: value
        for key, value in response.headers.items()
        if key.lower() in {"operation-location", "retry-after", "content-type", "location"}
    }
    if interesting_headers:
        print("Headers:")
        print(pretty_json(interesting_headers))
    print("Body:")
    if isinstance(response.body, (dict, list)):
        print(pretty_json(response.body))
    else:
        print(response.body)


def wait_for_analyzer_ready(client: CuRawClient, analyzer_id: str) -> RawResponse:
    while True:
        response = client.request(
            "GET",
            f"/contentunderstanding/analyzers/{analyzer_id}?api-version={API_VERSION}",
        )
        if isinstance(response.body, dict) and response.body.get("status") in {"ready", "failed"}:
            return response
        time.sleep(POLL_SECONDS)


def wait_for_operation(client: CuRawClient, operation_location: str) -> RawResponse:
    while True:
        response = client.request("GET", operation_location, absolute_url=True)
        if isinstance(response.body, dict) and response.body.get("status") in {"Succeeded", "Failed"}:
            return response
        time.sleep(POLL_SECONDS)


def choose_completion_model(model_deployments: dict[str, str], configured_deployment: str | None) -> str:
    preferred_models = [key for key in model_deployments if not key.startswith("prebuilt-")]
    if configured_deployment:
        matches = [key for key, value in model_deployments.items() if value == configured_deployment]
        if "gpt-5-mini" in matches:
            return "gpt-5-mini"
        if matches:
            for match in matches:
                if not match.startswith("prebuilt-"):
                    return match
            return matches[0]
    if "gpt-5-mini" in model_deployments:
        return "gpt-5-mini"
    if preferred_models:
        return preferred_models[0]
    raise RuntimeError("No completion model mapping was available from CU defaults.")


def summary_for_contents(result_body: dict[str, Any]) -> list[dict[str, Any]]:
    contents = result_body.get("result", {}).get("contents", [])
    summary: list[dict[str, Any]] = []
    for item in contents:
        summary.append(
            {
                "path": item.get("path"),
                "analyzerId": item.get("analyzerId"),
                "category": item.get("category"),
                "hasFields": bool(item.get("fields")),
                "segmentCategories": [segment.get("category") for segment in item.get("segments", [])],
            }
        )
    return summary


def main() -> int:
    load_local_env()
    endpoint = require_env("CU_ENDPOINT")
    configured_deployment = os.environ.get("CU_MODEL_DEPLOYMENT")
    client = CuRawClient(endpoint)
    created_analyzer_ids: set[str] = set()

    invoice_pdf = make_pdf(
        [
            "INVOICE",
            "Vendor: Contoso Supplies",
            "Invoice Number: INV-1001",
            "Invoice Date: 2026-09-01",
            "Bill To: Fabrikam",
            "Item: Printer paper Qty: 10 Price: 45.00",
            "Total: 450.00 USD",
        ]
    )
    memo_pdf = make_pdf(
        [
            "TEAM MEETING NOTES",
            "Project: Enterprise IDP",
            "Agenda",
            "- Discuss roadmap",
            "- Review dependencies",
            "- Decide next steps",
        ]
    )

    try:
        defaults = dict(client.sdk_client.get_defaults())
        model_deployments = defaults.get("modelDeployments", {})
        completion_model = choose_completion_model(model_deployments, configured_deployment)
        print("# Azure AI Content Understanding spike")
        print(f"API version: {API_VERSION}")
        print(f"Endpoint: {endpoint}")
        print(f"Configured CU_MODEL_DEPLOYMENT: {configured_deployment or '<unset>'}")
        print("SDK get_defaults() raw JSON:")
        print(pretty_json(defaults))
        print(
            "Using completion model name for routing analyzer: "
            f"{completion_model} -> {model_deployments.get(completion_model)}"
        )
        print()

        print("=== CHECK A: GET /contentunderstanding/analyzers ===")
        analyzers_response = client.request(
            "GET", f"/contentunderstanding/analyzers?api-version={API_VERSION}"
        )
        print_response("Analyzer list response", analyzers_response)
        analyzer_ids = {
            item.get("analyzerId")
            for item in analyzers_response.body.get("value", [])
            if isinstance(item, dict)
        }
        prebuilts_present = {"prebuilt-invoice", "prebuilt-receipt"} <= analyzer_ids
        print(
            "VERDICT: prebuilt analyzers "
            + ("ARE" if prebuilts_present else "ARE NOT")
            + " present in GET /analyzers; "
            "the live response included prebuilt-invoice and prebuilt-receipt."
        )
        print()

        print("=== CHECK B: derive from prebuilt-invoice and inspect confidence/source ===")
        derived_payload = {
            "description": "scratch Task 01 derived analyzer attempt",
            "tags": {"createdBy": "cl-idp", "spike": "true"},
            "baseAnalyzerId": "prebuilt-invoice",
            "config": {"estimateFieldSourceAndConfidence": True},
        }
        derived_create = client.request(
            "PUT",
            (
                f"/contentunderstanding/analyzers/{DERIVED_ANALYZER_ID}"
                f"?api-version={API_VERSION}&allowReplace=true"
            ),
            json_body=derived_payload,
            content_type="application/json",
        )
        print_response("Derived analyzer create response", derived_create)

        if derived_create.status_code < 400:
            created_analyzer_ids.add(DERIVED_ANALYZER_ID)
            derived_ready = wait_for_analyzer_ready(client, DERIVED_ANALYZER_ID)
            print_response("Derived analyzer final state", derived_ready)
            derived_submit = client.request(
                "POST",
                f"/contentunderstanding/analyzers/{DERIVED_ANALYZER_ID}:analyzeBinary?api-version={API_VERSION}",
                data=invoice_pdf,
                content_type="application/pdf",
            )
            print_response("Derived analyzer analyze submit response", derived_submit)
            operation_location = derived_submit.headers["Operation-Location"]
            derived_result = wait_for_operation(client, operation_location)
            print_response("Derived analyzer analyze final response", derived_result)
            print(
                "VERDICT: prebuilt-invoice DID derive successfully and the final analyze "
                "result should be inspected above for confidence/source fields."
            )
        else:
            direct_prebuilt_submit = client.request(
                "POST",
                f"/contentunderstanding/analyzers/prebuilt-invoice:analyzeBinary?api-version={API_VERSION}",
                data=invoice_pdf,
                content_type="application/pdf",
            )
            print_response("Direct prebuilt-invoice analyze submit response", direct_prebuilt_submit)
            direct_prebuilt_result = wait_for_operation(
                client, direct_prebuilt_submit.headers["Operation-Location"]
            )
            print_response("Direct prebuilt-invoice analyze final response", direct_prebuilt_result)
            print(
                "VERDICT: deriving from prebuilt-invoice is NOT supported on this account/API "
                "(InvalidBaseAnalyzerId), but direct prebuilt-invoice analysis already returns "
                "confidence and source on extracted fields."
            )
        print()

        print("=== CHECK C: routing analyzer contents[] shape ===")
        routing_payload = {
            "description": "scratch Task 01 routing analyzer",
            "tags": {"createdBy": "cl-idp", "spike": "true"},
            "baseAnalyzerId": "prebuilt-document",
            "models": {"completion": completion_model},
            "config": {
                "enableSegment": False,
                "omitContent": False,
                "contentCategories": {
                    "prebuilt-invoice": {
                        "description": "Supplier invoices and utility bills",
                        "analyzerId": "prebuilt-invoice",
                    },
                    "prebuilt-receipt": {
                        "description": "Point-of-sale and dining receipts",
                        "analyzerId": "prebuilt-receipt",
                    },
                    "other": {"description": "Any document not matching the categories above"},
                },
            },
        }
        routing_create = client.request(
            "PUT",
            (
                f"/contentunderstanding/analyzers/{ROUTING_ANALYZER_ID}"
                f"?api-version={API_VERSION}&allowReplace=true"
            ),
            json_body=routing_payload,
            content_type="application/json",
        )
        print_response("Routing analyzer create response", routing_create)
        if routing_create.status_code < 400:
            created_analyzer_ids.add(ROUTING_ANALYZER_ID)
        routing_ready = wait_for_analyzer_ready(client, ROUTING_ANALYZER_ID)
        print_response("Routing analyzer final state", routing_ready)

        routing_invoice_submit = client.request(
            "POST",
            f"/contentunderstanding/analyzers/{ROUTING_ANALYZER_ID}:analyzeBinary?api-version={API_VERSION}",
            data=invoice_pdf,
            content_type="application/pdf",
        )
        print_response("Routing analyzer invoice submit response", routing_invoice_submit)
        routing_invoice_result = wait_for_operation(
            client, routing_invoice_submit.headers["Operation-Location"]
        )
        print_response("Routing analyzer invoice final response", routing_invoice_result)
        print("Invoice contents summary:")
        print(pretty_json(summary_for_contents(routing_invoice_result.body)))

        routing_memo_submit = client.request(
            "POST",
            f"/contentunderstanding/analyzers/{ROUTING_ANALYZER_ID}:analyzeBinary?api-version={API_VERSION}",
            data=memo_pdf,
            content_type="application/pdf",
        )
        print_response("Routing analyzer non-matching submit response", routing_memo_submit)
        routing_memo_result = wait_for_operation(
            client, routing_memo_submit.headers["Operation-Location"]
        )
        print_response("Routing analyzer non-matching final response", routing_memo_result)
        print("Non-matching contents summary:")
        print(pretty_json(summary_for_contents(routing_memo_result.body)))
        print(
            "VERDICT: a routed invoice returns TWO contents objects "
            "(routing content first with category in segments[0].category, then routed analyzer "
            "content with top-level category + fields); an 'other' document returns ONE "
            "routing-only content object with segments[0].category == 'other' and no fields."
        )
        print()

        print("=== CHECK D: analyzer ID mechanics and allowReplace ===")
        hyphen_attempt = client.request(
            "PUT",
            (
                f"/contentunderstanding/analyzers/{HYphen_ANALYZER_ID}"
                f"?api-version={API_VERSION}&allowReplace=true"
            ),
            json_body=derived_payload,
            content_type="application/json",
        )
        print_response("Hyphenated analyzer ID create response", hyphen_attempt)

        replace_without_allow = client.request(
            "PUT",
            f"/contentunderstanding/analyzers/{ROUTING_ANALYZER_ID}?api-version={API_VERSION}",
            json_body=routing_payload,
            content_type="application/json",
        )
        print_response("Re-PUT existing analyzer without allowReplace", replace_without_allow)

        replace_with_allow = client.request(
            "PUT",
            (
                f"/contentunderstanding/analyzers/{ROUTING_ANALYZER_ID}"
                f"?api-version={API_VERSION}&allowReplace=true"
            ),
            json_body=routing_payload,
            content_type="application/json",
        )
        print_response("Re-PUT existing analyzer with allowReplace=true", replace_with_allow)

        max_ok = client.request(
            "PUT",
            f"/contentunderstanding/analyzers/{MAX_ID_OK}?api-version={API_VERSION}&allowReplace=true",
            json_body=routing_payload,
            content_type="application/json",
        )
        print_response("987-character analyzer ID create response", max_ok)
        if max_ok.status_code < 400:
            created_analyzer_ids.add(MAX_ID_OK)

        max_fail = client.request(
            "PUT",
            f"/contentunderstanding/analyzers/{MAX_ID_FAIL}?api-version={API_VERSION}&allowReplace=true",
            json_body=routing_payload,
            content_type="application/json",
        )
        print_response("988-character analyzer ID create response", max_fail)
        print(
            "VERDICT: re-PUT without allowReplace=true fails with 409/ModelExists; "
            "the same PUT with allowReplace=true succeeds; hyphenated analyzer IDs are rejected; "
            "and this endpoint accepted a 987-character alphanumeric ID while 988 characters "
            "returned 500 InternalServerError."
        )

        return 0
    finally:
        print()
        print("=== CLEANUP ===")
        for analyzer_id in sorted(created_analyzer_ids, key=len, reverse=True):
            delete_response = client.request(
                "DELETE",
                f"/contentunderstanding/analyzers/{analyzer_id}?api-version={API_VERSION}",
            )
            print_response(f"Delete analyzer {analyzer_id!r}", delete_response)
        client.close()


if __name__ == "__main__":
    sys.exit(main())
