from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import httpx

API_ROOT = Path(__file__).resolve().parents[1]


def _resolve_repo_root() -> Path:
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "docker-compose.yml").exists() and (candidate / "apps").exists():
            return candidate
    return API_ROOT


REPO_ROOT = _resolve_repo_root()
SAMPLES_ROOT = REPO_ROOT / "samples"
DEFAULT_API_BASE_URL = os.environ.get("CL_IDP_API_BASE_URL", "http://127.0.0.1:8000")
PROCESS_READY_TIMEOUT_SECONDS = 10 * 60
JOB_READY_TIMEOUT_SECONDS = 10 * 60
PROCESS_POLL_SECONDS = 5
JOB_POLL_SECONDS = 2


@dataclass(frozen=True)
class UploadSeed:
    sample_relative_path: str
    uploaded_file_name: str
    expected_kind: Literal["classified", "unclassified"]
    require_violations: bool = False

    @property
    def sample_path(self) -> Path:
        return SAMPLES_ROOT / self.sample_relative_path


@dataclass(frozen=True)
class ProcessSeed:
    name: str
    description: str
    allowed_analyzer_ids: tuple[str, ...]
    confidence_threshold: float
    owner_email: str
    uploads: tuple[UploadSeed, ...] = ()


@dataclass(frozen=True)
class ProcessResult:
    action: Literal["created", "existing"]
    process: dict[str, Any]


@dataclass(frozen=True)
class JobResult:
    action: Literal["triggered", "existing"]
    process_name: str
    upload: UploadSeed
    job: dict[str, Any]


SEED_PROCESSES: tuple[ProcessSeed, ...] = (
    ProcessSeed(
        name="Demo - Accounts Payable",
        description="Seeded invoice and receipt intake demo with review-ready jobs.",
        allowed_analyzer_ids=("prebuilt-invoice", "prebuilt-receipt"),
        confidence_threshold=1.0,
        owner_email="accounts-payable-demo@example.com",
        uploads=(
            UploadSeed(
                sample_relative_path="invoice.pdf",
                uploaded_file_name="seed-demo-invoice.pdf",
                expected_kind="classified",
                require_violations=True,
            ),
            UploadSeed(
                sample_relative_path="receipt.pdf",
                uploaded_file_name="seed-demo-receipt.pdf",
                expected_kind="classified",
                require_violations=True,
            ),
            UploadSeed(
                sample_relative_path="unrelated.pdf",
                uploaded_file_name="seed-demo-unrelated.pdf",
                expected_kind="unclassified",
            ),
        ),
    ),
    ProcessSeed(
        name="Demo - General Document Intake",
        description="Seeded broad-document process for the secondary walkthrough surface.",
        allowed_analyzer_ids=("prebuilt-document",),
        confidence_threshold=0.0,
        owner_email="operations-demo@example.com",
        uploads=(
            UploadSeed(
                sample_relative_path="group-benefits/Silverbrook_Analytics_Corp._correct_typed.pdf",
                uploaded_file_name="seed-demo-group-benefits.pdf",
                expected_kind="classified",
            ),
        ),
    ),
)


class SeedError(RuntimeError):
    pass


class SeedClient:
    def __init__(self, base_url: str, *, timeout: float = 30.0) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=timeout, follow_redirects=True)

    def close(self) -> None:
        self._client.close()

    def _request(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        response = self._client.request(method, path, **kwargs)
        return response

    def require_success(
        self,
        method: str,
        path: str,
        *,
        expected_status: int | tuple[int, ...] = 200,
        **kwargs: Any,
    ) -> Any:
        response = self._request(method, path, **kwargs)
        statuses = (expected_status,) if isinstance(expected_status, int) else expected_status
        if response.status_code not in statuses:
            body: Any
            try:
                body = response.json()
            except ValueError:
                body = response.text
            raise SeedError(
                f"{method} {path} returned {response.status_code}, expected {statuses}: {body}"
            )

        if response.status_code == 204 or not response.content:
            return None

        return response.json()

    def get_health(self) -> dict[str, Any]:
        return self.require_success("GET", "/healthz", expected_status=(200, 503))

    def list_processes(self) -> list[dict[str, Any]]:
        return self.require_success("GET", "/processes")

    def create_process(self, seed: ProcessSeed) -> dict[str, Any]:
        return self.require_success(
            "POST",
            "/processes",
            expected_status=201,
            json={
                "name": seed.name,
                "description": seed.description,
                "allowedAnalyzerIds": list(seed.allowed_analyzer_ids),
                "confidenceThreshold": seed.confidence_threshold,
                "ownerEmail": seed.owner_email,
            },
        )

    def get_process(self, process_id: str) -> dict[str, Any]:
        return self.require_success("GET", f"/processes/{process_id}")

    def list_jobs(self, process_id: str, *, file_name: str | None = None) -> list[dict[str, Any]]:
        params = {"limit": 100}
        if file_name:
            params["fileName"] = file_name
        return self.require_success("GET", f"/processes/{process_id}/jobs", params=params)

    def trigger_upload(self, process_id: str, upload: UploadSeed) -> dict[str, Any]:
        content_type = guess_content_type(upload.uploaded_file_name)
        with upload.sample_path.open("rb") as file_handle:
            return self.require_success(
                "POST",
                f"/processes/{process_id}/trigger",
                expected_status=202,
                files={"file": (upload.uploaded_file_name, file_handle, content_type)},
            )

    def get_job(self, process_id: str, job_id: str) -> dict[str, Any]:
        return self.require_success("GET", f"/processes/{process_id}/jobs/{job_id}")


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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed local Enterprise IDP demo data via the HTTP API.")
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help=f"FastAPI base URL (default: {DEFAULT_API_BASE_URL})",
    )
    return parser.parse_args()


def normalize_process_seed(seed: ProcessSeed) -> tuple[str, tuple[str, ...], float, str]:
    return (
        seed.description,
        tuple(seed.allowed_analyzer_ids),
        seed.confidence_threshold,
        seed.owner_email.lower(),
    )


def normalize_existing_process(process: dict[str, Any]) -> tuple[str, tuple[str, ...], float, str]:
    return (
        str(process["description"]),
        tuple(process["allowedAnalyzerIds"]),
        float(process["confidenceThreshold"]),
        str(process["ownerEmail"]).lower(),
    )


def ensure_seed_files_exist() -> None:
    missing = [str(upload.sample_path) for process in SEED_PROCESSES for upload in process.uploads if not upload.sample_path.exists()]
    if missing:
        joined = "\n - ".join(missing)
        raise SeedError(f"Seed sample files are missing:\n - {joined}")


def ensure_api_reachable(client: SeedClient) -> None:
    try:
        health = client.get_health()
    except httpx.HTTPError as exc:
        raise SeedError(f"Could not reach API at {client.base_url}: {exc}") from exc

    status = health.get("status")
    dependencies = health.get("dependencies")
    print(f"Health check: status={status} dependencies={dependencies}")


def ensure_process(client: SeedClient, seed: ProcessSeed) -> ProcessResult:
    existing_by_name = {
        str(process["name"]).lower(): process for process in client.list_processes()
    }
    existing = existing_by_name.get(seed.name.lower())
    if existing is not None:
        if normalize_existing_process(existing) != normalize_process_seed(seed):
            raise SeedError(
                "Existing process matched by name but does not match the seed configuration: "
                f"{seed.name} (id={existing['id']}). Delete or rename it, then re-run the seed."
            )
        print(f"Process already exists, reusing: {seed.name} ({existing['id']})")
        return ProcessResult(action="existing", process=existing)

    try:
        created = client.create_process(seed)
    except SeedError as exc:
        message = str(exc)
        if "duplicate_process_name" not in message and "409" not in message:
            raise

        existing = next(
            (process for process in client.list_processes() if str(process["name"]).lower() == seed.name.lower()),
            None,
        )
        if existing is None:
            raise
        print(f"Process creation raced with an existing name, reusing: {seed.name} ({existing['id']})")
        return ProcessResult(action="existing", process=existing)

    print(f"Created process: {seed.name} ({created['id']})")
    return ProcessResult(action="created", process=created)


def wait_for_process_ready(client: SeedClient, process_id: str, process_name: str) -> dict[str, Any]:
    deadline = time.monotonic() + PROCESS_READY_TIMEOUT_SECONDS
    while True:
        process = client.get_process(process_id)
        status = process["routingAnalyzerStatus"]
        if status == "ready":
            print(f"Routing analyzer ready: {process_name} ({process_id})")
            return process
        if status == "failed":
            raise SeedError(
                f"Routing analyzer provisioning failed for {process_name} ({process_id}): "
                f"{process.get('routingAnalyzerError')}"
            )
        if time.monotonic() >= deadline:
            raise SeedError(
                f"Timed out waiting for routing analyzer readiness for {process_name} ({process_id})."
            )
        print(f"Waiting for routing analyzer: {process_name} status={status}")
        time.sleep(PROCESS_POLL_SECONDS)


def validate_job(job: dict[str, Any], upload: UploadSeed) -> None:
    if job["status"] != "succeeded":
        raise SeedError(
            f"Seeded job {job['id']} for {upload.uploaded_file_name} finished as {job['status']}: {job.get('error')}"
        )

    is_unclassified = bool(job.get("unclassified"))
    if upload.expected_kind == "unclassified" and not is_unclassified:
        raise SeedError(
            f"Expected {upload.uploaded_file_name} to be unclassified, but detectedForm={job.get('detectedForm')}."
        )
    if upload.expected_kind == "classified" and is_unclassified:
        raise SeedError(
            f"Expected {upload.uploaded_file_name} to classify successfully, but it was unclassified."
        )
    if upload.require_violations and not job.get("confidenceViolations"):
        raise SeedError(
            f"Expected confidence violations for {upload.uploaded_file_name}, but the job had none."
        )


def wait_for_job_terminal_state(
    client: SeedClient,
    process_id: str,
    process_name: str,
    job_id: str,
    upload: UploadSeed,
) -> dict[str, Any]:
    deadline = time.monotonic() + JOB_READY_TIMEOUT_SECONDS
    while True:
        job = client.get_job(process_id, job_id)
        status = job["status"]
        if status in {"succeeded", "failed"}:
            validate_job(job, upload)
            print(
                "Job complete:"
                f" process={process_name}"
                f" file={upload.uploaded_file_name}"
                f" status={status}"
                f" detectedForm={job.get('detectedFormName') or job.get('detectedForm') or '—'}"
                f" unclassified={job.get('unclassified')}"
                f" violations={len(job.get('confidenceViolations') or [])}"
            )
            return job
        if time.monotonic() >= deadline:
            raise SeedError(
                f"Timed out waiting for job {job_id} ({upload.uploaded_file_name}) for {process_name}."
            )
        print(f"Waiting for job: process={process_name} file={upload.uploaded_file_name} status={status}")
        time.sleep(JOB_POLL_SECONDS)


def find_existing_job(client: SeedClient, process_id: str, upload: UploadSeed) -> dict[str, Any] | None:
    jobs = client.list_jobs(process_id, file_name=upload.uploaded_file_name)
    exact_matches = [job for job in jobs if job.get("fileName") == upload.uploaded_file_name]
    return exact_matches[0] if exact_matches else None


def ensure_seed_job(client: SeedClient, process: dict[str, Any], upload: UploadSeed) -> JobResult:
    existing = find_existing_job(client, process["id"], upload)
    if existing is not None:
        print(
            f"Job already exists, reusing: process={process['name']} file={upload.uploaded_file_name} job={existing['id']}"
        )
        job = wait_for_job_terminal_state(client, process["id"], process["name"], existing["id"], upload)
        return JobResult(action="existing", process_name=process["name"], upload=upload, job=job)

    response = client.trigger_upload(process["id"], upload)
    job_id = response["jobId"]
    print(f"Triggered upload: process={process['name']} file={upload.uploaded_file_name} job={job_id}")
    job = wait_for_job_terminal_state(client, process["id"], process["name"], job_id, upload)
    return JobResult(action="triggered", process_name=process["name"], upload=upload, job=job)


def print_summary(process_results: list[ProcessResult], job_results: list[JobResult]) -> None:
    print("\nSeed summary")
    print("============")
    print("Processes:")
    for result in process_results:
        process = result.process
        analyzer_names = ", ".join(analyzer["name"] for analyzer in process["allowedAnalyzers"])
        print(
            f"- [{result.action}] {process['name']} ({process['id']})"
            f" status={process['routingAnalyzerStatus']}"
            f" analyzers=[{analyzer_names}]"
        )

    print("Jobs:")
    for result in job_results:
        job = result.job
        detected = job.get("detectedFormName") or job.get("detectedForm") or "No matching form"
        print(
            f"- [{result.action}] {result.process_name} :: {result.upload.uploaded_file_name}"
            f" job={job['id']}"
            f" status={job['status']}"
            f" detected={detected}"
            f" unclassified={job.get('unclassified')}"
            f" violations={len(job.get('confidenceViolations') or [])}"
            f" reviewedAt={job.get('reviewedAt') or '—'}"
        )


def main() -> int:
    args = parse_args()
    ensure_seed_files_exist()

    client = SeedClient(args.api_base_url)
    process_results: list[ProcessResult] = []
    job_results: list[JobResult] = []
    try:
        ensure_api_reachable(client)
        for seed in SEED_PROCESSES:
            process_result = ensure_process(client, seed)
            ready_process = wait_for_process_ready(client, process_result.process["id"], seed.name)
            process_results.append(ProcessResult(action=process_result.action, process=ready_process))
            for upload in seed.uploads:
                job_results.append(ensure_seed_job(client, ready_process, upload))
    except SeedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()

    print_summary(process_results, job_results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
