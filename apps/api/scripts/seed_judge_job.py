"""One-off LIVE seeding script to visually validate the Judge pill in the
running dev stack's web UI (not part of the test suite; throwaway). Uses
the REAL JudgeReview produced by scripts/live_judge_smoke2.py (an actual
Foundry Agents call against live_captured_routed_direct_prebuilt_invoice
fixture text) and persists it on a real job document via the same
DataStore/BlobService the API/worker use, so the API and web containers
(pointed at the same Mongo/Azurite) see it immediately.

Run with: PYTHONPATH=. uv run python scripts/seed_judge_job.py
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from app.config import get_settings
from app.db import create_data_store
from app.models import (
    AnalyzerRef,
    BusinessProcessDocument,
    JobDocument,
    JobStatus,
    RoutingAnalyzerStatus,
)
from app.models.public import JudgeFinding, JudgeReview, JudgeStatus, JudgeVerdict, StringField
from app.storage import BlobService

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "samples"


def main() -> int:
    settings = get_settings()
    data_store = create_data_store(settings)
    blob = BlobService(settings)
    data_store.ensure_schema()
    blob.ensure_container()

    now = datetime.now(UTC)
    process_id = str(uuid4())

    process = data_store.upsert_process(
        BusinessProcessDocument(
            id=process_id,
            name="Judge Live Validation",
            description="Seeded to visually verify the JUDGE RECOMMENDS pill end-to-end.",
            allowedAnalyzerIds=["prebuilt-invoice"],
            allowedAnalyzers=[AnalyzerRef(id="prebuilt-invoice", name="Invoice")],
            confidenceThreshold=0.95,
            ownerEmail="owner@example.com",
            routingAnalyzerId=None,
            routingAnalyzerStatus=RoutingAnalyzerStatus.READY,
            routingAnalyzerError=None,
            createdAt=now,
            updatedAt=now,
        )
    )

    job_id = str(uuid4())
    file_name = "invoice.pdf"
    content = (SAMPLES_DIR / file_name).read_bytes()
    blob_path = f"{process.id}/{job_id}/{file_name}"
    blob.upload_bytes(blob_path, content, "application/pdf")

    fields = [
        StringField(
            name="InvoiceId", path="/InvoiceId", type="string", value="INV-1001", confidence=0.776
        ),
        StringField(
            name="VendorName",
            path="/VendorName",
            type="string",
            value="Globex Industrial",  # deliberately corrupted, matches live_judge_smoke2.py's run
            confidence=0.785,
        ),
        StringField(
            name="CustomerName", path="/CustomerName", type="string", value="Fabrikam", confidence=0.538
        ),
    ]
    confidence_violations = ["/InvoiceId", "/VendorName", "/CustomerName"]

    # This is the REAL JudgeReview produced by a live Foundry Agents call in
    # scripts/live_judge_smoke2.py against this exact markdown/field set
    # (re-pasted here rather than re-calling the agent, to keep this seed
    # script fast/deterministic -- the live call itself was already verified
    # separately).
    judge = JudgeReview(
        status=JudgeStatus.COMPLETED,
        recommendation=JudgeVerdict.FIX,
        findings=[
            JudgeFinding(
                path="/InvoiceId",
                verdict=JudgeVerdict.OK,
                extractedValue="INV-1001",
                suggestedValue=None,
                rationale="The document clearly states 'Invoice Number: INV-1001', matching the extracted value exactly.",
            ),
            JudgeFinding(
                path="/VendorName",
                verdict=JudgeVerdict.FIX,
                extractedValue="Globex Industrial",
                suggestedValue="Contoso Supplies",
                rationale="The document shows 'Vendor: Contoso Supplies', which does not match the extracted 'Globex Industrial'.",
            ),
            JudgeFinding(
                path="/CustomerName",
                verdict=JudgeVerdict.OK,
                extractedValue="Fabrikam",
                suggestedValue=None,
                rationale="The document states 'Bill To: Fabrikam', matching the extracted value.",
            ),
        ],
        evaluatedAt=now,
        model=settings.judge_model_deployment,
        error=None,
    )

    job = data_store.upsert_job(
        JobDocument(
            id=job_id,
            processId=process.id,
            correlationId=str(uuid4()),
            fileName=file_name,
            contentType="application/pdf",
            blobPath=blob_path,
            status=JobStatus.SUCCEEDED,
            submittedAt=now,
            completedAt=now,
            detectedForm="prebuilt-invoice",
            detectedFormName="Invoice",
            unclassified=False,
            retryOfJobId=None,
            attempts=1,
            pages=None,
            fields=fields,
            fieldCount=len(fields),
            confidenceViolations=confidence_violations,
            notificationSent=False,
            reviewedAt=None,
            error=None,
            judge=judge,
        )
    )

    print(f"processId={process.id}")
    print(f"jobId={job.id}")
    print(f"review url: http://localhost:3000/processes/{process.id}/jobs/{job.id}")
    print("queue url: http://localhost:3000/review-queue")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
