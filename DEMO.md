# Enterprise IDP Demo Walkthrough

This walkthrough exercises the shipped UI and API end to end against the
local stack. It follows the real screen flow:
[`process-list`](docs/spec/screen/process-list.md) →
[`process-detail`](docs/spec/screen/process-detail.md) →
upload →
[`inference-review`](docs/spec/screen/inference-review.md) →
[`process-jobs`](docs/spec/screen/process-jobs.md).

## 1. Start the local stack

From the repo root:

```bash
docker compose up -d
cd apps/api
WEB_ORIGIN=http://127.0.0.1:3000 OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

In a second terminal:

```bash
cd /home/anirudh/Projects/cl-idp/apps/api
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 uv run python -m app.worker.main
```

In a third terminal:

```bash
cd /home/anirudh/Projects/cl-idp/apps/web
NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8000 npm run dev -- --hostname 127.0.0.1 --port 3000
```

Wait for:

- `docker compose ps` to show Azurite, Cosmos DB Emulator, Mailpit, and the
  `otel-collector` (Grafana LGTM stack) as healthy/running
- the API to report `Uvicorn running on http://127.0.0.1:8000`
- the web app to report `Ready` on `http://127.0.0.1:3000`

Logs, traces, and metrics from a full trigger→worker→success run are all
visible at <http://127.0.0.1:3001/> (Grafana, pre-wired to Loki/Tempo/
Prometheus) — search Loki by `correlation_id` to see every log line for a
job, then jump to its trace in Tempo via the same ID. When running the api/
worker as host processes (as above) rather than via the compose `app`
profile, set `OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318` so they
ship telemetry to the same collector.

A ready-made dashboard, **CL-IDP — Pipeline Observability**, is
auto-provisioned into the "CL-IDP" folder at
<http://127.0.0.1:3001/d/cl-idp-overview> (login `admin`/`admin`). It
covers: HTTP request rate/latency/error-rate for the API, worker job
throughput/duration/success-ratio, per-stage call volume and p95 latency
for the named pipeline spans (`trigger.request` → `queue.enqueue` →
`worker.dequeue` → `cu.analyze.submit`/`cu.analyze.poll` →
`job.persist`/`review.save`/`notify.email`), a live logs panel you can
filter by `correlation_id` via the dashboard's variable box, and a cost
row (see below). The dashboard JSON lives in
`infra/grafana/dashboards/cl-idp-overview.json` and is mounted into the
`otel-collector` container with `updateIntervalSeconds: 30`, so it
persists across `docker compose down`/`up` and hot-reloads within ~30s of
editing the file — no restart needed (edit the JSON directly, or export a
new version from the Grafana UI and copy it back).

### Status of a run, end to end

Every job (one "run" of one document) carries a `correlationId` that's
attached to every span and log line it produces, and every span also
carries `process_id`/`job_id` attributes, so you can follow one document
all the way through the pipeline:

- **In the app**: `GET /processes/{id}/jobs/{jobId}` (or the job's row/detail
  view in the web UI) shows its current `status`
  (`queued`/`running`/`succeeded`/`failed`), `error` if failed, and
  `confidenceViolations` if it needs review.
- **In Grafana**: use Tempo's search (`http://127.0.0.1:3001` → Explore →
  Tempo) with TraceQL `{span.process_id="<id>"}` to pull every trace for
  every job under one business process, or `{span.job_id="<id>"}` for a
  single run; then filter the logs panel by that job's `correlationId` to
  see every log line it produced, in order.

### Cost per document and per process

Every succeeded job carries an `estimatedCostUsd` (visible on
`GET /processes/{id}/jobs/{jobId}`, in the web UI's job table/detail view,
and rolled up as `totalEstimatedCostUsd` on
`GET /processes/{id}/jobs/summary`), computed from its page count using
published Azure AI Content Understanding per-page list pricing (see
`apps/api/app/pricing.py` — this is a best-effort estimate, not real Azure
billing data). The same figure is emitted as a `worker_job_cost_usd_total`
Prometheus counter, labeled by `process_id` and `detected_form`, so the
dashboard's "Cost" row shows total cost accrued, a cumulative-cost
timeseries, and a cost breakdown by business process and by document type.

## 2. Train custom analyzers and seed demo data

Train the custom analyzers once, then seed the three demo processes:

```bash
cd /home/anirudh/Projects/cl-idp/apps/api
uv run python scripts/train_custom_analyzers.py
uv run python scripts/seed_custom_analyzer_processes.py
```

Expected seeded surface (any older `Demo - *` processes are deleted
automatically so exactly these three remain):

- **Canada Life Group Benefits Administration**
  - analyzer: `group_benefits_application` (custom)
  - jobs: every file in `samples/group-benefits/` → succeeded, classified
    as Group Benefits Application, several flagged **Needs review**
- **Canada Life Drug Prior Authorization**
  - analyzers: `drug_prior_auth_glp1`, `canada_life_invoice` (both custom)
  - jobs: every file in `samples/drug-prior-authorization/` plus
    `samples/invoice/invoice.pdf` → succeeded, routed to whichever analyzer
    matches the document
- **Human in the loop verification Process**
  - analyzer: `cheque_verification` (custom)
  - jobs: every file in `samples/cheques/` → succeeded, classified as
    Cheque Verification

Optional idempotency check:

```bash
uv run python scripts/seed_custom_analyzer_processes.py
```

On the second run the script should report that those processes and jobs
already exist and are being reused, rather than crashing or creating
duplicates.

## 3. Open the app shell

Browse to <http://127.0.0.1:3000/>.

Expected shell state:

- left sidebar with **CL-IDP** branding, **New Process**, **Processes**,
  and **Settings**
- top bar title **Business Processes**
- disabled global search box, notifications button, help button, and avatar
- main content showing the
  [`process-list`](docs/spec/screen/process-list.md) screen with a
  **Business processes** heading

Expected seeded rows:

- `Canada Life Group Benefits Administration`
- `Canada Life Drug Prior Authorization`
- `Human in the loop verification Process`

## 4. Walk the seeded happy path from `process-list` to `process-detail`

Open **Canada Life Drug Prior Authorization**.

Expected
[`process-detail`](docs/spec/screen/process-detail.md) state:

- top bar title **Process Overview**
- process cards showing:
  - allowed analyzers: `Drug Prior Authorization (GLP-1)`, `Invoice`
  - routing analyzer status: **Ready**
  - confidence threshold: **70%**
  - business owner email
- right-side **Inference testing** upload panel with an enabled file picker
- right-side **History preview** table with seeded jobs; several rows
  show **Needs review**

## 5. Upload a fresh document from `process-detail`

In the **Inference testing** panel, upload:

```text
samples/invoice/invoice.pdf
```

You can keep the default filename or rename it while uploading; either is
fine.

Expected behavior:

- the upload panel shows an uploading/processing state
- after the job succeeds, the app auto-navigates to the
  [`inference-review`](docs/spec/screen/inference-review.md) screen for the
  new job

## 6. Review the job on `inference-review`

Expected review-screen shell state:

- top bar title **Inference Review**
- left pane titled **Source document**
- right pane titled **Human review**
- detected form shown as **Invoice**
- many low-confidence fields, each with confidence badges and **Approve**
  actions

> **Known issue:** the source document preview pane may show
> **Could not render document** /
> **The PDF viewer could not load this file. Try refreshing the page.**
> because of a separately tracked, deferred bug in dev mode. See
> [`docs/plan/19-fix-inference-review-document-viewer.md`](docs/plan/19-fix-inference-review-document-viewer.md).
> This does **not** affect the human review panel on the right; continue
> with the approve/edit/save steps below using the field list.

Approve at least one flagged field in the right pane:

- click an **Approve** button next to a low-confidence field
- confirm the field shows an **Approved** badge
- confirm **Save** becomes enabled

Then click **Save**.

Expected result:

- the review is persisted through `PUT /processes/{processId}/jobs/{jobId}/review`
- you return to the originating `process-detail` screen

## 7. Verify filtering on `process-jobs`

From the Drug Prior Authorization process detail screen, click
**View all jobs**.

Expected
[`process-jobs`](docs/spec/screen/process-jobs.md) state:

- top bar title **Process Jobs**
- summary cards for **Total jobs**, **Needs review**, **Failed**, and
  **Unclassified**
- a filter panel containing status, detected form, file name, reviewed,
  **Needs review only**, **Unclassified only**, and submitted-date controls

Run two quick filter checks:

1. **Reviewed upload you just saved**
   - set **Reviewed** to `Reviewed`
   - enter your uploaded filename into **File name**
   - expect one row for that job with status **Succeeded** and reviewed state
     **Reviewed**

2. **Seeded needs-review example**
   - clear **File name**
   - click **Needs review only**
   - expect rows for the seeded `glp1-m6453_synthetic.pdf` and `invoice.pdf`
     jobs with status **Succeeded** and reviewed state **Not reviewed**

Use **Clear filters** to return to the full job history.

## 8. Demo complete

At this point you have verified:

- seeded processes are visible on `process-list`
- a seeded process is ready on `process-detail`
- upload → poll → auto-navigation works
- the right-hand review flow works even with the known left-pane viewer bug
- saved review state is visible through `process-jobs` filters
