#!/usr/bin/env python3
from __future__ import annotations

import json
import mimetypes
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

API_ROOT = Path(__file__).resolve().parents[1]
if str(API_ROOT) not in sys.path:
    sys.path.insert(0, str(API_ROOT))

from seed import resolve_repo_root

from app.config import Settings
from app.cu.client import ContentUnderstandingError, CuClient

REPO_ROOT = resolve_repo_root()
SAMPLES_ROOT = REPO_ROOT / "samples"
POLL_SECONDS = 2
ANALYZE_TIMEOUT_SECONDS = 10 * 60


@dataclass(frozen=True)
class AnalyzerSpec:
    analyzer_id: str
    description: str
    sample_paths: tuple[Path, ...]
    field_schema: dict[str, Any]

    def payload(self, completion_model_name: str) -> dict[str, Any]:
        return {
            "description": self.description,
            "baseAnalyzerId": "prebuilt-document",
            "models": {"completion": completion_model_name},
            "config": {"estimateFieldSourceAndConfidence": True},
            "fieldSchema": self.field_schema,
        }


def field_definition(
    *,
    field_type: str,
    description: str,
    method: str = "extract",
    enum: list[str] | None = None,
    examples: list[str] | None = None,
    items: dict[str, Any] | None = None,
    properties: dict[str, Any] | None = None,
    estimate_source_and_confidence: bool = True,
) -> dict[str, Any]:
    definition: dict[str, Any] = {
        "type": field_type,
        "method": method,
        "description": description,
    }
    if enum is not None:
        definition["enum"] = enum
    if examples is not None:
        definition["examples"] = examples
    if items is not None:
        definition["items"] = items
    if properties is not None:
        definition["properties"] = properties
    if estimate_source_and_confidence and method != "generate":
        definition["estimateSourceAndConfidence"] = True
    return definition


def build_specs() -> tuple[AnalyzerSpec, ...]:
    drug_samples = tuple(sorted((SAMPLES_ROOT / "drug-prior-authorization").glob("*.pdf")))
    group_samples = tuple(sorted((SAMPLES_ROOT / "group-benefits").glob("*.pdf")))
    invoice_samples = tuple(sorted((SAMPLES_ROOT / "invoice").glob("*.pdf")))
    cheque_samples = tuple(sorted((SAMPLES_ROOT / "cheques").glob("*.pdf")))

    if not drug_samples:
        raise RuntimeError("No sample PDFs found under samples/drug-prior-authorization/")
    if not group_samples:
        raise RuntimeError("No sample PDFs found under samples/group-benefits/")
    if not invoice_samples:
        raise RuntimeError("No sample PDFs found under samples/invoice/")
    if not cheque_samples:
        raise RuntimeError("No sample PDFs found under samples/cheques/")

    drug_spec = AnalyzerSpec(
        analyzer_id="drug_prior_auth_glp1",
        description=(
            "Canada Life drug prior authorization form for GLP-1 medications "
            "(Ozempic, Rybelsus, Wegovy, Mounjaro)."
        ),
        sample_paths=drug_samples,
        field_schema={
            "name": "Drug Prior Authorization (GLP-1)",
            "description": (
                "Canada Life drug prior authorization form focused on the filled patient/member "
                "identity fields that are consistently present in the sample set."
            ),
            "fields": {
                "planMemberName": field_definition(
                    field_type="string",
                    description="Plan member name in the Patient Information section.",
                ),
                "patientName": field_definition(
                    field_type="string",
                    description="Patient name in the Patient Information section.",
                ),
                "planNumber": field_definition(
                    field_type="string",
                    description="Plan number in the Patient Information section.",
                ),
                "planMemberIdNumber": field_definition(
                    field_type="string",
                    description="Plan member ID number in the Patient Information section.",
                ),
                "patientDateOfBirth": field_definition(
                    field_type="date",
                    description="Patient date of birth in the Patient Information section.",
                ),
                "patientAddress": field_definition(
                    field_type="string",
                    description=(
                        "Patient address in the Patient Information section, including any written "
                        "street, city, province, or postal code."
                    ),
                ),
                "requestedDrug": field_definition(
                    field_type="string",
                    description=(
                        "The specific GLP-1 drug explicitly selected or handwritten on the form. "
                        "Return only Ozempic, Rybelsus, Wegovy, or Mounjaro. If none is explicitly "
                        "selected, leave the field empty."
                    ),
                    enum=["Ozempic", "Rybelsus", "Wegovy", "Mounjaro"],
                ),
            },
        },
    )

    group_spec = AnalyzerSpec(
        analyzer_id="group_benefits_application",
        description="Canada Life Selectpac application for group benefits.",
        sample_paths=group_samples,
        field_schema={
            "name": "Group Benefits Application",
            "description": (
                "Canada Life Selectpac application for group benefits focused on the first-page "
                "applicant and administrator details that are populated throughout the sample set."
            ),
            "fields": {
                "requestedEffectiveDate": field_definition(
                    field_type="date",
                    description=(
                        "Requested effective date on page 1. Normalize handwritten or spaced OCR "
                        "forms of the date into ISO format."
                    ),
                    examples=["2026-08-01", "2026-11-01"],
                ),
                "language": field_definition(
                    field_type="string",
                    description="Selected application language on page 1.",
                    enum=["English", "French"],
                ),
                "groupApplicantLegalName": field_definition(
                    field_type="string",
                    description="Full legal name of the group applicant company on page 1.",
                ),
                "streetAddress": field_definition(
                    field_type="string",
                    description=(
                        "Street address of the group applicant on page 1. Return only the address "
                        "text, not trailing punctuation or nearby field labels."
                    ),
                ),
                "city": field_definition(
                    field_type="string",
                    description="City of the group applicant address on page 1.",
                ),
                "province": field_definition(
                    field_type="string",
                    description="Province of the group applicant address on page 1.",
                ),
                "postalCode": field_definition(
                    field_type="string",
                    description=(
                        "Postal code of the group applicant address on page 1. Preserve the "
                        "Canadian postal code format with a space when present."
                    ),
                ),
                "planAdministratorLastName": field_definition(
                    field_type="string",
                    description=(
                        "Last name of the plan administrator on page 1. If Same as Business Owner "
                        "is selected, use the business owner last name."
                    ),
                ),
                "planAdministratorFirstName": field_definition(
                    field_type="string",
                    description=(
                        "First name of the plan administrator on page 1. If Same as Business Owner "
                        "is selected, use the business owner first name."
                    ),
                ),
                "planAdministratorTitle": field_definition(
                    field_type="string",
                    description=(
                        "Title of the plan administrator on page 1. If Same as Business Owner is "
                        "selected, use the business owner title."
                    ),
                ),
                "planAdministratorEmail": field_definition(
                    field_type="string",
                    description=(
                        "Email address of the plan administrator on page 1. If Same as Business "
                        "Owner is selected, use the business owner email address."
                    ),
                ),
                "planAdministratorTelephone": field_definition(
                    field_type="string",
                    description=(
                        "Telephone number of the plan administrator on page 1. If Same as Business "
                        "Owner is selected, use the business owner telephone number."
                    ),
                ),
                "subsidiaryCompanies": field_definition(
                    field_type="array",
                    description=(
                        "List of subsidiary or affiliated company names shown in the Subsidiary / "
                        "affiliated firm information section. Omit blank rows."
                    ),
                    items=field_definition(
                        field_type="string",
                        description="One subsidiary or affiliated company name.",
                    ),
                ),
                "billBySeparateDivision": field_definition(
                    field_type="boolean",
                    description=(
                        "Whether Create bills separately by division number is answered Yes on page "
                        "1. Return true for Yes and false for No."
                    ),
                ),
            },
        },
    )

    invoice_spec = AnalyzerSpec(
        analyzer_id="canada_life_invoice",
        description="Canada Life vendor invoice intake for the Drug Prior Authorization process.",
        sample_paths=invoice_samples,
        field_schema={
            "name": "Invoice",
            "description": (
                "Vendor invoice focused on the header, billing, and totals fields that support "
                "human review of prior-authorization-related billing."
            ),
            "fields": {
                "invoiceNumber": field_definition(
                    field_type="string",
                    description="Invoice number or identifier printed on the invoice header.",
                ),
                "invoiceDate": field_definition(
                    field_type="date",
                    description="Date the invoice was issued.",
                ),
                "dueDate": field_definition(
                    field_type="date",
                    description="Payment due date shown on the invoice, if present.",
                ),
                "vendorName": field_definition(
                    field_type="string",
                    description="Name of the vendor or company issuing the invoice.",
                ),
                "billToName": field_definition(
                    field_type="string",
                    description="Name of the customer or entity being billed.",
                ),
                "totalAmount": field_definition(
                    field_type="number",
                    description="Total amount due on the invoice.",
                ),
            },
        },
    )

    cheque_spec = AnalyzerSpec(
        analyzer_id="cheque_verification",
        description="Cheque verification form for the human-in-the-loop verification process.",
        sample_paths=cheque_samples,
        field_schema={
            "name": "Cheque Verification",
            "description": (
                "Bank cheque focused on the payee, amount, date, and account fields that require "
                "human verification before processing."
            ),
            "fields": {
                "payeeName": field_definition(
                    field_type="string",
                    description="Name of the payee written on the Pay to the order of line.",
                ),
                "chequeNumber": field_definition(
                    field_type="string",
                    description="Cheque number printed on the cheque, typically in the top right corner.",
                ),
                "chequeDate": field_definition(
                    field_type="date",
                    description="Date written on the cheque.",
                ),
                "amountNumeric": field_definition(
                    field_type="number",
                    description="Numeric dollar amount of the cheque, shown in the amount box.",
                ),
                "amountWords": field_definition(
                    field_type="string",
                    description="Written-out dollar amount of the cheque in words.",
                ),
                "bankName": field_definition(
                    field_type="string",
                    description="Name of the bank or financial institution issuing the cheque.",
                ),
                "routingNumber": field_definition(
                    field_type="string",
                    description="Bank routing/transit number printed along the bottom MICR line.",
                ),
                "accountNumber": field_definition(
                    field_type="string",
                    description="Bank account number printed along the bottom MICR line.",
                ),
                "signaturePresent": field_definition(
                    field_type="boolean",
                    description="Whether a handwritten signature is present on the signature line.",
                ),
            },
        },
    )

    return drug_spec, group_spec, invoice_spec, cheque_spec


def wait_for_analysis_result(client: CuClient, operation_id: str) -> dict[str, Any]:
    deadline = time.monotonic() + ANALYZE_TIMEOUT_SECONDS
    while True:
        result = client.get_analyzer_result(operation_id)
        status = result.get("status")
        if status in {"Succeeded", "Failed"}:
            return result
        if time.monotonic() >= deadline:
            raise RuntimeError(
                f"Timed out waiting for analyzeBinary operation {operation_id} to complete."
            )
        time.sleep(POLL_SECONDS)


def content_type_for_path(path: Path) -> str:
    guessed, _ = mimetypes.guess_type(path.name)
    return guessed or "application/octet-stream"


def top_level_fields(result: dict[str, Any]) -> dict[str, Any]:
    contents = result.get("result", {}).get("contents", [])
    if not isinstance(contents, list):
        return {}
    for content in contents:
        if isinstance(content, dict) and isinstance(content.get("fields"), dict):
            return content["fields"]
    return {}


def format_confidence(value: Any) -> str:
    return f"{value:.3f}" if isinstance(value, int | float) else "n/a"


def field_value(field: dict[str, Any]) -> Any:
    field_type = field.get("type")
    if field_type == "string":
        return field.get("valueString")
    if field_type == "date":
        return field.get("valueDate")
    if field_type == "time":
        return field.get("valueTime")
    if field_type == "number":
        return field.get("valueNumber")
    if field_type == "integer":
        return field.get("valueInteger")
    if field_type == "boolean":
        return field.get("valueBoolean")
    if field_type == "array":
        value_array = field.get("valueArray")
        if not isinstance(value_array, list):
            return []
        return [field_value(item) for item in value_array if isinstance(item, dict)]
    if field_type == "object":
        value_object = field.get("valueObject")
        if not isinstance(value_object, dict):
            return {}
        return {
            key: field_value(value)
            for key, value in value_object.items()
            if isinstance(key, str) and isinstance(value, dict)
        }
    return None


def has_value(field: dict[str, Any]) -> bool:
    value = field_value(field)
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | dict):
        return bool(value)
    return True


def print_field(name: str, field: dict[str, Any], *, indent: int = 0) -> None:
    prefix = " " * indent
    field_type = field.get("type", "unknown")
    confidence = format_confidence(field.get("confidence"))

    if field_type == "array":
        items = field.get("valueArray")
        count = len(items) if isinstance(items, list) else 0
        print(f"{prefix}- {name}: [{count} item(s)] (confidence={confidence})")
        if isinstance(items, list):
            for index, item in enumerate(items):
                if isinstance(item, dict):
                    print_field(f"[{index}]", item, indent=indent + 2)
        return

    if field_type == "object":
        print(f"{prefix}- {name}: {{}} (confidence={confidence})")
        value_object = field.get("valueObject")
        if isinstance(value_object, dict):
            for child_name, child_value in value_object.items():
                if isinstance(child_name, str) and isinstance(child_value, dict):
                    print_field(child_name, child_value, indent=indent + 2)
        return

    value = field_value(field)
    if value is None:
        rendered_value = "<empty>"
    elif isinstance(value, str):
        rendered_value = value
    else:
        rendered_value = json.dumps(value, ensure_ascii=False)

    print(f"{prefix}- {name}: {rendered_value} (type={field_type}, confidence={confidence})")


def train_and_verify_analyzer(client: CuClient, spec: AnalyzerSpec) -> None:
    print(f"=== Training {spec.analyzer_id} ===")
    created = client.create_or_replace_analyzer(
        spec.analyzer_id,
        spec.payload(client.resolve_completion_model_name()),
    )
    print(f"Submitted analyzer {spec.analyzer_id}; initial status={created.status}")

    final_record = client.wait_for_analyzer_terminal_status(
        spec.analyzer_id,
        poll_interval_seconds=POLL_SECONDS,
        timeout_seconds=10 * 60,
    )
    print(f"Analyzer {spec.analyzer_id} final status={final_record.status}")
    if final_record.status != "ready":
        raise RuntimeError(f"Analyzer {spec.analyzer_id} finished in non-ready status.")

    for sample_path in spec.sample_paths:
        print()
        print(f"--- {spec.analyzer_id} :: {sample_path.relative_to(REPO_ROOT)} ---")
        operation_id = client.analyze_binary(
            spec.analyzer_id,
            sample_path.read_bytes(),
            content_type=content_type_for_path(sample_path),
        )
        result = wait_for_analysis_result(client, operation_id)
        if result.get("status") != "Succeeded":
            raise RuntimeError(
                f"Analysis failed for {sample_path.name} with status {result.get('status')}."
            )

        fields = top_level_fields(result)
        populated_count = sum(
            1 for value in fields.values() if isinstance(value, dict) and has_value(value)
        )
        print(f"Populated top-level fields: {populated_count}/{len(fields)}")
        if not fields:
            print("(no extracted fields)")
            continue
        for field_name, field in fields.items():
            if isinstance(field_name, str) and isinstance(field, dict):
                print_field(field_name, field)


def main() -> int:
    settings = Settings()
    client = CuClient(settings)
    try:
        specs = build_specs()
        for spec in specs:
            train_and_verify_analyzer(client, spec)
        print()
        print("Done.")
        return 0
    except (ContentUnderstandingError, RuntimeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
