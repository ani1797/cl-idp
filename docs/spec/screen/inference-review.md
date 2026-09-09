---
page: inference-review
---

Two-pane side-by-side review screen, per the Business Process Inference
Testing Flow feature, for a single completed inference job. Entered from
`process-detail` (newest/recent job) or from `process-jobs` (any job in the
filtered table) — the screen and its behavior are identical either way.

- **Left pane**: rendered source document with bounding-box overlays marking
  the location of each extracted field. PDFs render via react-pdf (pdf.js)
  and PNG/JPG via a native `<img>`; TIFF arrives already converted to PDF by
  the document endpoint, so it uses the same paged PDF path. Multi-page
  documents use a **paged viewer** with page controls and a page indicator —
  clicking a field in the right pane navigates to that field's page and
  highlights its box, so a field on page 7 is reachable in one click.
- **Bounding boxes**: `boundingBox` arrives as eight floats in 0–1
  page-relative coordinates, so the overlay simply multiplies by the
  rendered page's pixel width/height — no unit conversion in the client. The
  job's `pages` array supplies each page's aspect ratio and `angle`; a
  non-zero angle is applied as a rotation transform so overlays line up on
  skewed scans. Fields without a bounding box are listed but not
  highlightable, and say so.
- **Right pane**: editable list of extracted fields — field name, value
  (editable), and confidence score badge; fields below the process's
  confidence threshold and not yet reviewed are visually flagged (e.g.,
  warning color/icon), per `confidenceViolations`. Fields with no confidence
  score show "n/a" rather than a zero badge, and are never flagged.
  **Nested fields** (arrays/objects, e.g. invoice line items) render as
  collapsible groups, with editable leaves inside; array elements are
  labelled by index. Detected form/classification is shown read-only (not
  user-editable, per spec).
- **Approving without editing**: each flagged field also has an "Approve"
  affordance for the common case where the extracted value has low
  confidence but is actually correct. Approving submits the unchanged value,
  which clears the violation. Save is enabled once anything has been edited
  **or** approved.
- **Data**: `GET /processes/{processId}/jobs/{jobId}` for classification,
  extracted fields, page geometry, bounding boxes, and confidence
  violations; `GET /processes/{processId}/jobs/{jobId}/document` streams the
  source file rendered in the left pane.
- **Interactions**: user edits field values inline; "Save/Approve" calls
  `PUT /processes/{processId}/jobs/{jobId}/review` **with only the fields
  actually edited or approved** (a partial patch, addressed by JSON Pointer
  `path`), persisting the reviewed values (human review only — does not
  retrain the pipeline), removing the saved paths from
  `confidenceViolations` (no additional notification email is sent), and
  returns to the originating screen — `process-jobs` (with its
  filters/query string intact) or `process-detail`, defaulting to
  `process-detail` when entered directly by URL. Review may be done across
  several passes.
- **Nothing-to-review states**: the two-pane editor is replaced by an
  explanatory panel when
  - the job is **unclassified** — "this document doesn't match any form
    *{process name}* accepts", showing the document alongside, with actions
    to go back or upload a different file; or
  - the job succeeded but **extracted no fields** — stated plainly, with the
    document still rendered for inspection.

  Both keep the document viewer, since seeing the document is the fastest
  way to understand why. Neither offers a Save action.
- **Not-reviewable states**: a `queued`/`running` job shows a processing
  state and polls every 2 seconds, backing off to 10 seconds after the first
  minute and stopping after 10 minutes with a manual-refresh prompt; a
  `failed` job shows its `error` and a Retry action instead of the review
  UI.
- **Concurrency**: no conflict detection — concurrent reviews of the same
  job are last-write-wins.
