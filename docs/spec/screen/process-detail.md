---
page: process-detail
---

Overview screen for a single business process, combining process
configuration summary with the inference testing entry point (Business
Process Inference Testing Flow feature).

- **Header**: process name, description, allowed analyzers (rendered from
  the denormalized `allowedAnalyzers` names, so no live analyzer call is
  needed), confidence threshold (shown as a percentage), owner email, and
  **routing analyzer status** (`building` / `ready` / `failed`) — rebuilt
  whenever the process's analyzer selection changes — with an "Edit" link to
  `process-form` and a "Delete" action. When status is `failed`, shows
  `routingAnalyzerError` inline. While status is `building`, the screen
  polls `GET /processes/{processId}` every 5 seconds and updates in place,
  stopping once status becomes `ready` or `failed` — or after 10 minutes,
  where it stops and offers a manual refresh rather than polling forever.
- **Delete**: asks for confirmation that names the process and warns that
  all of its jobs and uploaded documents will be deleted, then calls
  `DELETE /processes/{processId}` and returns to `process-list`.
- **Upload panel**: drag-and-drop / file picker accepting up to 100 PDF,
  PNG, JPG, or TIFF files at once (each up to 20 MB and 20 pages); disabled
  with an explanatory message (surfacing `routingAnalyzerError` when
  relevant) while the routing analyzer is building or has failed.
  Client-side size/type checks run per file, so a mixed selection queues
  every valid file and reports each invalid one inline as "Rejected"
  instead of blocking the batch; selections beyond 100 files are truncated
  with a notice. Accepted files are queued client-side and uploaded with
  up to 5 concurrent `POST /processes/{processId}/trigger` requests (one
  call per file — the API itself still only ever accepts a single file per
  request), so a large batch drains progressively rather than all at once.
  A queue panel lists every file from the current browser session with its
  live status (waiting, uploading, queued, processing, succeeded, no
  matching form, failed, or rejected), a progress summary, and "Clear
  completed" / "Clear all" actions; a `400` from a given file's trigger
  call is shown as that row's error message. Status is reconciled by
  polling `GET /processes/{processId}/jobs` every 2 seconds (backing off to
  10 seconds after the first minute) for all jobs the batch created, rather
  than polling each job individually. After 10 minutes of a batch still
  having in-flight items it stops polling and offers a manual refresh
  rather than spinning forever.
- **Job history**: short preview of the most recent inference jobs for this
  process (uploaded file name, submitted time, status, detected form), each
  row linking to `inference-review` for that job once complete; failed rows
  show the job's `error` message inline plus a **Retry** action instead of a
  link. Rows with current entries in `confidenceViolations` show a "needs
  review" badge; that list is non-empty only when the job's aggregate
  confidence fell below the process threshold, and its entries still name
  the specific below-threshold leaves for review. Unclassified jobs show a
  "no matching form" badge. A
  filter/toggle above the list uses `GET .../jobs?hasViolations=true` to
  surface outstanding low-confidence cases — `hasViolations` alone, not
  combined with `reviewed=false`, since a partially reviewed job with
  violations still left is exactly the kind of job that needs attention. A
  **"View all jobs"** action opens `process-jobs`, the full filterable job
  table for this process; the "needs review" toggle deep-links into
  `process-jobs` with the equivalent filter pre-applied.
- **Interactions**: uploads never auto-navigate away from this screen —
  each queued file's row exposes a **"View review"** action once its job
  reaches a terminal state, linking to `inference-review` for that job; an
  unclassified result instead shows a "no matching form" badge inline on
  its row, and a failed upload shows a **Retry** action that re-queues the
  same file for upload.
