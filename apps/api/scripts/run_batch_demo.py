"""Simulate a bulk batch of documents arriving all at once and show the
pipeline draining them concurrently.

Unlike `scripts/run_cost_demo.py` (which submits documents one at a time,
sequentially, mainly to demonstrate cost accounting), this script fires a
configurable number of `/processes/{id}/trigger` requests *concurrently* --
as if a batch of documents had just landed in bulk -- then polls until every
job reaches a terminal state and reports submission throughput, queue-drain
time, and end-to-end per-job latency percentiles.

The document mix is fully configurable via `--samples`, so any load type can
be simulated from the files already shipped under `samples/` (or any other
file/directory/glob you point it at):

    # Default built-in invoice/cheque mix, 50 documents, 10 in flight at once
    uv run python scripts/run_batch_demo.py --count 50 --concurrency 10

    # A pure cheque-processing burst
    uv run python scripts/run_batch_demo.py --samples samples/cheques --count 200 --concurrency 25

    # A mixed load across every business-process sample directory
    uv run python scripts/run_batch_demo.py \\
        --samples samples/cheques samples/invoice samples/drug-prior-authorization samples/group-benefits \\
        --count 300 --concurrency 40

    # One specific file, hammered to stress a single document type
    uv run python scripts/run_batch_demo.py --samples samples/receipt.pdf --count 100
"""

from __future__ import annotations

import argparse
import random
import statistics
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from seed import (
    DEFAULT_API_BASE_URL,
    ProcessSeed,
    SeedClient,
    SeedError,
    ensure_api_reachable,
    ensure_process,
    guess_content_type,
    wait_for_process_ready,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SAMPLES_ROOT = REPO_ROOT / "samples"

PROCESS_NAME = "Batch Arrival Demo — Bulk Load"
PROCESS_DESCRIPTION = (
    "Synthetic bulk-arrival demo process used to show the pipeline accepting and draining "
    "a burst of documents submitted concurrently, as a real batch upload would."
)
OWNER_EMAIL = "batch-demo-owner@example.com"
CONFIDENCE_THRESHOLD = 0.7

# Every trained demo analyzer, so an arbitrary mix of samples (any load type)
# routes correctly regardless of which business-process directory it came
# from. Narrow this with --allowed-analyzer-id if you want unmatched samples
# to be flagged unclassified on purpose.
ALL_ANALYZER_IDS: tuple[str, ...] = (
    "canada_life_invoice",
    "cheque_verification",
    "drug_prior_auth_glp1",
    "group_benefits_application",
)

# Only used when --samples isn't provided.
DEFAULT_SAMPLES: tuple[Path, ...] = (
    SAMPLES_ROOT / "invoice.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-01.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-02.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-03.pdf",
)

SUPPORTED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".tif", ".tiff"}

JOB_POLL_SECONDS = 3
JOB_READY_TIMEOUT_SECONDS = 45 * 60


@dataclass(frozen=True)
class TriggeredJob:
    job_id: str
    file_name: str
    sample: Path
    triggered_at: float


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Fire a burst of concurrent document uploads at a dedicated batch-demo business "
            "process, then report submission and drain throughput."
        )
    )
    parser.add_argument("--count", type=int, default=50, help="Number of documents in the batch (default: 50).")
    parser.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Number of trigger requests to fire in flight at once (default: 10).",
    )
    parser.add_argument(
        "--samples",
        nargs="+",
        default=None,
        metavar="PATH",
        help=(
            "One or more sample files, directories, or glob patterns to draw the batch from "
            "(relative to the repo root unless absolute). Directories are scanned recursively "
            "for PDF/PNG/JPG/TIFF files. Repeat/combine to build any load mix, e.g. "
            "'--samples samples/cheques samples/invoice'. Defaults to a small built-in "
            "invoice/cheque mix."
        ),
    )
    parser.add_argument(
        "--allowed-analyzer-id",
        dest="allowed_analyzer_ids",
        nargs="+",
        default=None,
        metavar="ANALYZER_ID",
        help=(
            "Analyzer id(s) the demo process should route to (default: all four trained demo "
            "analyzers, so any provided sample type routes correctly)."
        ),
    )
    parser.add_argument(
        "--api-base-url",
        default=DEFAULT_API_BASE_URL,
        help=f"FastAPI base URL (default: {DEFAULT_API_BASE_URL})",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for reproducible sample selection (default: nondeterministic).",
    )
    return parser.parse_args()


def resolve_samples(patterns: list[str]) -> tuple[Path, ...]:
    """Turn user-provided --samples entries into a concrete list of files.

    Each entry may be an existing file, an existing directory (scanned
    recursively for supported extensions), or a glob pattern resolved
    relative to the repo root.
    """
    resolved: list[Path] = []
    for pattern in patterns:
        raw_path = Path(pattern)
        candidate = raw_path if raw_path.is_absolute() else (REPO_ROOT / raw_path)
        if candidate.is_dir():
            matches = sorted(
                path
                for path in candidate.rglob("*")
                if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
            )
            if not matches:
                raise SeedError(f"No supported sample files found under directory: {candidate}")
            resolved.extend(matches)
        elif candidate.is_file():
            resolved.append(candidate)
        else:
            matches = sorted(path for path in REPO_ROOT.glob(pattern) if path.is_file())
            if not matches:
                raise SeedError(f"--samples entry matched no files: {pattern!r}")
            resolved.extend(matches)

    unsupported = sorted({str(path) for path in resolved if path.suffix.lower() not in SUPPORTED_EXTENSIONS})
    if unsupported:
        raise SeedError("Unsupported sample file type(s):\n - " + "\n - ".join(unsupported))

    return tuple(resolved)


def ensure_samples_exist(samples: tuple[Path, ...]) -> None:
    missing = [str(path) for path in samples if not path.exists()]
    if missing:
        raise SeedError("Missing sample files:\n - " + "\n - ".join(missing))


def ensure_demo_process(client: SeedClient, allowed_analyzer_ids: tuple[str, ...]) -> dict[str, Any]:
    process_result = ensure_process(
        client,
        seed=ProcessSeed(
            name=PROCESS_NAME,
            description=PROCESS_DESCRIPTION,
            allowed_analyzer_ids=allowed_analyzer_ids,
            confidence_threshold=CONFIDENCE_THRESHOLD,
            owner_email=OWNER_EMAIL,
        ),
    )
    return wait_for_process_ready(client, process_result.process["id"], PROCESS_NAME)


def trigger_one(client: SeedClient, process_id: str, index: int, sample: Path) -> TriggeredJob:
    file_name = f"{sample.stem}-batch-{index:04d}{sample.suffix}"
    content_type = guess_content_type(file_name)
    with sample.open("rb") as file_handle:
        response = client.require_success(
            "POST",
            f"/processes/{process_id}/trigger",
            expected_status=202,
            files={"file": (file_name, file_handle, content_type)},
        )
    return TriggeredJob(
        job_id=str(response["jobId"]),
        file_name=file_name,
        sample=sample,
        triggered_at=time.monotonic(),
    )


def trigger_batch_concurrently(
    client: SeedClient,
    process_id: str,
    count: int,
    concurrency: int,
    samples: tuple[Path, ...],
    rng: random.Random,
) -> tuple[list[TriggeredJob], float]:
    """Fire `count` trigger requests using up to `concurrency` in-flight at once.

    This is the "bulk arrival" simulation: rather than waiting for one
    upload to finish before starting the next, many requests race the API
    at the same time, mimicking a real batch landing all together.
    """
    chosen_samples = [rng.choice(samples) for _ in range(count)]
    triggered: list[TriggeredJob] = []
    burst_start = time.monotonic()
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = [
            pool.submit(trigger_one, client, process_id, index, sample)
            for index, sample in enumerate(chosen_samples, start=1)
        ]
        for completed, future in enumerate(as_completed(futures), start=1):
            job = future.result()
            triggered.append(job)
            print(f"[{completed}/{count}] Accepted {job.file_name} -> job {job.job_id}")
    burst_duration = time.monotonic() - burst_start
    return triggered, burst_duration


def wait_for_batch_terminal(
    client: SeedClient, process_id: str, triggered: list[TriggeredJob]
) -> dict[str, tuple[dict[str, Any], float]]:
    """Poll every triggered job until it reaches a terminal status.

    Returns each job's API response paired with the local monotonic
    timestamp at which it was first observed terminal, so per-job latency
    can be measured against `TriggeredJob.triggered_at` without relying on
    server clock timestamps.
    """
    pending = {job.job_id: job for job in triggered}
    completed: dict[str, tuple[dict[str, Any], float]] = {}
    deadline = time.monotonic() + JOB_READY_TIMEOUT_SECONDS
    while pending:
        for job_id in list(pending):
            job = client.get_job(process_id, job_id)
            if job["status"] in {"succeeded", "failed"}:
                completed[job_id] = (job, time.monotonic())
                del pending[job_id]
        if pending:
            if time.monotonic() >= deadline:
                raise SeedError(
                    f"Timed out waiting for {len(pending)} job(s) to reach a terminal status: "
                    f"{sorted(pending)}"
                )
            print(f"Draining... {len(completed)}/{len(triggered)} jobs finished so far.")
            time.sleep(JOB_POLL_SECONDS)
    return completed


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, round(pct / 100 * (len(ordered) - 1))))
    return ordered[index]


def print_report(
    process: dict[str, Any],
    samples: tuple[Path, ...],
    triggered: list[TriggeredJob],
    completed: dict[str, tuple[dict[str, Any], float]],
    burst_duration: float,
    drain_duration: float,
) -> None:
    status_counts = Counter(completed[job.job_id][0]["status"] for job in triggered)
    mix_counts = Counter(job.sample.name for job in triggered)
    latencies = [completed[job.job_id][1] - job.triggered_at for job in triggered]

    submitted_count = len(triggered)
    throughput_submitted_per_sec = submitted_count / burst_duration if burst_duration > 0 else 0.0
    throughput_drained_per_sec = submitted_count / drain_duration if drain_duration > 0 else 0.0

    print("\nBatch arrival demo report")
    print("=========================")
    print(f"Process: {process['name']} ({process['id']})")
    print(f"Batch size: {submitted_count} documents")
    print(f"Sample files used: {len(samples)}")
    print("Load mix (by source sample file)")
    print("---------------------------------")
    for name in sorted(mix_counts, key=lambda key: -mix_counts[key]):
        print(f"  {name:<45} count={mix_counts[name]}")
    print(f"\nStatus breakdown: {dict(status_counts)}")
    print()
    print("Submission burst (simulating bulk arrival)")
    print("-------------------------------------------")
    print(f"  Wall time to submit all {submitted_count} requests: {burst_duration:.2f}s")
    print(f"  Submission throughput: {throughput_submitted_per_sec:.1f} requests/sec")
    print()
    print("Queue drain (pipeline processing the burst)")
    print("--------------------------------------------")
    print(f"  Wall time until every job reached a terminal state: {drain_duration:.2f}s")
    print(f"  Effective drain throughput: {throughput_drained_per_sec:.1f} jobs/sec")
    print()
    print("Per-job end-to-end latency (trigger accepted -> terminal status observed)")
    print("---------------------------------------------------------------------------")
    print(f"  min={min(latencies):.2f}s  mean={statistics.mean(latencies):.2f}s  max={max(latencies):.2f}s")
    print(
        f"  p50={percentile(latencies, 50):.2f}s  p90={percentile(latencies, 90):.2f}s  "
        f"p99={percentile(latencies, 99):.2f}s"
    )

    failures = [completed[job.job_id][0] for job in triggered if completed[job.job_id][0]["status"] == "failed"]
    if failures:
        print("\nFailed jobs")
        print("-----------")
        for job in failures:
            print(f"  job={job['id']} file={job['fileName']} error={job.get('error')}")

    print(
        "\nView live: GET /processes/"
        f"{process['id']}/jobs/summary for aggregate counts, or the Grafana "
        "'Operations' dashboard's job-volume panels filtered by this process_id."
    )


def main() -> int:
    args = parse_args()
    if args.count <= 0:
        print("ERROR: --count must be a positive integer.", file=sys.stderr)
        return 1
    if args.concurrency <= 0:
        print("ERROR: --concurrency must be a positive integer.", file=sys.stderr)
        return 1

    try:
        samples = resolve_samples(args.samples) if args.samples else DEFAULT_SAMPLES
        ensure_samples_exist(samples)
    except SeedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    allowed_analyzer_ids = tuple(args.allowed_analyzer_ids) if args.allowed_analyzer_ids else ALL_ANALYZER_IDS

    rng = random.Random(args.seed)
    client = SeedClient(args.api_base_url)
    try:
        ensure_api_reachable(client)
        process = ensure_demo_process(client, allowed_analyzer_ids)
        print(
            f"\nSimulating a bulk arrival of {args.count} documents drawn from "
            f"{len(samples)} sample file(s) (up to {args.concurrency} in flight at once)...\n"
        )
        triggered, burst_duration = trigger_batch_concurrently(
            client, process["id"], args.count, args.concurrency, samples, rng
        )
        drain_start = time.monotonic()
        completed = wait_for_batch_terminal(client, process["id"], triggered)
        drain_duration = time.monotonic() - drain_start
    except SeedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()

    print_report(process, samples, triggered, completed, burst_duration, drain_duration)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
