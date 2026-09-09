# Task 27 — Expose Average Confidence on Jobs (Regardless of Review Status)

## Status

Done

## Why This Exists

The user asked: "I should be able to see the average confidence number
regardless of whether it requires 'needs review' or not."

Task 23 (`docs/plan/23-aggregate-confidence-review-gate.md`) introduced an
*internal* aggregate-confidence calculation
(`compute_confidence_violations()` in
`apps/api/app/worker/result_mapping.py`) purely to decide whether a job's
`confidenceViolations` list should be populated (i.e. whether the job
"needs review"). That aggregate number itself was never persisted,
returned via the API, or shown in the UI — so a job that passed the
aggregate-confidence gate (no review needed) had no way to show its actual
confidence level, and a job that failed the gate only showed which fields
were below threshold, not the overall number.

This task exposes that aggregate as a first-class `averageConfidence`
field on every `Job`, always computed and shown when the job has
extracted fields — independent of `needsReview`/`confidenceViolations`
status.

## What Changed

- **`apps/api/app/models/public.py`**: added `averageConfidence: float |
  None` to the `Job` model (between `fieldCount` and
  `confidenceViolations`).
- **`apps/api/app/routers/jobs.py`**: added `compute_average_confidence()`
  and `_collect_leaf_confidences()`, following the exact same **read-time
  computed field** pattern already established for `fieldCount` (derived
  from persisted `fields` on every read via `with_computed_field_count()`,
  not persisted separately). This means:
  - No worker-side persistence changes were needed —
    `apps/api/app/worker/main.py`'s `finalize_success()` is unchanged.
  - No data migration is needed for already-persisted job documents; the
    value is computed correctly on any read since `fields` themselves are
    already persisted.
  - The computation is independent from (does not reuse) task 23's
    internal `result_mapping.py` aggregate, to avoid touching
    already-verified code; both compute the same mathematical value
    (arithmetic mean of all present confidence-bearing leaf fields).
- **`apps/api/app/routers/trigger.py`**: added `averageConfidence=None` to
  the initial job-creation constructor (freshly queued job, no fields
  yet).
- **`docs/spec/api/openapi.yaml`**: added `averageConfidence` (nullable
  number, 0-1) to the `Job` schema.
- **`packages/shared/src/generated/api.ts`**: regenerated from the updated
  OpenAPI spec (`npm run generate` in `packages/shared`).
- **`apps/web/components/job-history-ui.tsx`**: added
  `formatConfidencePercent()` and `AverageConfidenceValue` shared helpers.
- **`apps/web/components/process-jobs-page.tsx`**: added a "Confidence"
  column to the jobs table, shown for every job regardless of
  `needsReview` status.
- **`apps/web/components/process-detail-page.tsx`**: added the same
  "Confidence" column to the recent-jobs preview table.
- **`apps/web/components/inference-review-page.tsx`**: added an "Average
  confidence" summary next to the job status badge in the review header.

## Verification

- Backend: `cd apps/api && uv run pytest -m "not live"` — 70/70 passed
  (69 pre-existing + 1 new dedicated unit test for
  `compute_average_confidence`, covering `None`/empty input, missing
  confidence exclusion, and nested field traversal). Added targeted
  assertions to `test_jobs_query_api.py` confirming `averageConfidence` is
  returned by both `listJobs` and `getJob` for a job with nested fields,
  and specifically confirming it is populated for the `aggregate_pass`
  fixture job (which has `confidenceViolations: []`, i.e. does NOT need
  review) — directly covering the user's ask.
- Frontend: `cd apps/web && npm run lint && npx tsc --noEmit && npm run
  test` — all clean, 37/37 tests passed (added a new test asserting the
  confidence column renders correctly for a needs-review job, a
  no-review-needed job, and a job with no confidence data at all).
- Live system: rebuilt containers (`docker compose --profile app up -d
  --build api worker web`), re-ran `apps/api/scripts/seed.py` against the
  running stack, and confirmed via `curl` that `GET
  /processes/{id}/jobs` returns real, non-null `averageConfidence` values
  (e.g. `0.78`, `0.70`) for succeeded jobs with fields — including jobs
  both with and without `confidenceViolations` — and `null` for jobs with
  no extracted fields (unclassified doc, or a form type that returns no
  structured fields).
