from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.auth import hash_password
from app.config import get_settings
from app.db import DataStore, DocumentNotFoundError, create_data_store
from app.models import JobDocument, JobStatus, UserDocument
from app.storage import BlobService

# Fixed credentials for the Playwright live suite, independent of the
# DEMO_*_EMAIL/PASSWORD env vars used by scripts/seed.py. Kept out of any
# committed secret file; this is local/test-only and never used in a real
# deployment (auth-guard rejects requests without a valid session or the
# service token regardless of this user existing).
E2E_USER_EMAIL = "e2e-playwright@example.com"
E2E_USER_PASSWORD = "e2e-playwright-password"


def build_services() -> tuple[DataStore, BlobService]:
    settings = get_settings()
    data_store = create_data_store(settings)
    blob = BlobService(settings)
    data_store.ensure_schema()
    blob.ensure_container()
    return data_store, blob


def guess_content_type(file_name: str) -> str:
    extension = Path(file_name).suffix.lower()
    return {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".tif": "image/tiff",
        ".tiff": "image/tiff",
    }.get(extension, "application/octet-stream")


def cleanup_process(process_id: str) -> None:
    data_store, blob = build_services()
    try:
        _ = data_store.read_process(process_id)
    except DocumentNotFoundError:
        print(json.dumps({"deleted": False, "reason": "missing_process"}))
        return

    for job in data_store.list_jobs_for_process(process_id):
        data_store.delete_job(process_id, job.id)

    for blob_name in blob.list_blob_names(prefix=f"{process_id}/"):
        blob.delete_blob(blob_name)

    data_store.delete_process(process_id)
    print(json.dumps({"deleted": True, "processId": process_id}))


def seed_failed_job(process_id: str, file_path: Path, file_name: str, error: str) -> None:
    data_store, blob = build_services()
    _ = data_store.read_process(process_id)

    content = file_path.read_bytes()
    content_type = guess_content_type(file_name)
    now = datetime.now(UTC)
    job_id = str(uuid4())
    blob_path = f"{process_id}/{job_id}/{file_name}"
    blob.upload_bytes(blob_path, content, content_type)

    job = data_store.upsert_job(
        JobDocument(
            id=job_id,
            processId=process_id,
            correlationId=str(uuid4()),
            fileName=file_name,
            contentType=content_type,
            blobPath=blob_path,
            status=JobStatus.FAILED,
            submittedAt=now,
            completedAt=now + timedelta(seconds=1),
            detectedForm=None,
            detectedFormName=None,
            unclassified=None,
            retryOfJobId=None,
            attempts=1,
            pages=None,
            fields=None,
            fieldCount=None,
            confidenceViolations=None,
            notificationSent=False,
            reviewedAt=None,
            error=error,
        )
    )
    print(json.dumps({"jobId": job.id, "fileName": job.fileName}))


def ensure_e2e_user() -> None:
    """Idempotently create (or reactivate) the fixed Playwright test user."""
    data_store, _blob = build_services()
    now = datetime.now(UTC)

    existing = data_store.find_user_by_email(E2E_USER_EMAIL)
    if existing is not None:
        changed = False
        if not existing.isActive:
            existing.isActive = True
            changed = True
        # The live suite and new-screens smoke tests exercise IT-Admin-only
        # capabilities (create process, retry/review jobs, review queue,
        # form models, integrations, user admin), so the fixed e2e user must
        # hold the IT Admin role, not just any authenticated role.
        if existing.roleLabel != "IT Admin":
            existing.roleLabel = "IT Admin"
            changed = True
        if changed:
            existing.updatedAt = now
            data_store.update_user(existing)
        print(json.dumps({"email": E2E_USER_EMAIL, "password": E2E_USER_PASSWORD, "created": False}))
        return

    data_store.create_user(
        UserDocument(
            id=str(uuid4()),
            email=E2E_USER_EMAIL,
            displayName="Playwright E2E User",
            roleLabel="IT Admin",
            passwordHash=hash_password(E2E_USER_PASSWORD),
            isActive=True,
            createdAt=now,
            updatedAt=now,
        )
    )
    print(json.dumps({"email": E2E_USER_EMAIL, "password": E2E_USER_PASSWORD, "created": True}))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Support commands for local Playwright e2e runs.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    cleanup_parser = subparsers.add_parser("cleanup-process")
    cleanup_parser.add_argument("--process-id", required=True)

    seed_parser = subparsers.add_parser("seed-failed-job")
    seed_parser.add_argument("--process-id", required=True)
    seed_parser.add_argument("--file-path", type=Path, required=True)
    seed_parser.add_argument("--file-name", required=True)
    seed_parser.add_argument("--error", default="Forced E2E failure.")

    subparsers.add_parser("ensure-e2e-user")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.command == "cleanup-process":
        cleanup_process(args.process_id)
        return 0

    if args.command == "seed-failed-job":
        seed_failed_job(args.process_id, args.file_path, args.file_name, args.error)
        return 0

    if args.command == "ensure-e2e-user":
        ensure_e2e_user()
        return 0

    raise AssertionError(f"Unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
