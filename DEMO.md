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

Two ready-made dashboards are auto-provisioned into the "CL-IDP" folder
(login `admin`/`admin`):

- **CL-IDP — Operations** — <http://127.0.0.1:3001/d/cl-idp-ops> — HTTP
  request rate/latency/error-rate for the API; worker throughput, duration,
  and success ratio; **form processing volumes** (triggered, succeeded,
  failed, needs-review, reviewed, unclassified) both as totals and broken
  down per business process; **average/p95 processing time per business
  process × form type**; per-stage call volume and p95 latency for the
  named pipeline spans (`trigger.request` → `queue.enqueue` →
  `worker.dequeue` → `cu.analyze.submit`/`cu.analyze.poll` →
  `job.persist`/`review.save`/`notify.email`); a **notifications** row
  (emails sent/failed, top recipients); a live Tempo traces panel and a
  live Loki logs panel, both filterable via the dashboard's
  `process_id`/`correlation_id` variables.
- **CL-IDP — FinOps** — <http://127.0.0.1:3001/d/cl-idp-finops> — total
  and cumulative estimated cost, burn rate, and a naive linear forecast;
  **cost per business process**; **cost per form type across all
  processes**; **cost per form type within a single business process**
  (pick one process in the `process_id` variable at the top to drill in);
  business processes onboarded; pages processed; average cost per
  document; and a notification-cost row (emails sent, top recipients).
  It also has a "Token Usage" panel that's intentionally empty — this app's
  only inference path (Azure AI Content Understanding custom analyzers) is
  billed per page, not per token, so there's nothing to show yet; the panel
  documents what to wire up if a token-metered step is added later.

Both dashboards share `process_id`/`detected_form` template variables so
any panel can be sliced or drilled into by business process and/or form
type. The dashboard JSON lives in
`infra/grafana/dashboards/cl-idp-ops.json` and
`infra/grafana/dashboards/cl-idp-finops.json`, mounted into the
`otel-collector` container with `updateIntervalSeconds: 30`, so they
persist across `docker compose down`/`up` and hot-reload within ~30s of
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
FinOps dashboard's cost panels can break it down by business process and
by document type — including within a single process once you filter the
`process_id` variable.

### Other pipeline metrics behind the dashboards

Beyond cost, the API and worker emit a handful of purpose-built OpenTelemetry
counters/histograms/gauges that back the volume, SLA, and notification
panels above:

- `idp_business_processes_onboarded` (gauge) — current count of onboarded
  business processes.
- `idp_jobs_triggered_total{process_id}` — jobs accepted into the pipeline.
- `worker_jobs_needs_review_total{process_id,detected_form}` /
  `worker_jobs_unclassified_total{process_id}` — succeeded jobs flagged for
  review, or that couldn't be classified.
- `idp_jobs_reviewed_total{process_id,status=complete|partial}` — review-save
  actions, split by whether all confidence violations were resolved.
- `worker_pages_processed_total{process_id,detected_form}` and
  `worker_job_pipeline_duration_seconds{process_id,detected_form}` (histogram)
  — pages processed and end-to-end (trigger-to-completion) latency, sliced
  by process and form type.
- `worker_notification_emails_sent_total{process_id,recipient}` /
  `worker_notification_emails_failed_total{process_id,recipient}` — review
  notification email delivery, by business-process owner.

## 2. Train custom analyzers and seed demo data

> If you're running the fully containerized stack via
> `docker compose --profile app up -d --build` (see `README.md`) instead of
> the host-process walkthrough in step 1, this entire step runs
> automatically as a one-shot `seed` service on every `up` — it's
> idempotent, so you can skip straight to step 3. Follow `docker compose
> logs -f seed` to watch it, and re-run `docker compose up seed` any time
> you want to force it again. The manual commands below are only needed
> when running the API/worker as host processes.

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
