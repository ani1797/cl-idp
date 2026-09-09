# Task 07 — Jobs Query API

## Status

Done

## Objective

Implement the read side of the jobs container: `GET .../jobs` (filterable
list), `GET .../jobs/{jobId}` (full detail), `GET .../jobs/summary`
(aggregate counts), and `GET .../jobs/{jobId}/document` (blob passthrough
with TIFF→PDF conversion). These back `process-detail`, `process-jobs`,
and `inference-review` on the frontend.

## Spec References

- `docs/spec/DATA-MODEL.md` — "Querying for Low-Confidence / Reviewed
  Cases" section (filters, ordering, list projection), "Summary Counts"
  section, Blob Storage "Display conversion" section.
- `docs/spec/screen/process-jobs.md` — filter bar → query param mapping.
- `docs/spec/api/openapi.yaml` — `/processes/{processId}/jobs`,
  `/processes/{processId}/jobs/summary`, `/processes/{processId}/jobs/
  {jobId}`, `/processes/{processId}/jobs/{jobId}/document`.

## Scope

**In scope:**
- `GET /processes/{processId}/jobs` — supports `status`, `detectedForm`,
  `hasViolations`, `reviewed`, `unclassified`, `fileName`,
  `submittedFrom`/`submittedTo`, `limit` (default 100, max 500), all
  AND-combined, single-partition query; ordered `submittedAt` descending;
  response **projects away `fields`**, returns `fieldCount` computed at
  read time (recursive leaf count, not top-level).
- `GET /processes/{processId}/jobs/summary` — same filters minus `limit`,
  returns `{total, needsReview, failed, unclassified}` via `COUNT`
  aggregate queries.
- `GET /processes/{processId}/jobs/{jobId}` — full document including
  `fields`, `404` if missing or wrong process.
- `GET /processes/{processId}/jobs/{jobId}/document` — streams the blob;
  TIFF converted to PDF server-side via Pillow (multi-page preserved,
  page order unchanged), `Content-Type` reflects what's actually returned
  (`application/pdf` for a TIFF-sourced job); PDF/PNG/JPG served verbatim.

**Out of scope:** review/retry write endpoints (task 08); the worker that
populates these documents (task 06, already done — this task only reads).

## Dependencies

- Task 06 (job documents must exist with real data to query/serve against;
  can be developed against fixture-seeded Cosmos data before 06 is fully
  live, but full acceptance testing needs real worker output).

## Subtasks

1. Implement filter-to-Cosmos-query translation for every parameter
   (`ARRAY_LENGTH(c.confidenceViolations) > 0` for `hasViolations`,
   `IS_NULL(c.reviewedAt)` for `reviewed`, `CONTAINS(LOWER(...))` for
   `fileName`, etc.).
2. Implement `fieldCount` computation (recursive leaf counter over the
   `fields` tree).
3. Implement the list endpoint with projection (exclude `fields` from the
   response model explicitly, not just by convention).
4. Implement the summary endpoint reusing the same filter-translation
   logic against `COUNT` queries.
5. Implement the single-job detail endpoint.
6. Implement the document passthrough with TIFF→PDF conversion (Pillow),
   correct `Content-Type`, and correct 404 handling for a job whose blob
   is missing/deleted.
7. Write integration tests seeding Cosmos with a range of job fixtures
   (various statuses, violations, reviewed/unclassified combinations) and
   asserting each filter in isolation and combined.

## Acceptance Criteria

- **Given** 5 jobs with mixed statuses, **when**
  `GET .../jobs?status=succeeded&status=failed` is called, **then** only
  those two statuses are returned, ordered newest first.
- **Given** jobs with and without outstanding violations, **when**
  `GET .../jobs?hasViolations=true` is called, **then** only jobs with a
  non-empty `confidenceViolations` are returned.
- **Given** the same dataset, **when**
  `GET .../jobs/summary?hasViolations=true` is called, **then** `total`
  reflects the full matching count even if it exceeds any `limit` used
  elsewhere.
- **Given** a job with 50 nested leaf fields, **when** listed, **then**
  `fieldCount` is 50, and the list response body contains no `fields` key.
- **Given** a job ID, **when** `GET .../jobs/{jobId}` is called, **then**
  the full `fields` tree is present and matches what the worker persisted.
- **Given** a job sourced from a 3-page TIFF, **when**
  `GET .../jobs/{jobId}/document` is called, **then** the response
  `Content-Type` is `application/pdf` and the PDF has exactly 3 pages in
  original order.
- **Given** a job sourced from a PDF, **when** the document endpoint is
  called, **then** the bytes are served verbatim with `Content-Type:
  application/pdf`.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run pytest tests/test_jobs_query_api.py tests/test_document_endpoint.py -v

# Manual smoke test
uv run uvicorn app.main:app --reload &
curl -s "http://localhost:8000/processes/<id>/jobs?hasViolations=true" | jq
curl -s "http://localhost:8000/processes/<id>/jobs/summary" | jq
curl -s "http://localhost:8000/processes/<id>/jobs/<jobId>" | jq '.fields'
curl -s "http://localhost:8000/processes/<id>/jobs/<jobId>/document" -o out.pdf && file out.pdf
```

## Definition of Done

- [x] Every filter parameter verified in isolation and in combination.
- [x] `fieldCount` verified against a fixture with known nested-leaf count.
- [x] Summary counts verified to exceed `limit` in a test with more
      matching jobs than the list's cap.
- [x] TIFF→PDF conversion verified to preserve page count and order.
- [x] List response verified to omit `fields` (checked structurally, not
      just visually).
