"""Trigger a batch of random invoice/cheque uploads through a dedicated demo
business process, then report the estimated Azure AI Content Understanding
cost incurred (per document and for the whole batch).

This deliberately creates real jobs against the live API (which in turn
calls the real Content Understanding service), so it incurs a small real
cost — see `app.pricing` for the per-page rate assumptions used to estimate
it. Re-running adds another batch of jobs to the same process rather than
replacing the previous one, so the process's cost total keeps growing.

Usage (from apps/api, with the compose stack's `app` profile running):

    uv run python scripts/run_cost_demo.py --count 100
"""

from __future__ import annotations

import argparse
import random
import sys
import time
from collections import Counter, defaultdict
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

PROCESS_NAME = "Cost Demo — Invoices & Cheques"
PROCESS_DESCRIPTION = (
    "Synthetic-volume demo process mixing random invoices and cheques, used to exercise "
    "per-document and per-process cost tracking (see Job.estimatedCostUsd / "
    "JobsSummary.totalEstimatedCostUsd, and the Grafana 'Cost' dashboard row)."
)
OWNER_EMAIL = "cost-demo-owner@example.com"
CONFIDENCE_THRESHOLD = 0.7
ALLOWED_ANALYZER_IDS = ("canada_life_invoice", "cheque_verification")

# Only a handful of real sample files ship with this repo, so a 100-document
# batch necessarily replays the same few files under distinct upload names —
# each upload still becomes its own distinct job/blob/trace, exercising the
# pipeline and cost accounting exactly as a real batch of 100 documents would.
CANDIDATE_SAMPLES: tuple[Path, ...] = (
    SAMPLES_ROOT / "invoice.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-01.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-02.pdf",
    SAMPLES_ROOT / "cheques" / "sample-cheque-03.pdf",
)

JOB_POLL_SECONDS = 3
JOB_READY_TIMEOUT_SECONDS = 45 * 60


@dataclass(frozen=True)
class TriggeredJob:
    job_id: str
    file_name: str
    sample: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Trigger a batch of random invoice/cheque uploads through a dedicated "
            "cost-demo business process, then report estimated cost."
        )
    )
    parser.add_argument("--count", type=int, default=100, help="Number of documents to upload (default: 100).")
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


def ensure_sample_files_exist() -> None:
    missing = [str(path) for path in CANDIDATE_SAMPLES if not path.exists()]
    if missing:
        raise SeedError("Missing sample files:\n - " + "\n - ".join(missing))


def ensure_demo_process(client: SeedClient) -> dict[str, Any]:
    process_result = ensure_process(
        client,
        seed=ProcessSeed(
            name=PROCESS_NAME,
            description=PROCESS_DESCRIPTION,
            allowed_analyzer_ids=ALLOWED_ANALYZER_IDS,
            confidence_threshold=CONFIDENCE_THRESHOLD,
            owner_email=OWNER_EMAIL,
        ),
    )
    return wait_for_process_ready(client, process_result.process["id"], PROCESS_NAME)


def trigger_batch(client: SeedClient, process_id: str, count: int, rng: random.Random) -> list[TriggeredJob]:
    triggered: list[TriggeredJob] = []
    for index in range(1, count + 1):
        sample = rng.choice(CANDIDATE_SAMPLES)
        file_name = f"{sample.stem}-{index:03d}{sample.suffix}"
        content_type = guess_content_type(file_name)
        with sample.open("rb") as file_handle:
            response = client.require_success(
                "POST",
                f"/processes/{process_id}/trigger",
                expected_status=202,
                files={"file": (file_name, file_handle, content_type)},
            )
        job_id = str(response["jobId"])
        triggered.append(TriggeredJob(job_id=job_id, file_name=file_name, sample=sample))
        print(f"[{index}/{count}] Triggered {file_name} -> job {job_id}")
    return triggered


def wait_for_batch_terminal(client: SeedClient, process_id: str, triggered: list[TriggeredJob]) -> list[dict[str, Any]]:
    pending = {job.job_id: job for job in triggered}
    completed: dict[str, dict[str, Any]] = {}
    deadline = time.monotonic() + JOB_READY_TIMEOUT_SECONDS
    while pending:
        for job_id in list(pending):
            job = client.get_job(process_id, job_id)
            if job["status"] in {"succeeded", "failed"}:
                completed[job_id] = job
                del pending[job_id]
        if pending:
            if time.monotonic() >= deadline:
                raise SeedError(
                    f"Timed out waiting for {len(pending)} job(s) to reach a terminal status: "
                    f"{sorted(pending)}"
                )
            print(f"Waiting for {len(pending)} of {len(triggered)} jobs to finish...")
            time.sleep(JOB_POLL_SECONDS)
    # Preserve trigger order for readable output.
    return [completed[job.job_id] for job in triggered]


def print_report(process: dict[str, Any], jobs: list[dict[str, Any]]) -> None:
    status_counts = Counter(str(job["status"]) for job in jobs)
    cost_by_form: dict[str, float] = defaultdict(float)
    count_by_form: dict[str, int] = defaultdict(int)
    total_cost = 0.0
    total_pages = 0
    failures: list[dict[str, Any]] = []

    for job in jobs:
        cost = float(job.get("estimatedCostUsd") or 0.0)
        total_cost += cost
        total_pages += len(job.get("pages") or [])
        form = job.get("detectedForm") or ("unclassified" if job.get("unclassified") else "—")
        cost_by_form[form] += cost
        count_by_form[form] += 1
        if job["status"] == "failed":
            failures.append(job)

    print("\nCost demo report")
    print("=================")
    print(f"Process: {process['name']} ({process['id']})")
    print(f"Documents submitted: {len(jobs)}")
    print(f"Status breakdown: {dict(status_counts)}")
    print(f"Total pages analyzed: {total_pages}")
    print(f"Total estimated cost: ${total_cost:.4f} USD")
    print()
    print("Cost by document type (detectedForm)")
    print("-------------------------------------")
    for form in sorted(cost_by_form, key=lambda key: -cost_by_form[key]):
        count = count_by_form[form]
        cost = cost_by_form[form]
        print(f"  {form:<28} count={count:<4} cost=${cost:.4f}  avg/doc=${cost / count:.4f}")

    if failures:
        print("\nFailed jobs")
        print("-----------")
        for job in failures:
            print(f"  job={job['id']} file={job['fileName']} error={job.get('error')}")

    print(
        "\nView live: totalEstimatedCostUsd from "
        f"GET /processes/{process['id']}/jobs/summary, or the Grafana 'Cost' "
        "dashboard row filtered/grouped by this process_id."
    )


def main() -> int:
    args = parse_args()
    ensure_sample_files_exist()
    if args.count <= 0:
        print("ERROR: --count must be a positive integer.", file=sys.stderr)
        return 1

    rng = random.Random(args.seed)
    client = SeedClient(args.api_base_url)
    try:
        ensure_api_reachable(client)
        process = ensure_demo_process(client)
        triggered = trigger_batch(client, process["id"], args.count, rng)
        jobs = wait_for_batch_terminal(client, process["id"], triggered)
    except SeedError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()

    print_report(process, jobs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
