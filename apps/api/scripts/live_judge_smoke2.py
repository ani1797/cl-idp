"""One-off LIVE validation script for the Foundry AI Agent Judge feature
(not part of the test suite; throwaway, run manually against real Azure
resources). Exercises the actual production modules end-to-end using a
REAL, previously-captured Content Understanding response
(tests/fixtures/live_captured_routed_direct_prebuilt_invoice.json --
genuine markdown/OCR text and extracted fields from a live CU run) so the
judge call itself is exercised against real Foundry Agents infrastructure
without depending on the CU analyzer being reachable right now:

  real captured markdown + fields
    -> two fields picked as "flagged for review" (one left correct, one
       deliberately corrupted)
    -> app.judge.prompt.collect_flagged_fields / build_user_message
    -> app.judge.client.JudgeClient.adjudicate (REAL Foundry Agents call)
    -> app.judge.schema.build_judge_review

Run with: PYTHONPATH=. uv run python scripts/live_judge_smoke.py
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_settings
from app.judge.client import JudgeClient
from app.judge.prompt import JUDGE_INSTRUCTIONS, build_user_message, collect_flagged_fields
from app.judge.schema import build_judge_review
from app.models.public import StringField

FIXTURE = (
    Path(__file__).resolve().parent.parent
    / "tests"
    / "fixtures"
    / "live_captured_routed_direct_prebuilt_invoice.json"
)


def main() -> int:
    settings = get_settings()
    print(f"JUDGE_ENABLED={settings.judge_enabled}")
    print(f"JUDGE_PROJECT_ENDPOINT={settings.judge_project_endpoint}")

    data = json.loads(FIXTURE.read_text())
    content = data["result"]["contents"][1]
    markdown = content["markdown"]
    raw_fields = content["fields"]

    print(f"\n--- Using REAL captured CU markdown (live Azure run) ---\n{markdown}\n")

    real_invoice_id = raw_fields["InvoiceId"]["valueString"]
    real_vendor_name = raw_fields["VendorName"]["valueString"]
    wrong_vendor_name = "Globex Industrial"  # deliberately corrupted; document says "Contoso Supplies"

    print(f"Real InvoiceId extracted value: {real_invoice_id!r} (fed to judge UNCHANGED -> expect 'ok')")
    print(f"Real VendorName extracted value: {real_vendor_name!r}")
    print(f"VendorName fed to judge (CORRUPTED): {wrong_vendor_name!r} -> expect 'fix'")

    fields = [
        StringField(name="InvoiceId", path="/InvoiceId", type="string", value=real_invoice_id, confidence=0.4),
        StringField(name="VendorName", path="/VendorName", type="string", value=wrong_vendor_name, confidence=0.4),
    ]
    confidence_violations = ["/InvoiceId", "/VendorName"]

    flagged = collect_flagged_fields(fields, confidence_violations=confidence_violations, max_fields=25)
    user_message = build_user_message(markdown, flagged)

    print("\n--- Calling REAL Foundry Agent Judge (azure-ai-projects versioned agent, live network call) ---")
    judge_client = JudgeClient(settings)
    try:
        raw_reply = judge_client.adjudicate(instructions=JUDGE_INSTRUCTIONS, user_message=user_message)
    finally:
        judge_client.close()

    print(f"\nraw agent reply:\n{raw_reply}")

    review = build_judge_review(
        raw_reply,
        flagged_fields={f.path: f.value for f in flagged},
        model=settings.judge_model_deployment,
        evaluated_at=datetime.now(UTC),
    )

    print("\n--- JudgeReview (as it would be persisted on Job.judge) ---")
    print(review.model_dump_json(indent=2))

    ok_finding = next(f for f in review.findings if f.path == "/InvoiceId")
    fix_finding = next(f for f in review.findings if f.path == "/VendorName")

    assert ok_finding.verdict == "ok", f"expected InvoiceId to be judged ok, got {ok_finding.verdict}"
    assert fix_finding.verdict == "fix", f"expected VendorName to be judged fix, got {fix_finding.verdict}"
    assert fix_finding.suggestedValue, "expected a suggestedValue correction for the fix verdict"
    print(
        "\nVERDICT: PASS \u2014 real document text correctly judged the untouched field 'ok' and the "
        "deliberately corrupted field 'fix' with a suggested correction, via a real Foundry Agents call."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
