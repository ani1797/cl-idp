# Task 23 — Aggregate Confidence Review Gate

## Status

Done

## Objective

Change the meaning of `need review` so a succeeded job requires review only
when the aggregate confidence of its extracted fields is below the business
process's configured confidence threshold. The current worker marks each
individual leaf below the threshold as a violation, which can incorrectly
mark a job as needing review even when the document's combined confidence is
above the threshold.

The proposed aggregate is the arithmetic mean of confidence-bearing leaf
fields. Leaves whose confidence is absent remain excluded from the aggregate,
consistent with the existing rule that a missing confidence is not zero. The
aggregate is evaluated once after the complete fields tree has been mapped.

## Spec References

- `docs/spec/DATA-MODEL.md` — field confidence semantics, job review state,
  and `confidenceViolations`.
- `docs/spec/features/pipeline-trigger-api.md` — confidence threshold
  evaluation and notification behavior.
- `docs/spec/features/onboarding-business-process.md` — process-level
  overall confidence threshold.
- `docs/spec/screen/process-jobs.md` and
  `docs/spec/screen/process-detail.md` — needs-review badges and counts.
- `docs/spec/api/openapi.yaml` — job response and query semantics for
  outstanding confidence violations.

## Scope

**In scope:**

- Define and document aggregate confidence as the arithmetic mean of all
  mapped leaf confidence values that are present.
- Update result mapping to traverse nested arrays/objects once, collect
  confidence-bearing leaves, and compare the aggregate to the process
  threshold after mapping the complete result.
- Preserve missing-confidence behavior: absent confidence values do not
  contribute to the mean and do not independently create a review condition.
- Populate `confidenceViolations` only when the aggregate is below the
  threshold. When review is required, retain the individual below-threshold
  leaf paths so the review UI can identify actionable fields; when the
  aggregate meets or exceeds the threshold, persist an empty list and treat
  the job as not needing review.
- Keep review save behavior unchanged: approving or editing a listed leaf
  clears only that path, and `reviewedAt` remains the audit marker for any
  review activity.
- Ensure worker notifications, jobs-list filters, summary counts, detail
  badges, and inference-review field highlighting all continue to derive
  from the corrected outstanding-violations state.
- Update the relevant documentation and tests so the aggregate rule is the
  shared contract rather than an implementation-only detail.

**Out of scope:**

- Changing the process threshold field or its UI representation.
- Adding a new per-field threshold or a new user-configurable aggregation
  mode.
- Recomputing aggregate confidence after human review; review is still a
  partial acknowledgement/correction operation over the persisted result.
- Changing unclassified, zero-field, failed, retry, or document-viewer
  behavior.

## Dependencies

- Task 06 (worker inference pipeline and result persistence).
- Task 07 (jobs query and summary behavior).
- Task 08 (review endpoint and violation clearing).
- Task 13 (inference-review rendering).

## Subtasks

1. Reconcile the confidence language in the data-model, pipeline, and screen
   specs with the aggregate rule. Explicitly document the empty case: a
   classified result with no confidence-bearing leaves has no aggregate and
   does not require review.
2. Refactor `compute_confidence_violations` (or its owning mapping helper)
   to collect nested leaf confidences, exclude `None`, calculate the mean,
   compare it once to the threshold, and return actionable low-confidence
   paths only when the aggregate is below threshold.
3. Add focused mapping tests covering:
   - one low leaf with an overall mean below threshold;
   - mixed low/high leaves whose mean is at or above threshold and therefore
     produce no violations;
   - nested array/object leaves;
   - missing confidence values excluded from both mean and violations;
   - all confidence values missing or no fields producing no violations;
   - threshold boundary behavior (`aggregate == threshold` does not require
     review).
4. Update worker/API tests to verify that notification dispatch is gated by
   the corrected violations list, and that jobs summary/list `needsReview`,
   `hasViolations`, and row badges match aggregate outcomes.
5. Update frontend tests only where they encode the old assumption that any
   individual low-confidence field makes the job need review. Preserve the
   field-level rendering behavior for jobs that are actually gated for
   review.
6. Run the focused backend and frontend suites, then perform a manual smoke
   test with two real results: one whose aggregate is above threshold despite
   a low leaf, and one whose aggregate is below threshold. Confirm job list,
   summary, notification/log behavior, and review screen state agree.

## Acceptance Criteria

- **Given** a succeeded classified job with confidence values whose arithmetic
  mean is below the process threshold, **when** the worker persists the
  result, **then** `confidenceViolations` contains the below-threshold leaf
  paths and the job appears as needing review.
- **Given** a succeeded classified job with at least one below-threshold leaf
  but an arithmetic mean equal to or above the process threshold, **when** the
  worker persists the result, **then** `confidenceViolations` is empty and
  the job does not appear as needing review.
- **Given** a nested fields tree, **when** aggregate confidence is computed,
  **then** every confidence-bearing leaf is included exactly once regardless
  of object or array nesting.
- **Given** a leaf without a confidence score, **when** aggregate confidence
  is computed, **then** it is excluded rather than treated as zero and never
  independently creates a violation.
- **Given** a classified result with no confidence-bearing leaves, **when**
  it completes, **then** it succeeds without confidence violations or a
  review requirement.
- **Given** a job that is not aggregate-gated for review, **when** jobs list,
  summary, process-detail history, and notifications are evaluated, **then**
  none reports an outstanding need for review for that job.
- **Given** an aggregate-gated job, **when** a reviewer opens it, **then** the
  existing field-level violation highlighting and approve/edit workflow still
  operate for the returned violation paths.

## Test Instructions

```bash
cd apps/api
uv run pytest tests/test_result_mapping.py tests/test_worker_pipeline.py \
  tests/test_review_api.py tests/test_jobs_query_api.py -v

cd ../web
npm run test -- inference-review process-jobs process-detail
```

For the manual check, use a process with a threshold that makes one fixture's
mean fall above the threshold despite a low leaf, and another fixture's mean
fall below it. Confirm the persisted `confidenceViolations`, jobs summary
`needsReview`, list badge/filter result, and notification behavior. Open the
below-threshold job in `inference-review` and confirm the existing leaf-level
review actions remain available.

Manual check status for this implementation:

- Not run against a live CU-backed stack in this environment.
- Verified instead through focused automated coverage:
  - backend mapping tests for aggregate-below, aggregate-at-or-above,
    nesting, missing-confidence, empty-input, and threshold-boundary cases;
  - worker persistence/notification tests for aggregate-below vs
    aggregate-meets-threshold outcomes;
  - API/query tests for jobs list and summary `needsReview` /
    `hasViolations`;
  - frontend review/list/detail tests confirming highlight/badge behavior is
    driven by persisted `confidenceViolations`.

## Definition of Done

- [x] Aggregate confidence rule is documented consistently across the
      affected specs and API-facing behavior.
- [x] Backend mapping computes the aggregate over present leaf confidences
      and gates violations on the aggregate threshold.
- [x] Focused mapping tests cover nesting, missing scores, empty input, and
      threshold boundary behavior.
- [x] Worker notification and jobs query/summary behavior are verified for
      both aggregate-above and aggregate-below cases.
- [x] Frontend behavior is verified for both a job that does and does not
      require review, with no regression to approve/edit flows.
- [ ] Manual smoke test against the real running system is complete and the
      observed persisted/API/UI behavior is recorded here.
