# Task 06 — Worker: Inference Pipeline

## Status

Done

## Objective

Implement the queue-consuming worker: dequeue a job message, call CU's
`analyzeBinary` against the routing analyzer, poll for the result, map the
result into the job's typed/recursive `fields` shape with normalized
bounding boxes, compute `confidenceViolations`, send the owner
notification email when applicable, and persist the final job state.

## Spec References

- `docs/spec/CONTENT-UNDERSTANDING.md` — Analysis Flow, Result Shape,
  Field Value Types, Confidence, Grounding (`source`/coordinate
  normalization), Unclassified Documents sections.
- `docs/spec/DATA-MODEL.md` — Field Representation, Classification
  Outcomes, Review and Failure State (notification/`attempts` semantics),
  `DECISIONS.md` rows 23-27 (poison queue, stuck-job reconciliation, poll
  intervals, email best-effort).
- `docs/spec/features/pipeline-trigger-api.md` — Notifications section.
- Task 01 findings on the exact `contents[]` arrangement.

## Scope

**In scope:**
- Worker process/loop (`apps/api/app/worker/main.py`, run as a separate
  process from the API via a second `uv run` entry point or a background
  thread — decide and document; recommend a separate process for
  realistic prod parity with independently-scalable workers per
  `TECHNOLOGY.md`'s AKS mention) that:
  1. Dequeues a message (visibility timeout 5 minutes per `DECISIONS.md`
     #23), sets job `status: "running"`.
  2. Streams the blob, calls `:analyzeBinary` against
     `routingAnalyzerId` from the message.
  3. Polls `analyzerResults/{operationId}` at 2s intervals backing off to
     5s, with a 10-minute per-job timeout → `failed` with `error` set.
  4. On `Succeeded`, maps the result: locates the routing content object
     whose `segments[]` carry the classified category, and separately
     locates the content object with `fields`, per the verified live shape
     from task 01; builds the recursive `Field` tree (scalars/array/object)
     with `path` (JSON Pointer), `confidence` (omitted when CU omits it),
     and `boundingBox` normalized to 0-1 page-relative coordinates using
     each page's `width`/`height`; populates `pages` array.
  5. Handles `other` classification → `unclassified: true`,
     `detectedForm: null`, empty `fields`, `succeeded`.
  6. Handles zero-fields-but-classified → `succeeded`, `unclassified:
     false`, empty `fields`.
  7. Computes `confidenceViolations` — leaf fields with a confidence score
     below `confidenceThreshold` (fields with no confidence excluded).
  8. Sends the owner notification email (once, via SMTP to Mailpit
     locally) when `confidenceViolations` is non-empty at first success;
     sets `notificationSent`; logs and continues on SMTP failure without
     failing the job.
  9. Persists final job document (`status`, `completedAt`, `detectedForm`,
     `detectedFormName`, `unclassified`, `pages`, `fields`,
     `confidenceViolations`, `notificationSent`, `error`).
  10. Poison-message handling: after 3 dequeue attempts (`attempts`
      field), marks the job `failed` and removes the message rather than
      retrying indefinitely.
  11. Startup reconciliation: on worker start, re-queues any job stuck in
      `running` past its per-job timeout, once, then fails it if it
      recurs.
- Unit tests for the result-mapping function using fixture JSON (captured
  from task 01's spike) covering: classified-with-fields, `other`,
  classified-with-zero-fields, nested array/object fields, missing
  confidence, and a routed direct-to-prebuilt category whose field object
  still carries `confidence`/`source`.
- Live integration test: full pipeline against a real sample document
  through a real process, asserting final job state.

**Out of scope:** the `GET .../jobs` read endpoints (task 07 exposes what
this task persists); the review/retry endpoints (task 08).

## Dependencies

- Task 01 (confirmed `contents[]` arrangement, confidence/bbox behavior).
- Task 01b (reconciled the result-mapping rules with the live routed
  prebuilt behavior and `segments[].category` classification location).
- Task 04 (routing analyzer must exist and be `ready` to analyze against).
- Task 05 (queue message producer, job document shape to update).

## Subtasks

1. Implement the dequeue loop with visibility timeout and `attempts`
   tracking.
2. Implement the CU `analyzeBinary` call + poll loop with timeout.
3. Implement result-mapping: read classification from the routing
   analyzer's `segments[].category`; locate the extraction object by the
   presence of `fields`; support the routed analyzer target being either a
   derived app-owned analyzer or a direct prebuilt/custom analyzer; build
   the recursive `Field` tree with JSON Pointer paths.
4. Implement bounding-box normalization (parse `source` polygon, divide by
   page width/height, unit-aware).
5. Implement `confidenceViolations` computation.
6. Implement SMTP notification (best-effort, Mailpit locally).
7. Implement poison-queue handling (max 3 attempts) and startup
   reconciliation for stuck `running` jobs.
8. Write fixture-based unit tests for result mapping (no CU calls needed —
   use captured JSON from task 01), including the two-content matched case
   and the single-content `other` case.
9. Write a live integration test end-to-end: create a process via the API,
   wait for `ready`, trigger with a real sample document, poll the worker
   output, assert final state including a Mailpit-visible email when
   applicable.

## Acceptance Criteria

- **Given** a queued job for a process with a `ready` routing analyzer,
  **when** the worker processes it, **then** the job transitions
  `queued` → `running` → `succeeded`/`failed` and the final document
  matches the shape in `DATA-MODEL.md`.
- **Given** a document that matches an allowed analyzer, **when**
  processed, **then** `detectedForm`/`detectedFormName` are set,
  `unclassified: false`, and `fields` contains a properly nested tree with
  correct `path` values, with classification read from the routing
  content's `segments[].category`.
- **Given** a routed category that points directly at `prebuilt-invoice`
  rather than an app-owned derived analyzer, **when** processed, **then**
  the mapped fields still preserve any CU-supplied `confidence` and
  `source` values from that routed extraction object.
- **Given** a document that matches none of the process's analyzers,
  **when** processed, **then** the job is `succeeded`,
  `unclassified: true`, `detectedForm: null`, `fields: []`.
- **Given** an extraction with a field below `confidenceThreshold`,
  **when** the job succeeds, **then** that field's path is in
  `confidenceViolations`, and a notification email arrives at Mailpit
  listing it.
- **Given** an extraction with a field carrying no confidence score,
  **when** violations are computed, **then** that field is excluded from
  `confidenceViolations` regardless of its value.
- **Given** CU analysis takes longer than 10 minutes (simulate with a
  short test timeout override), **when** the timeout elapses, **then** the
  job is `failed` with a timeout `error`.
- **Given** a message that fails processing 3 times, **when** the 3rd
  failure occurs, **then** the job is `failed` and the message leaves the
  queue (no 4th attempt).
- **Given** SMTP is unreachable, **when** a violating job succeeds,
  **then** the job still ends `succeeded` with `notificationSent: false`,
  and the failure is logged, not raised.

## Test Instructions

```bash
docker compose up -d
cd apps/api

# Fixture-based unit tests (no live CU needed)
uv run pytest tests/test_result_mapping.py -v

# Live end-to-end (needs CU credentials; costs a small amount)
uv run pytest tests/test_worker_e2e.py -v -m live

# Manual run
uv run python -m app.worker.main &
curl -s -X POST http://localhost:8000/processes/<id>/trigger -F "file=@samples/invoice.pdf"
watch -n2 'curl -s http://localhost:8000/processes/<id>/jobs/<jobId> | jq ".status, .detectedForm, .confidenceViolations"'
open http://localhost:8025   # Mailpit UI — confirm the notification email arrived
```

## Definition of Done

- [x] Fixture-based mapping tests cover all field types (scalar, array,
      object, missing confidence) and both classification outcomes.
- [x] Live E2E test passes against the real CU resource and Mailpit.
- [x] Poison-queue and startup-reconciliation behavior verified with a
      forced-failure test.
- [x] Bounding boxes verified numerically in `[0,1]` for a known fixture.
- [x] Notification best-effort behavior verified (job still succeeds when
      SMTP is down).
