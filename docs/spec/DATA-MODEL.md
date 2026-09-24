# Data Model & Persistence

This document defines the **control plane** (business process configuration
and routing-analyzer provisioning) and **data plane** (uploaded documents,
pipeline jobs, and their execution) persistence design, per the technology
choices in [`TECHNOLOGY.md`](./TECHNOLOGY.md) and the service integration
contract in [`CONTENT-UNDERSTANDING.md`](./CONTENT-UNDERSTANDING.md).

## Overview

| Plane        | Concern                                              | Storage                          |
|--------------|-------------------------------------------------------|-----------------------------------|
| Control plane | Business process config, routing analyzer status    | MongoDB `processes` collection    |
| Data plane   | Pipeline jobs, extracted fields, review state         | MongoDB `jobs` collection         |
| Data plane   | Uploaded source documents                             | Blob Storage (`documents` container) |
| Data plane   | Trigger → worker handoff                              | Storage Queue (`jobs` queue)      |

No caching layer — `GET /analyzers` always calls Azure AI Content
Understanding live (acceptable latency for demo scale; simplest to reason
about, no staleness). Screens that merely need to *display* an analyzer's
name do not call it at all, because the display name is denormalized onto
the process at save time (see below).

## Concurrency

**None.** There is no optimistic-concurrency check (no version field /
`findAndModify` compare-and-set) on any write. Two browser tabs editing the
same process, or two people reviewing the same job, resolve as
last-write-wins with no warning. Accepted as a demo limitation; a real
deployment would add a monotonically increasing `version` field checked via
`replace_one({"_id": ..., "version": expected}, ...)` on the process and
review update paths.

## MongoDB

Two collections, both required for the query patterns used by the API (list
processes; list/get jobs per process). The **`DataStore` protocol**
(`app/db/base.py`) is the only interface routers/worker code depends on;
`MongoService` (`app/db/mongo.py`, using **pymongo**) is the default
implementation talking to the local `mongo:7` container in dev and
**MongoDB Atlas** in production via the same `mongodb://`/`mongodb+srv://`
connection-string protocol. `CosmosService` remains available as a
config-selectable fallback (`DB_BACKEND=cosmos`) implementing the identical
protocol against Azure Cosmos DB for NoSQL — see
[`TECHNOLOGY.md`](./TECHNOLOGY.md#data-storage). Both implementations are
exercised by the same backend-agnostic contract test suite, so the
document shapes and query semantics described below hold for either
backend.

### `processes` collection

- **Document `_id`**: the process's own `id` (UUID string) — reads,
  updates, and deletes are simple `_id` lookups.
- **Document = the control-plane `BusinessProcess` record.**

```json
{
  "id": "<uuid>",
  "name": "Invoice Intake",
  "description": "...",
  "allowedAnalyzerIds": ["prebuilt-invoice", "custom-po-form"],
  "allowedAnalyzers": [
    { "id": "prebuilt-invoice", "name": "Invoice" },
    { "id": "custom-po-form", "name": "Purchase Order (custom)" }
  ],
  "confidenceThreshold": 0.8,
  "ownerEmail": "owner@example.com",
  "routingAnalyzerStatus": "ready",
  "routingAnalyzerId": "idp_r_<processId-hash>",
  "derivedAnalyzerIds": {
    "custom-po-form": "idp_d_<processId-hash>_<analyzer-hash>"
  },
  "routingAnalyzerError": null,
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-02T00:00:00Z"
}
```

- `routingAnalyzerId` is the Content Understanding analyzer this app created
  to classify documents and route them to the right extraction analyzer.
  **Internal only** — not returned by the public API (`BusinessProcess`
  exposes `routingAnalyzerStatus`/`routingAnalyzerError`); the worker reads
  it directly from MongoDB to make inference calls. `derivedAnalyzerIds`
  is likewise internal, mapping only the user-selected analyzers that were
  successfully derivable to their app-owned derived analyzer IDs. A
  selected analyzer that is routed directly has no `derivedAnalyzerIds`
  entry.
- `allowedAnalyzers` **denormalizes the display name** of each selected
  analyzer at save time. Without it, `process-list`, `process-detail`, and
  the `detectedForm` filter would each need a live `GET /analyzers` round
  trip just to render a label, and would break outright when CU is
  unreachable. The trade-off is staleness: a renamed custom analyzer shows
  its old label until the process is next saved. `allowedAnalyzerIds`
  remains the authoritative list; `allowedAnalyzers` is presentation only.
  Names are resolved **synchronously during create/update**, so if Content
  Understanding is unreachable at that moment the save fails with `502`
  rather than persisting a half-labelled process.
- `routingAnalyzerError` is set when `routingAnalyzerStatus == "failed"` and
  cleared when the next rebuild **starts**; surfaced via the API and the
  `process-detail` screen. It also carries the "analyzer no longer exists in
  the CU account" case, naming the missing analyzer.
- On `PUT /processes/{processId}`, the document is overwritten in place (no
  versioning). **The routing analyzer is rebuilt only when
  `allowedAnalyzerIds` actually changes** — editing a description, owner
  email, or threshold leaves `routingAnalyzerStatus` untouched, so a typo
  fix does not take the process offline. When the analyzer set does change,
  status resets to `building` pending the new provisioning run.
- `name` must be unique case-insensitively across the collection. As with
  Cosmos, uniqueness is enforced primarily via a **pre-write existence
  check** (`find_process_by_name`) on create/update; a collision returns
  `409` per the OpenAPI contract. **This check is not atomic**: two
  simultaneous creates of the same name can both pass it and both succeed.
  Uniqueness is therefore enforced against existing data, not against a
  concurrent racing request — accepted for a demo. `MongoService` layers a
  **unique index with a case-insensitive collation**
  (`locale: "en", strength: 2`) on the `name` field as a backstop
  (`ensure_schema()`), which the Cosmos backend has no equivalent for; a
  genuine race that slips past the pre-check would still be rejected by
  MongoDB at the storage layer, though today that rejection is **not**
  translated to a `409` (it surfaces as an unhandled duplicate-key error) —
  a known gap, not exercised by the current test suite.
- Selections are validated on write: at least 1 and at most **199**
  analyzers (Content Understanding allows 200 categories and the injected
  `other` takes one), no duplicates, and no analyzer whose ID is the
  reserved value `other`.
- `GET /processes` returns documents ordered by `createdAt` descending
  (newest first).

### Deleting a Process

`DELETE /processes/{processId}` cascades:

1. Delete every job document in the `jobs` collection for that `processId`
   (indexed by `processId`, so this is a single scoped bulk delete).
2. Delete every blob under the `{processId}/` prefix.
3. Delete the process document.

**Content Understanding analyzers are deliberately not deleted.** The
routing and derived analyzers created for the process are left in the CU
account. Deletion there can fail independently and would either block a
local delete or leave the system in a half-deleted state; the app's
`idp_` naming convention makes the orphans identifiable for manual cleanup,
and a subsequent process reusing the same ID would overwrite them anyway.
This is a documented trade-off, not an oversight.

### `jobs` collection

- **Document `_id`**: the job's own `id` (UUID string). Indexed on
  `(processId, submittedAt)` and `(status, submittedAt)` — created by
  `MongoService.ensure_schema()` — so per-process listing/filtering and the
  worker's startup-reconciliation scan (`list_running_jobs_before`) stay
  efficient without a full collection scan.

```json
{
  "id": "<uuid>",
  "processId": "<uuid>",
  "correlationId": "<uuid>",
  "fileName": "invoice-0042.pdf",
  "contentType": "application/pdf",
  "blobPath": "<processId>/<jobId>/invoice-0042.pdf",
  "status": "succeeded",
  "submittedAt": "2026-01-03T12:00:00Z",
  "completedAt": "2026-01-03T12:00:07Z",
  "detectedForm": "prebuilt-invoice",
  "detectedFormName": "Invoice",
  "unclassified": false,
  "retryOfJobId": null,
  "attempts": 1,
  "pages": [
    { "page": 1, "width": 8.5, "height": 11.0, "unit": "inch", "angle": 0 }
  ],
  "fields": [
    {
      "name": "invoiceTotal",
      "path": "/invoiceTotal",
      "type": "number",
      "value": 1024.5,
      "confidence": 0.62,
      "boundingBox": [0.1, 0.2, 0.4, 0.2, 0.4, 0.3, 0.1, 0.3],
      "page": 1,
      "reviewedValue": null
    },
    {
      "name": "items",
      "path": "/items",
      "type": "array",
      "items": [
        {
          "name": "0",
          "path": "/items/0",
          "type": "object",
          "properties": {
            "description": {
              "name": "description",
              "path": "/items/0/description",
              "type": "string",
              "value": "2 Surface Pro 6",
              "confidence": 0.42,
              "boundingBox": [0.4, 0.55, 0.5, 0.55, 0.5, 0.58, 0.4, 0.58],
              "page": 1,
              "reviewedValue": null
            }
          }
        }
      ]
    }
  ],
  "confidenceViolations": ["/invoiceTotal", "/items/0/description"],
  "notificationSent": true,
  "reviewedAt": null,
  "error": null
}
```

- `correlationId` ties the synchronous trigger request to all downstream
  asynchronous work in logs and traces (see Observability in
  `TECHNOLOGY.md`). Internal, not exposed on the API.
- `blobPath` and `contentType` are internal (not in the public `Job` API
  schema) — used server-side to fetch and serve the source document. The
  frontend renders the `inference-review` left pane via
  `GET /processes/{processId}/jobs/{jobId}/document`, a backend passthrough
  route that streams the blob content directly (no signed URLs, for
  simplicity in this demo).

### Field Representation

Fields mirror Content Understanding's typed, recursive model rather than
flattening everything to strings. **The stored shape and the API shape are
identical** — the job document is serialized to the API as-is (minus the
internal fields listed above), so there is no mapping layer to drift.

- `type` is one of `string`, `date`, `time`, `number`, `integer`,
  `boolean`, `array`, `object`.
- Scalars carry `value`. `array` carries `items` (an ordered list of
  fields); `object` carries `properties` (a map of name → field). A
  container never carries `value`.
- `name` is the analyzer's field name. For array elements, which have no
  name of their own, it is the **stringified index** (`"0"`, `"1"`, …).
- `confidence`, `boundingBox`, and `page` appear on **leaf** fields.
  Container fields (`array`/`object`) have no confidence of their own.
- **`confidence` may be absent** — Content Understanding omits it for
  generated (rather than extracted) values. An absent confidence is *not*
  treated as zero: the leaf is excluded from the job's aggregate confidence
  calculation and can never independently create a review requirement. The
  UI shows "n/a" rather than a misleading badge.
- `boundingBox` is **eight floats in 0–1 page-relative space**
  (`x1,y1,x2,y2,x3,y3,x4,y4`, top-left origin). Content Understanding
  returns inches for PDFs and pixels for images; the worker normalizes
  against the page's width/height at write time so that neither the stored
  document nor the frontend has to care which was which.
- `pages` carries the source page geometry (`width`, `height`, `unit`,
  `angle`) so the viewer can size pages correctly and compensate for scan
  skew — CU polygons are in the rotated, as-printed frame.

#### Field Paths

Every field carries a **`path`: a JSON Pointer (RFC 6901)** rooted at the
`fields` structure — `/invoiceTotal`, `/items/0/description`. This is the
identifier used in `confidenceViolations` and in review requests.

JSON Pointer is used rather than a friendlier dotted syntax (`items[0].
description`) because analyzer field names may themselves contain periods
and brackets — a field literally named `customer.name` would be
indistinguishable from a nested one. JSON Pointer defines escaping for the
only two characters that matter (`~0` for `~`, `~1` for `/`), so every path
is unambiguous. The UI displays field *names*, never raw paths, so the
verbosity costs nothing at the surface.

**Only leaf paths are reviewable.** A review request naming a container path
is rejected with `400`, as is one naming a path that does not exist.

### Classification Outcomes

- `detectedForm` is the classified analyzer ID; `detectedFormName` is its
  denormalized display name.
- `unclassified: true` means the document matched the routing analyzer's
  `other` catch-all — it isn't one of the forms this process accepts. The
  job is still **`succeeded`**, with `detectedForm: null`, an empty `fields`
  array, and no violations. It is not a failure: the pipeline worked
  correctly and the answer is "this document doesn't belong here." The
  review screen says exactly that instead of showing an empty editor.
- A classified document that yields **zero fields** is likewise `succeeded`
  with an empty `fields` array, and the review screen explains that no
  fields were extracted. `unclassified` remains `false`, since the document
  *was* recognized. Because it has no confidence-bearing leaves, it has no
  aggregate confidence and never requires review.

### Review and Failure State

- `confidenceViolations` is computed when a classified job succeeds by
  flattening every confidence-bearing leaf field and taking the arithmetic
  mean of the confidence values that are present. If that aggregate
  confidence is **below** `process.confidenceThreshold`,
  `confidenceViolations` is populated with the individual leaf paths whose
  own confidence is below the same threshold; if the aggregate is **equal
  to or above** the threshold, `confidenceViolations` is persisted as an
  empty list even when some individual leaves are below threshold. Fields
  without a confidence score are excluded from both the aggregate and the
  violations list. A classified job with no confidence-bearing leaves has
  no aggregate and therefore no violations.
- `reviewedAt` is set on the **first** `PUT .../review` call for the job
  (left `null` otherwise) — the audit signal for "has this job ever been
  human-reviewed," independent of whether `confidenceViolations` has since
  emptied out. No `reviewedBy`/per-user attribution, since there is no
  authentication in this demo. Repeat review calls are allowed and do not
  move the timestamp.
- Review is a **partial patch**: only the leaf paths present in the request
  are updated, the original extracted `value` is preserved alongside the new
  `reviewedValue` for audit, and an unknown or non-leaf path is rejected
  with `400` rather than silently ignored.
- **Approving without changing** is a first-class case. A reviewer who
  confirms that a low-confidence value is actually correct submits that path
  with the unchanged value; `reviewedValue` is set to it and the violation
  clears. Without this, a correct-but-low-confidence field could never be
  cleared from the queue, which is most of what review exists to do.
- `notificationSent` (internal, not in API schema) guards the
  owner-notification email so it fires once, at the moment an
  aggregate-below-threshold success first persists a non-empty
  `confidenceViolations` list — even though the list itself later shrinks
  via review. It stays `false` if the SMTP send failed, since delivery is
  best-effort and never fails the job.
  Because the flag is persisted *after* the send, a crash in between can
  produce a duplicate email on replay; delivery is therefore **at-least-once
  in the worst case, once in practice**, and deliberately not made
  transactional for a demo.
- `error` is set when `status == "failed"` (e.g., the Content Understanding
  call failed, the routing analyzer wasn't ready, or the job exceeded its
  timeout or retry budget) and returned via the API per the OpenAPI
  `Job.error` field. Unsupported file types and oversized files are rejected
  synchronously (`400`) at trigger time — before any job/blob/queue message
  is created — so they never appear as a `failed` job.
- `attempts` counts worker dequeues, backing the poison-message policy
  below.
- `retryOfJobId` links a job created by `POST .../jobs/{jobId}/retry` back to
  the failed job it re-runs. Retry creates a **new** job over the same blob
  rather than resetting the original, so the failure remains visible in
  history and the retry has its own timestamps and correlation ID. The new
  job **keeps the original job's `blobPath`** — the document is not copied,
  so a retry job's blob path contains the *original* job's ID. This is the
  one deliberate exception to the path convention below.

## Querying for Low-Confidence / Reviewed Cases

`GET /processes/{processId}/jobs` returns results ordered by `submittedAt`
descending (newest first) and backs both the recent-jobs preview on
`process-detail` and the full filterable table on `process-jobs`. It
supports optional filters so "which of my jobs need attention" is answered
server-side, without scanning every job's `fields` array client-side:

- `?status=` — one or more of `queued`/`running`/`succeeded`/`failed`.
- `?detectedForm=` — one or more classified form/analyzer types.
- `?hasViolations=true` — jobs with at least one entry currently in
  `confidenceViolations` (i.e., aggregate confidence was below threshold and
  at least one below-threshold leaf remains unreviewed).
- `?reviewed=true|false` — jobs where `reviewedAt` is set/unset,
  independent of whether violations remain.
- `?unclassified=true|false` — jobs whose document matched none of the
  process's allowed forms.
- `?fileName=` — case-insensitive substring match on `fileName`.
- `?submittedFrom=` / `?submittedTo=` — `submittedAt` range bounds.
- `?limit=` — result cap (default 100, max 500) instead of pagination.

All filters are combined with AND and scoped to `processId` (an indexed
field), so they stay cheap without a full collection scan on either
backend. In MongoDB, `hasViolations` maps to a
`{"confidenceViolations.0": {"$exists": true|false}}` predicate, `reviewed`
to `{"reviewedAt": {"$ne": null}}` / `{"reviewedAt": null}`, and `fileName`
to a case-insensitive `$regex` match. The Cosmos fallback expresses the
same predicates as `ARRAY_LENGTH(c.confidenceViolations) > 0`,
`IS_NULL(c.reviewedAt)`, and `CONTAINS(LOWER(c.fileName), ...)`
respectively — different query languages, identical filter semantics,
verified by the shared contract test suite
(`tests/test_datastore_contract.py`).

List responses **project away** the `fields` array (the largest part of a
job document) and return `fieldCount` instead, per the OpenAPI `Job` schema;
`GET .../jobs/{jobId}` still returns the full `fields` array for the
`inference-review` screen. `fieldCount` is derived at read time from the
stored `fields` array — it is not a separately persisted counter, so it
cannot drift. Nested fields count as one each, so `fieldCount` reflects
total leaves, not top-level entries.

### Summary Counts

`GET /processes/{processId}/jobs/summary` accepts the **same filter
parameters** (except `limit`) and returns aggregate counts:

```json
{ "total": 412, "needsReview": 37, "failed": 5, "unclassified": 3 }
```

This exists because the `process-jobs` header shows counts for the current
filter, and those counts must not be capped by `limit` — counting the
returned page would understate the backlog exactly when it matters most.
Implemented as `count_documents`/`COUNT` aggregate queries scoped to the
same `processId`. `needsReview`, `failed`, and `unclassified` each **AND**
an additional required condition (has-violations / `status == failed` /
`unclassified == true`) onto whatever filters the caller already supplied,
so — for example — requesting `?status=succeeded` still reports how many of
those succeeded jobs need review, and a caller who passes a value that
directly contradicts the special count's own requirement (e.g.
`hasViolations=false` while reading `needsReview`) gets `0` for that count
rather than a value ignoring their filter.
`needsReview` counts jobs whose persisted `confidenceViolations` list is
currently non-empty, so it reflects the aggregate confidence gate plus any
review work already completed.

## Blob Storage

- **Container**: `documents`.
- **Path convention**: `{processId}/{jobId}/{originalFileName}` — human-
  traceable hierarchy for debugging/demo walkthroughs (e.g., browsing the
  emulator/Storage Explorer by process, then job).
- Written once by the trigger endpoint before the queue message is sent;
  read by the worker (to post bytes to Content Understanding) and by the
  review screen's document-rendering path.
- **Display conversion**: `GET .../jobs/{jobId}/document` serves PDF, PNG,
  and JPG bytes verbatim. **TIFF is converted to PDF**, not to a single
  image — a TIFF may hold up to 20 pages, and only a paged format lets the
  review viewer page through them and place bounding boxes on page 3. The
  converted PDF also means the viewer has exactly two rendering paths
  (pdf.js and `<img>`) instead of three. The response's `Content-Type`
  reflects what is actually returned, so a TIFF job's document is served as
  `application/pdf`. The original TIFF is what remains stored and what is
  sent to Content Understanding — conversion is display-only and does not
  affect page numbering, since page order is preserved.
- Blobs for a process are deleted when the process is deleted (see
  Deleting a Process). Otherwise there is no lifecycle/retention policy for
  this demo — documents persist indefinitely.

## Queue

- **Queue name**: `jobs`.
- **Producer**: `POST /processes/{processId}/trigger` — after validating the
  upload (see below) and writing the blob and creating the `jobs` document
  with `status: "queued"`, enqueues a **denormalized** message so the
  worker can process without an extra database read for process config:

```json
{
  "jobId": "<uuid>",
  "processId": "<uuid>",
  "correlationId": "<uuid>",
  "blobPath": "<processId>/<jobId>/invoice-0042.pdf",
  "routingAnalyzerId": "idp_r_<processId-hash>",
  "confidenceThreshold": 0.8,
  "ownerEmail": "owner@example.com"
}
```

### Trigger-Time Validation

All rejected synchronously with `400` and the shared `Error` schema, before
any blob write, job document, or queue message:

- **File type** — content-type/extension must be PDF, PNG, JPG, or TIFF.
- **Size** — at most **20 MB**.
- **Page count** — at most **20 pages** (PDF/TIFF; checked without a full
  parse where possible).
- **Exactly one file** per trigger. Batch upload is out of scope.

These limits are far stricter than Content Understanding's own (200 MB /
300 pages), chosen deliberately so demo runs stay fast and cheap.

A `409` is returned instead when the process's `routingAnalyzerStatus` is
not `ready` — checked synchronously, so a doomed job is never queued.

### Reliability

- **Visibility timeout**: 15 minutes per dequeue — deliberately **longer
  than the 10-minute per-job timeout**. If visibility expired first, a
  still-running job's message would become visible to the consumer again,
  producing a duplicate Content Understanding call, inflated dequeue counts,
  and premature poisoning. The alternative (renewing visibility on a timer)
  buys nothing at this scale.
- **Max dequeue count**: 3. On the fourth delivery the message goes to the
  `jobs-poison` queue and the job is marked `failed` with an error naming
  the retry exhaustion. Without this, a message that reliably crashes the
  worker would loop forever.
- **Per-job timeout**: 10 minutes from `running`. A job exceeding it is
  marked `failed`.
- **Startup reconciliation**: the worker is in-process, so an API restart
  mid-job would otherwise strand that job in `running` forever. On startup
  the app scans for `running` jobs older than the per-job timeout and
  re-queues each once (incrementing `attempts`), failing those already at
  the retry cap.
- **Orphaned messages**: a message whose job or process no longer exists —
  because the process was deleted while work was queued — is **discarded
  without error**. Deletion does not attempt to purge the queue.
- **Config staleness**: denormalizing `routingAnalyzerId`,
  `confidenceThreshold`, and `ownerEmail` onto the message means the
  consumer doesn't re-fetch the process record mid-job — trading a small
  duplication risk (stale config if the process is edited between trigger
  and processing) for simplicity, which is acceptable for this demo.

## Worker Model

- **No separate worker service.** The pipeline runs as an in-process async
  consumer loop inside the same `apps/api` process that accepted the trigger
  request, reading the same Azurite/Storage queue (rather than a bare
  `BackgroundTasks` call) so that work survives restarts and can be replayed.
- Flow: dequeue message → set `status: "running"` → stream the blob and
  `POST :analyzeBinary` against the process's routing analyzer → poll
  `analyzerResults` → map the result (see
  [`CONTENT-UNDERSTANDING.md`](./CONTENT-UNDERSTANDING.md)): resolve
  `detectedForm`/`unclassified`, normalize bounding polygons to 0–1, build
  the typed `fields` tree and the `pages` array → compute aggregate
  confidence from all present leaf confidence values and populate
  `confidenceViolations` only when that aggregate is below
  `confidenceThreshold` → write results, `status: "succeeded"|"failed"`,
  and `error` (if failed) back onto the `jobs` document → if
  `confidenceViolations` is non-empty, send the owner-notification email
  once and set `notificationSent: true`.
- **Content Understanding polling**: poll the analyze operation every 2
  seconds, backing off to 5 seconds after the first 30 seconds, bounded by
  the per-job timeout. (CU's own guidance is a minimum of one second between
  requests.)
- This keeps local dev / the demo to a single running API process (plus
  Docker Compose infra), while still using the same Storage Queue
  primitives as production, so moving to a standalone worker container/AKS
  deployment later is a deployment change, not a code change.

## Routing Analyzer Provisioning

Triggered on process create, and on update **only when
`allowedAnalyzerIds` changes**. Also runs as a background task with its
status projected onto the process document:

1. Set `routingAnalyzerStatus: "building"` and clear
   `routingAnalyzerError`.
2. Validate every selected analyzer still exists in the CU account; a
   missing one fails fast with a `routingAnalyzerError` naming it.
3. Create/replace one **derived analyzer** per selection (enabling
   confidence and source estimation), polling each creation operation.
4. Create/replace the **routing analyzer** whose categories map each
   selection to its derived analyzer, plus the `other` catch-all.
5. Set `routingAnalyzerStatus: "ready"`, or `"failed"` with
   `routingAnalyzerError` on any step's failure.

`routingAnalyzerError` is cleared when a rebuild **starts** (step 1), not
when one succeeds — so a `building` process never displays a stale error
from the previous attempt.

Because analyzer IDs are deterministic, re-provisioning replaces the same
resources (with `allowReplace=true`) rather than accumulating them. Derived
analyzers for newly-deselected analyzers are deleted on a best-effort basis.

**Durability**: provisioning is bounded by a **15-minute timeout**, after
which it is marked `failed`. Like jobs, it is reconciled at startup — any
process left in `building` beyond that window is either restarted or marked
`failed`, so a restart mid-provision cannot strand a process in a state its
screen would poll forever.

## Status

Ready for implementation.
