from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.config import get_settings
from app.db import DataStore, DocumentNotFoundError, create_data_store
from app.models import JobDocument, JobStatus
from app.storage import BlobService


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
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.command == "cleanup-process":
        cleanup_process(args.process_id)
        return 0

    if args.command == "seed-failed-job":
        seed_failed_job(args.process_id, args.file_path, args.file_name, args.error)
        return 0

    raise AssertionError(f"Unhandled command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
