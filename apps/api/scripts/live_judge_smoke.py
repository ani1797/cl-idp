"""One-off LIVE validation script for the Foundry AI Agent Judge feature
(not part of the test suite; throwaway, run manually against real Azure
resources). Exercises the actual production modules end-to-end:

  CuClient.analyze_binary/get_analyzer_result (real CU "prebuilt-invoice")
    -> hand-picked low-confidence fields (simulating confidenceViolations)
    -> app.judge.prompt.collect_flagged_fields / build_user_message
    -> app.judge.client.JudgeClient.adjudicate (real Foundry Agents call)
    -> app.judge.schema.build_judge_review

Run with: uv run python scripts/live_judge_smoke.py
"""

from __future__ import annotations

import time
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_settings
from app.cu.client import CuClient
from app.judge.client import JudgeClient
from app.judge.prompt import JUDGE_INSTRUCTIONS, build_user_message, collect_flagged_fields
from app.judge.schema import build_judge_review
from app.models.public import StringField

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "samples"


def main() -> int:
    settings = get_settings()
    print(f"JUDGE_ENABLED={settings.judge_enabled}")
    print(f"JUDGE_PROJECT_ENDPOINT={settings.judge_project_endpoint}")
    print(f"CU_ENDPOINT={settings.cu_endpoint}")

    cu_client = CuClient(settings)
    try:
        print("\n--- Analyzing samples/invoice.pdf with prebuilt-invoice ---")
        operation_id = cu_client.analyze_binary(
            "prebuilt-invoice",
            (SAMPLES_DIR / "invoice.pdf").read_bytes(),
            content_type="application/pdf",
        )
        result = None
        for _ in range(60):
            result = cu_client.get_analyzer_result(operation_id)
            status = result.get("status")
            print(f"  poll status={status}")
            if status in ("Succeeded", "Failed"):
                break
            time.sleep(2)
        assert result is not None and result.get("status") == "Succeeded", result

        content = result["result"]["contents"][0]
        markdown = content.get("markdown")
        raw_fields = content.get("fields", {})
        print(f"\n  markdown present: {markdown is not None} ({len(markdown or '')} chars)")
        print(f"  extracted field names: {list(raw_fields.keys())}")

        # Build real Field objects out of the two leaf fields we will treat
        # as "flagged for review" -- same shape the worker's confidenceViolations
        # list would reference -- using the REAL extracted values but a
        # synthetic low confidence (to simulate a job whose business process
        # confidenceThreshold flagged them), one left untouched (should judge
        # "ok") and one deliberately corrupted (should judge "fix").
        def leaf_value(raw: dict) -> object:
            return raw.get("valueString") or raw.get("valueNumber") or raw.get("valueDate")

        invoice_id_raw = raw_fields.get("InvoiceId", {})
        amount_due_raw = raw_fields.get("AmountDue", {}).get("valueObject", {}).get("Amount", {})

        correct_value = str(leaf_value(invoice_id_raw) or "UNKNOWN")
        wrong_value = "WRONG-VALUE-999"  # deliberately corrupted

        fields = [
            StringField(
                name="InvoiceId",
                path="/InvoiceId",
                type="string",
                value=correct_value,
                confidence=0.4,
            ),
            StringField(
                name="AmountDue/Amount",
                path="/AmountDue/Amount",
                type="string",
                value=wrong_value,
                confidence=0.4,
            ),
        ]
        confidence_violations = ["/InvoiceId", "/AmountDue/Amount"]

        print(f"\n  InvoiceId real extracted value: {correct_value!r} (fed to judge unchanged)")
        print(f"  AmountDue/Amount real value available: {amount_due_raw!r}")
        print(f"  AmountDue/Amount fed to judge (deliberately wrong): {wrong_value!r}")

        flagged = collect_flagged_fields(fields, confidence_violations=confidence_violations, max_fields=25)
        user_message = build_user_message(markdown or "", flagged)

        print("\n--- Calling real Foundry Agents Judge ---")
        judge_client = JudgeClient(settings)
        try:
            raw_reply = judge_client.adjudicate(instructions=JUDGE_INSTRUCTIONS, user_message=user_message)
        finally:
            judge_client.close()

        print(f"\nraw reply:\n{raw_reply}")

        review = build_judge_review(
            raw_reply,
            flagged_fields={f.path: f.value for f in flagged},
            model=settings.judge_model_deployment,
            evaluated_at=datetime.now(UTC),
        )

        print("\n--- JudgeReview ---")
        print(f"status={review.status} recommendation={review.recommendation}")
        for finding in review.findings:
            print(
                f"  path={finding.path} verdict={finding.verdict} "
                f"suggestedValue={finding.suggestedValue!r} rationale={finding.rationale!r}"
            )

        ok_finding = next(f for f in review.findings if f.path == "/InvoiceId")
        fix_finding = next(f for f in review.findings if f.path == "/AmountDue/Amount")

        assert ok_finding.verdict == "ok", f"expected InvoiceId to be judged ok, got {ok_finding.verdict}"
        assert fix_finding.verdict == "fix", (
            f"expected AmountDue/Amount to be judged fix, got {fix_finding.verdict}"
        )
        print("\nVERDICT: PASS — real document correctly judged ok, corrupted value correctly judged fix.")
        return 0
    finally:
        cu_client.close()


if __name__ == "__main__":
    raise SystemExit(main())
