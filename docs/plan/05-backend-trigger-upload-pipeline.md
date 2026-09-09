# Task 05 — Trigger & Upload Pipeline

## Status

Done

## Objective

Implement `POST /processes/{processId}/trigger`: synchronous upload
validation, blob write, Cosmos job document creation, and queue message
enqueue. This is the producer half of the async job pattern; task 06
implements the consumer.

## Spec References

- `docs/spec/features/pipeline-trigger-api.md` — full feature, especially
  Request Contract (validation order, limits, readiness check).
- `docs/spec/DATA-MODEL.md` — `jobs` container document shape, Blob Storage
  path convention, Queue message shape.
- `docs/spec/api/openapi.yaml` — `/processes/{processId}/trigger` schema.

## Scope

**In scope:**
- `POST /processes/{processId}/trigger` — multipart file upload endpoint:
  1. `404` if process doesn't exist.
  2. `409` if `routingAnalyzerStatus != "ready"`.
  3. `400` (shared `Error` schema) if: not exactly one file, content-type/
     extension not in {PDF, PNG, JPG, TIFF}, size > 20 MB, page count > 20
     (PDF page count via a lightweight PDF parser; image page count is
     always 1 except multi-page TIFF — count TIFF frames via Pillow).
     **All checks run before any blob/Cosmos/queue write.**
  4. On pass: write blob to `{processId}/{jobId}/{originalFileName}`,
     create the `jobs` Cosmos document with `status: "queued"`,
     `submittedAt`, a fresh `correlationId`, enqueue the denormalized queue
     message (per `DATA-MODEL.md`'s Queue section — includes
     `routingAnalyzerId`, `confidenceThreshold`, `ownerEmail` read from the
     process document at trigger time).
  5. Returns `202` with body `{"jobId": "..."}` per `openapi.yaml`'s
     `JobRef` schema (just the ID, not a full `Job` document — the client
     polls `GET .../jobs/{jobId}` for status/results).
- Correlation ID generation and propagation onto the job document and
  queue message (observability groundwork for task 14).
- Integration tests covering every validation failure mode and the happy
  path (blob exists, Cosmos doc exists with `status: "queued"`, queue has
  exactly one message with correct shape).

**Out of scope:** the worker that dequeues and calls CU (task 06);
`GET .../jobs/{jobId}` and other job read endpoints (task 07); retry
(task 08, which reuses this same blob-write-then-enqueue pattern but is a
distinct endpoint).

## Dependencies

- Task 02 (Blob/Queue wrappers).
- Task 03 (process existence + `routingAnalyzerStatus` check).

## Subtasks

1. Implement multipart upload parsing and the ordered validation chain
   (existence → readiness → file checks), each failure short-circuiting
   before any write.
2. Implement PDF page counting (e.g. `pypdf`) and TIFF frame counting
   (Pillow `Image.n_frames`).
3. Implement blob write with the exact path convention.
4. Implement Cosmos job document creation with all required fields
   populated (including internal-only `blobPath`, `contentType`,
   `correlationId`).
5. Implement queue message enqueue with the denormalized shape.
6. Wire correlation ID generation and propagate it through all three
   writes.
7. Write integration tests for: missing process (`404`), not-ready process
   (`409`), wrong content-type (`400`), oversized file (`400`), too many
   pages (`400`), multiple files in one request (`400`), and the happy
   path assertion (blob readable back, Cosmos doc has `status: "queued"`,
   queue message present and correctly shaped, and — critically — that no
   blob/Cosmos/queue artifact exists after any `400` rejection).

## Acceptance Criteria

- **Given** a process with `routingAnalyzerStatus: "ready"`, **when** a
  valid 2-page PDF under 20 MB is POSTed to `.../trigger`, **then** the
  response is `202` with a job ID, a blob exists at
  `{processId}/{jobId}/{fileName}`, a Cosmos job document exists with
  `status: "queued"`, and exactly one queue message references that job.
- **Given** a process with `routingAnalyzerStatus: "building"`, **when** a
  valid file is POSTed, **then** the response is `409` and no blob/Cosmos/
  queue artifact is created.
- **Given** a 25 MB file, **when** POSTed, **then** the response is `400`
  with a message naming the size limit, and no artifacts are created.
- **Given** a 25-page PDF, **when** POSTed, **then** the response is `400`
  naming the page limit, and no artifacts are created.
- **Given** a `.docx` file, **when** POSTed, **then** the response is `400`
  naming the unsupported type, and no artifacts are created.
- **Given** two files in one multipart request, **when** POSTed, **then**
  the response is `400`, and no artifacts are created.
- **Given** a valid TIFF with 22 frames, **when** POSTed, **then** the
  response is `400` (page limit applies to TIFF frames too).

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run pytest tests/test_trigger_api.py -v

# Manual smoke test
uv run uvicorn app.main:app --reload &
curl -s -X POST http://localhost:8000/processes/<id>/trigger \
  -F "file=@samples/invoice.pdf" | jq

# Confirm artifacts
az storage blob list --connection-string "$AZURITE_CONN" -c documents  # or Storage Explorer
az storage message peek --connection-string "$AZURITE_CONN" -q jobs
```

Confirm in the Cosmos emulator data explorer that the job document exists
with `status: "queued"` and the exact fields from `DATA-MODEL.md`.

## Definition of Done

- [x] All validation failure modes tested and produce zero side effects.
- [x] Happy path produces exactly one blob, one Cosmos doc, one queue
      message, all correctly correlated by `jobId`/`correlationId`.
- [x] Page-count checks work for both PDF and multi-frame TIFF.
- [x] Response shape matches `openapi.yaml` exactly.
