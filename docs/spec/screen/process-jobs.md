---
page: process-jobs
---

Full jobs screen for a **single business process** — the expanded,
filterable view of that process's inference job history. Reached from
`process-detail` (the "View all jobs" action on its Job history panel),
which keeps only a short recent-jobs preview; this screen is the place to
search, filter, and work through the backlog. Route:
`/processes/{processId}/jobs`.

- **Header**: process name (linking back to `process-detail`), plus summary
  counts for the current filter — total jobs, needs-review, failed,
  unclassified — fetched from `GET /processes/{processId}/jobs/summary` with
  the same filters, so the counts reflect *all* matches rather than just the
  capped page currently in the table.

- **Layout**: a filter bar above a table of jobs. Columns: file name,
  submitted time, status badge (`queued` / `running` / `succeeded` /
  `failed`), detected form (display name; "no matching form" when
  unclassified), field count, "needs review" badge (when
  `confidenceViolations` is non-empty because the job's aggregate
  confidence fell below the process threshold), and reviewed indicator
  (`reviewedAt` set/unset). Rows are ordered by `submittedAt` descending
  (newest first).

- **Filter bar** — every control maps to a query parameter on
  `GET /processes/{processId}/jobs` and is mirrored in the URL query string,
  so a filtered view is linkable/bookmarkable and survives refresh:
  - **Status** — multi-select over `queued`, `running`, `succeeded`,
    `failed` → `status`.
  - **Detected form** — multi-select whose options are the union of the
    process's current allowed analyzers and any `detectedForm` present in
    the loaded results, so jobs classified by an analyzer that has since
    been removed from the process remain filterable → `detectedForm`.
  - **Needs review** — toggle for jobs whose aggregate confidence fell below
    threshold and still have outstanding low-confidence leaf paths →
    `hasViolations=true`.
  - **Reviewed** — tri-state (any / reviewed / not reviewed) → `reviewed`.
  - **Unclassified** — toggle for documents that matched no allowed form →
    `unclassified=true`.
  - **File name** — free-text, case-insensitive substring search →
    `fileName`.
  - **Submitted between** — date range → `submittedFrom` / `submittedTo`.
  - A "Clear filters" action resets to the unfiltered default view.

- **Data**: `GET /processes/{processId}/jobs` with the filter parameters
  above; `GET /processes/{processId}/jobs/summary` for the header counts;
  `GET /processes/{processId}` for the process name/threshold shown in the
  header. The list response omits each job's `fields` array for payload size
  — the table renders from `fileName`, `status`, `submittedAt`,
  `detectedForm`/`detectedFormName`, `unclassified`, `fieldCount`,
  `confidenceViolations`, and `reviewedAt`. Results are capped by `limit`
  (default 100); when the cap is hit, the screen shows a "showing first N of
  M — narrow your filters" hint, using the summary total for M.

- **Live updates**: while any listed job is `queued` or `running`, the
  screen re-issues the current query every 2 seconds (backing off to 10
  seconds after the first minute) and updates the table in place, stopping
  once no in-flight jobs remain or after 10 minutes.

- **Interactions**:
  - Row click on a `succeeded` job → `inference-review` for that job,
    giving the **exact same** two-pane human review experience used in the
    Business Process Inference Testing Flow — source document with bounding
    boxes on the left, editable fields with confidence badges on the right,
    and Save/Approve via `PUT /processes/{processId}/jobs/{jobId}/review`.
    Review entered from here returns to `process-jobs` with its filters
    intact.
  - `failed` rows are not reviewable; they show the job's `error` message
    inline (expandable) and offer a **Retry** action
    (`POST .../jobs/{jobId}/retry`), which adds a new job to the top of the
    list.
  - `queued` / `running` rows show an inline processing state and are not
    yet clickable.
  - Unclassified jobs are clickable and open `inference-review`, which
    explains the outcome rather than showing an editor.

- **Empty state**: distinguishes "no jobs yet for this process" (prompt to
  upload a document from `process-detail`) from "no jobs match these
  filters" (offer to clear filters).
