# Task 08 — Review & Retry API

## Status

Done

## Objective

Implement `PUT /processes/{processId}/jobs/{jobId}/review` (partial patch
of reviewed field values) and
`POST /processes/{processId}/jobs/{jobId}/retry` (re-run a failed job over
the same blob as a new linked job). These complete the backend surface
needed by `inference-review` (task 13).

## Spec References

- `docs/spec/features/business-process-inference-testing.md` — Review
  Behavior section (partial patch, approve-without-editing, violation
  clearing, `reviewedAt` semantics), Failed Jobs section (retry semantics).
- `docs/spec/DATA-MODEL.md` — Review and Failure State section,
  `retryOfJobId` paragraph (note: retry job **keeps the original job's
  `blobPath`** — the one exception to the path convention).
- `docs/spec/api/openapi.yaml` — `/processes/{processId}/jobs/{jobId}/
  review` and `/processes/{processId}/jobs/{jobId}/retry` schemas.

## Scope

**In scope:**
- `PUT .../review` — request body is `{"fields": [{"path": "/invoiceTotal",
  "value": "1024.50"}, ...]}` per `openapi.yaml`'s `ReviewedField` schema
  (an **array** of `{path, value}` objects, not an object keyed by path;
  `value` is always a **string**, regardless of the field's extracted
  type):
  - Reject `400` if a path doesn't exist in the job's `fields` tree, or
    names a non-leaf (`array`/`object`) path.
  - For each valid path: set `reviewedValue` (stringified per the
    schema), preserve original `value` unchanged, remove the path from
    `confidenceViolations` if present.
  - Set `reviewedAt` only if currently `null` (first review call); never
    move it on subsequent calls.
  - Allow repeat calls (re-reviewing the same or different paths across
    multiple passes).
  - No notification email is sent as a result of review.
  - `404` if job/process doesn't exist; `400` if the job is not in a
    reviewable state (per `openapi.yaml`, non-existent/non-leaf paths and
    a non-reviewable job share the same `400` response).
- `POST .../retry` — only valid on a `failed` job (`400`/`409` per
  OpenAPI's documented behavior otherwise):
  - Creates a **new** job document: fresh `id`, fresh `correlationId`,
    `status: "queued"`, `retryOfJobId` set to the original, **same
    `blobPath`** as the original (no blob copy), same `fileName`/
    `contentType`.
  - Enqueues a new queue message referencing the new job ID but the
    original blob path.
  - The original job is left untouched (`status: "failed"` stays, for
    audit).
  - Returns `202` with the new job ID (worker from task 06 will process it
    like any other queued job).

**Out of scope:** the worker itself (already built in task 06 and reused
as-is for retried jobs — no changes needed there since it doesn't care
whether a job is a retry); the frontend screens that call these (task 13).

## Dependencies

- Task 07 (job read endpoints/models to build on and verify against).

## Subtasks

1. Implement JSON Pointer path resolution against the stored `fields`
   tree (parse pointer, walk `properties`/`items`, identify leaf vs
   container).
2. Implement the review endpoint: validation, partial update, violation
   clearing, `reviewedAt` first-write-only semantics.
3. Implement the retry endpoint: new job creation reusing `blobPath`, new
   queue message enqueue, original job left untouched.
4. Write integration tests: valid single-path review, multi-path review in
   one call, multi-pass review (two separate calls touching different
   paths), invalid path (`400`), non-leaf path (`400`), repeat review of
   an already-reviewed path (allowed, doesn't move `reviewedAt`), retry of
   a failed job (new job appears, `retryOfJobId` correct, blob not
   duplicated, worker can process it end-to-end), retry attempted on a
   non-failed job (rejected).

## Acceptance Criteria

- **Given** a succeeded job with `confidenceViolations: ["/invoiceTotal"]`,
  **when** `PUT .../review` submits `{"fields": [{"path": "/invoiceTotal",
  "value": "1024.50"}]}` (the same value, i.e. an approval), **then** the
  response reflects `reviewedValue` set, `confidenceViolations` no longer
  contains that path, and `reviewedAt` is now set.
- **Given** the same job reviewed a second time for a different path,
  **when** the second `PUT .../review` call completes, **then**
  `reviewedAt` is unchanged from the first call's timestamp.
- **Given** a review request naming a path that doesn't exist in the job's
  `fields`, **when** submitted, **then** the response is `400` and no
  fields are modified.
- **Given** a review request naming a container path (e.g. `/items`),
  **when** submitted, **then** the response is `400`.
- **Given** a `failed` job, **when** `POST .../retry` is called, **then**
  a new job is created with `status: "queued"`, `retryOfJobId` pointing at
  the original, and the **same** `blobPath` as the original (verify no new
  blob was written).
- **Given** the retried job, **when** the worker (task 06) picks it up,
  **then** it processes normally end-to-end using the original blob.
- **Given** a `succeeded` job, **when** `POST .../retry` is called,
  **then** it is rejected (not retryable) per the documented status code.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run pytest tests/test_review_api.py tests/test_retry_api.py -v

# Manual smoke test
uv run uvicorn app.main:app --reload &
curl -s -X PUT http://localhost:8000/processes/<id>/jobs/<jobId>/review \
  -H 'Content-Type: application/json' \
  -d '{"fields": [{"path": "/invoiceTotal", "value": "1024.50"}]}' | jq '.confidenceViolations, .reviewedAt'

curl -s -X POST http://localhost:8000/processes/<id>/jobs/<failedJobId>/retry | jq
# then confirm same blobPath by comparing the two jobs' document endpoint output
```

## Definition of Done

- [x] Review partial-patch semantics (leaf-only, path preservation,
      `reviewedAt` first-write-only) fully covered by tests.
- [x] Approve-without-editing verified as clearing a violation.
- [x] Retry verified to reuse the original blob (no duplication) and link
      correctly via `retryOfJobId`.
- [x] Retried job verified to flow through the real worker end-to-end.
