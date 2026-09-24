"""Seed the live API with the real Canada Life demo business processes.

This is the single source of truth for local/dev seed data: it creates the
three trained-custom-analyzer business processes below, uploads *every*
sample file under each process's `samples/` directory, waits for each job to
reach a terminal state, and leaves exactly one reviewed field per process.
Any stale/legacy demo processes from older iterations of this script (see
`LEGACY_PROCESS_NAMES`) are deleted on every run, so this is safe and
idempotent to re-run on every `docker compose --profile app up`.

This module also exposes the reusable HTTP-seeding primitives
(`SeedClient`, `ProcessSeed`, `ensure_process`, `wait_for_process_ready`,
etc.) imported by `scripts/train_custom_analyzers.py` and
`scripts/run_cost_demo.py`.
"""

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


def resolve_repo_root() -> Path:
    """Find the repo root by walking up from this script's own path.

    Works whether the script runs from a host checkout (where parent
    directory depth matches the repo layout) or inside a container built
    from apps/api/Dockerfile (WORKDIR /app has no docker-compose.yml above
    it), in which case callers are expected to rely on a samples/ bind
    mount instead of the baked-in image copy.
    """
    for candidate in Path(__file__).resolve().parents:
        if (candidate / "docker-compose.yml").exists() and (candidate / "apps").exists():
            return candidate
    return API_ROOT


REPO_ROOT = resolve_repo_root()
SAMPLES_ROOT = REPO_ROOT / "samples"
DEFAULT_API_BASE_URL = os.environ.get("CL_IDP_API_BASE_URL", "http://127.0.0.1:8000")
PROCESS_READY_TIMEOUT_SECONDS = 10 * 60
JOB_READY_TIMEOUT_SECONDS = 10 * 60
PROCESS_POLL_SECONDS = 5
JOB_POLL_SECONDS = 2


@dataclass(frozen=True)
class ProcessSeed:
    name: str
    description: str
    allowed_analyzer_ids: tuple[str, ...]
    confidence_threshold: float
    owner_email: str


@dataclass(frozen=True)
class ProcessResult:
    action: Literal["created", "existing"]
    process: dict[str, Any]


@dataclass(frozen=True)
class ProcessScenario:
    name: str
    description: str
    allowed_analyzer_ids: tuple[str, ...]
    confidence_threshold: float
    owner_email: str
    sample_dirs: tuple[Path, ...]


@dataclass(frozen=True)
class SampleResult:
    file_name: str
    process_name: str
    process_id: str
    job_id: str
    status: str
    detected_form: str | None
    unclassified: bool
    confidence_violations: int
    reviewed_path: str | None
    reviewed_at: str | None
    pages_present: bool
    grounded_fields_present: bool


SCENARIOS: tuple[ProcessScenario, ...] = (
    ProcessScenario(
        name="Canada Life Group Benefits Administration",
        description="Canada Life group benefits application intake routed only to the trained group benefits analyzer.",
        allowed_analyzer_ids=("group_benefits_application",),
        confidence_threshold=0.7,
        owner_email="group-benefits-owner@example.com",
        sample_dirs=(SAMPLES_ROOT / "group-benefits",),
    ),
    ProcessScenario(
        name="Canada Life Drug Prior Authorization",
        description=(
            "Canada Life GLP-1 drug prior authorization intake, also accepting vendor invoices "
            "for related billing, routed to the trained drug prior authorization and invoice analyzers."
        ),
        allowed_analyzer_ids=("drug_prior_auth_glp1", "canada_life_invoice"),
        confidence_threshold=0.7,
        owner_email="drug-prior-auth-owner@example.com",
        sample_dirs=(SAMPLES_ROOT / "drug-prior-authorization", SAMPLES_ROOT / "invoice"),
    ),
    ProcessScenario(
        name="Human in the loop verification Process",
        description="Cheque intake requiring human verification before processing, routed to the trained cheque analyzer.",
        allowed_analyzer_ids=("cheque_verification",),
        confidence_threshold=0.7,
        owner_email="cheque-verification-owner@example.com",
        sample_dirs=(SAMPLES_ROOT / "cheques",),
    ),
)

# Process names seeded by older iterations of this demo. Removed on every run so that
# the live stack always ends up with exactly the SCENARIOS above.
LEGACY_PROCESS_NAMES: tuple[str, ...] = (
    "Demo - Accounts Payable",
    "Demo - General Document Intake",
    "Drug Prior Authorization (GLP-1)",
    "Group Benefits Application",
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
    parser = argparse.ArgumentParser(
        description="Create and verify the Canada Life custom-analyzer business processes via the live HTTP API."
    )
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


def ensure_sample_files_exist() -> None:
    missing_dirs = [
        str(sample_dir)
        for scenario in SCENARIOS
        for sample_dir in scenario.sample_dirs
        if not sample_dir.is_dir()
    ]
    if missing_dirs:
        raise SeedError("Missing sample directories:\n - " + "\n - ".join(missing_dirs))

    missing_files = [str(path) for scenario in SCENARIOS for path in list_sample_files(scenario) if not path.exists()]
    if missing_files:
        raise SeedError("Missing sample files:\n - " + "\n - ".join(missing_files))


def list_sample_files(scenario: ProcessScenario) -> list[Path]:
    return sorted(
        path
        for sample_dir in scenario.sample_dirs
        for path in sample_dir.iterdir()
        if path.is_file()
    )


def validate_process_configuration(process: dict[str, Any], scenario: ProcessScenario) -> None:
    expected = (
        scenario.description,
        list(scenario.allowed_analyzer_ids),
        scenario.confidence_threshold,
        scenario.owner_email.lower(),
    )
    actual = (
        str(process["description"]),
        list(process["allowedAnalyzerIds"]),
        float(process["confidenceThreshold"]),
        str(process["ownerEmail"]).lower(),
    )
    if actual != expected:
        raise SeedError(
            "Existing process matched by name but does not match the expected configuration: "
            f"{scenario.name} (id={process['id']}). Delete or rename it, then re-run."
        )


def wait_for_scenario_job_terminal_state(client: SeedClient, process_id: str, job_id: str, label: str) -> dict[str, Any]:
    deadline = time.monotonic() + JOB_READY_TIMEOUT_SECONDS
    while True:
        job = client.get_job(process_id, job_id)
        status = str(job["status"])
        if status in {"succeeded", "failed"}:
            return job
        if time.monotonic() >= deadline:
            raise SeedError(f"Timed out waiting for {label} (job={job_id}) to reach a terminal status.")
        print(f"Waiting for job: {label} status={status}")
        time.sleep(JOB_POLL_SECONDS)


def find_existing_job(client: SeedClient, process_id: str, file_name: str) -> dict[str, Any] | None:
    jobs = client.list_jobs(process_id, file_name=file_name)
    exact_matches = [job for job in jobs if job.get("fileName") == file_name]
    if not exact_matches:
        return None
    return max(exact_matches, key=lambda item: str(item.get("submittedAt") or ""))


def trigger_or_reuse_job(
    client: SeedClient,
    process: dict[str, Any],
    scenario: ProcessScenario,
    sample_path: Path,
) -> dict[str, Any]:
    existing = find_existing_job(client, process["id"], sample_path.name)
    if existing is not None:
        print(
            f"Job already exists, reusing: process={scenario.name} file={sample_path.name} job={existing['id']}"
        )
        return wait_for_scenario_job_terminal_state(
            client,
            process["id"],
            existing["id"],
            f"{scenario.name} :: {sample_path.name}",
        )

    with sample_path.open("rb") as file_handle:
        response = client.require_success(
            "POST",
            f"/processes/{process['id']}/trigger",
            expected_status=202,
            files={"file": (sample_path.name, file_handle, "application/pdf")},
        )

    job_id = response["jobId"]
    print(f"Triggered upload: process={scenario.name} file={sample_path.name} job={job_id}")
    return wait_for_scenario_job_terminal_state(
        client,
        process["id"],
        job_id,
        f"{scenario.name} :: {sample_path.name}",
    )


def is_leaf_field(field: dict[str, Any]) -> bool:
    return field.get("type") in {"string", "date", "time", "number", "integer", "boolean"}


def iter_leaf_fields(fields: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not fields:
        return []

    result: list[dict[str, Any]] = []

    def visit(node: dict[str, Any]) -> None:
        if is_leaf_field(node):
            result.append(node)
            return
        if node.get("type") == "object":
            for child in (node.get("properties") or {}).values():
                if isinstance(child, dict):
                    visit(child)
            return
        if node.get("type") == "array":
            for child in node.get("items") or []:
                if isinstance(child, dict):
                    visit(child)

    for field in fields:
        visit(field)
    return result


def stringify_field_value(field: dict[str, Any]) -> str | None:
    if field.get("reviewedValue"):
        return str(field["reviewedValue"])
    value = field.get("value")
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def review_one_field(client: SeedClient, process_id: str, job: dict[str, Any]) -> tuple[str | None, str | None]:
    leaf_fields = iter_leaf_fields(job.get("fields"))
    if not leaf_fields:
        return None, None

    violation_paths = {
        path for path in (job.get("confidenceViolations") or []) if isinstance(path, str)
    }
    candidate = next(
        (
            field
            for field in leaf_fields
            if field.get("path") in violation_paths and stringify_field_value(field) is not None
        ),
        None,
    )
    if candidate is None:
        candidate = next((field for field in leaf_fields if stringify_field_value(field) is not None), None)
    if candidate is None:
        return None, None

    reviewed_path = str(candidate["path"])
    reviewed_value = stringify_field_value(candidate)
    if reviewed_value is None:
        return None, None

    reviewed_job = client.require_success(
        "PUT",
        f"/processes/{process_id}/jobs/{job['id']}/review",
        json={"fields": [{"path": reviewed_path, "value": reviewed_value}]},
    )
    if reviewed_job.get("reviewedAt") is None:
        raise SeedError(f"Review API returned no reviewedAt for job {job['id']}.")
    print(
        f"Reviewed field: process={process_id} job={job['id']} path={reviewed_path}"
        f" remainingViolations={len(reviewed_job.get('confidenceViolations') or [])}"
    )
    return reviewed_path, str(reviewed_job["reviewedAt"])


def get_existing_review_marker(job: dict[str, Any]) -> tuple[str | None, str | None]:
    reviewed_at = job.get("reviewedAt")
    if reviewed_at is None:
        return None, None

    for field in iter_leaf_fields(job.get("fields")):
        if field.get("reviewedValue") is not None:
            return str(field["path"]), str(reviewed_at)

    return None, str(reviewed_at)


def validate_completed_job(job: dict[str, Any], scenario: ProcessScenario, sample_path: Path) -> None:
    if job["status"] != "succeeded":
        raise SeedError(
            f"{scenario.name} sample {sample_path.name} finished as {job['status']}: {job.get('error')}"
        )
    if job.get("detectedForm") not in scenario.allowed_analyzer_ids:
        raise SeedError(
            f"{scenario.name} sample {sample_path.name} detected {job.get('detectedForm')!r}, "
            f"expected one of {scenario.allowed_analyzer_ids!r}."
        )
    if bool(job.get("unclassified")):
        raise SeedError(f"{scenario.name} sample {sample_path.name} unexpectedly ended unclassified.")


def summarize_job(
    scenario: ProcessScenario,
    process: dict[str, Any],
    sample_path: Path,
    job: dict[str, Any],
    reviewed_path: str | None,
    reviewed_at: str | None,
) -> SampleResult:
    leaf_fields = iter_leaf_fields(job.get("fields"))
    grounded_fields_present = any(
        field.get("boundingBox") is not None and field.get("page") is not None for field in leaf_fields
    )
    return SampleResult(
        file_name=sample_path.name,
        process_name=scenario.name,
        process_id=str(process["id"]),
        job_id=str(job["id"]),
        status=str(job["status"]),
        detected_form=job.get("detectedForm"),
        unclassified=bool(job.get("unclassified")),
        confidence_violations=len(job.get("confidenceViolations") or []),
        reviewed_path=reviewed_path,
        reviewed_at=reviewed_at,
        pages_present=bool(job.get("pages")),
        grounded_fields_present=grounded_fields_present,
    )


def print_summary(results: list[SampleResult]) -> None:
    headers = ("file", "process", "job status", "unclassified", "confidence violations")
    rows = [
        (
            result.file_name,
            result.process_name,
            result.status,
            "yes" if result.unclassified else "no",
            str(result.confidence_violations),
        )
        for result in results
    ]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in rows))
        for index in range(len(headers))
    ]

    print("\nJob summary")
    print("===========")
    header_line = " | ".join(headers[index].ljust(widths[index]) for index in range(len(headers)))
    separator_line = "-+-".join("-" * widths[index] for index in range(len(headers)))
    print(header_line)
    print(separator_line)
    for row in rows:
        print(" | ".join(row[index].ljust(widths[index]) for index in range(len(headers))))

    print("\nReview verification")
    print("===================")
    for result in results:
        print(
            f"- {result.process_name} :: {result.file_name}"
            f" job={result.job_id}"
            f" detected={result.detected_form or '—'}"
            f" pagesPresent={result.pages_present}"
            f" groundedFieldsPresent={result.grounded_fields_present}"
            f" reviewedPath={result.reviewed_path or '—'}"
            f" reviewedAt={result.reviewed_at or '—'}"
        )


def delete_legacy_processes(client: SeedClient) -> None:
    scenario_names = {scenario.name.lower() for scenario in SCENARIOS}
    legacy_names = {name.lower() for name in LEGACY_PROCESS_NAMES}
    for process in client.list_processes():
        name = str(process["name"])
        if name.lower() in scenario_names:
            continue
        if name.lower() not in legacy_names:
            continue
        client.require_success("DELETE", f"/processes/{process['id']}", expected_status=204)
        print(f"Deleted legacy process: {name} ({process['id']})")


def main() -> int:
    args = parse_args()
    ensure_sample_files_exist()

    client = SeedClient(args.api_base_url)
    sample_results: list[SampleResult] = []
    try:
        ensure_api_reachable(client)
        delete_legacy_processes(client)
        for scenario in SCENARIOS:
            process_result = ensure_process(
                client,
                seed=ProcessSeed(
                    name=scenario.name,
                    description=scenario.description,
                    allowed_analyzer_ids=scenario.allowed_analyzer_ids,
                    confidence_threshold=scenario.confidence_threshold,
                    owner_email=scenario.owner_email,
                ),
            )
            validate_process_configuration(process_result.process, scenario)
            ready_process = wait_for_process_ready(client, process_result.process["id"], scenario.name)
            review_completed = False
            for sample_path in list_sample_files(scenario):
                job = trigger_or_reuse_job(client, ready_process, scenario, sample_path)
                validate_completed_job(job, scenario, sample_path)

                reviewed_path: str | None = None
                reviewed_at: str | None = None
                if not review_completed:
                    reviewed_path, reviewed_at = get_existing_review_marker(job)
                    if reviewed_at is not None:
                        review_completed = True
                    else:
                        reviewed_path, reviewed_at = review_one_field(client, ready_process["id"], job)
                        review_completed = reviewed_path is not None
                        if review_completed:
                            job = client.get_job(ready_process["id"], job["id"])

                sample_results.append(
                    summarize_job(
                        scenario,
                        ready_process,
                        sample_path,
                        job,
                        reviewed_path,
                        reviewed_at,
                    )
                )
    except SeedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()

    print_summary(sample_results)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
