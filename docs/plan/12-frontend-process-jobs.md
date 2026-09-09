# Task 12 — process-jobs Screen

## Status

Done

## Objective

Implement the full filterable jobs table for a single process, with
URL-synced filters, summary counts, and live-updating rows while jobs are
in flight.

## Spec References

- `docs/spec/screen/process-jobs.md` — full screen spec.
- `docs/spec/DATA-MODEL.md` — "Querying for Low-Confidence / Reviewed
  Cases" and "Summary Counts" sections (mirrors backend filter semantics).

## Scope

**In scope:**
- Route `/processes/[id]/jobs`, reached from `process-detail`'s "View all
  jobs" and "needs review" deep link.
- Header: process name (links back), summary counts from
  `GET .../jobs/summary` using the **same filter state** as the table.
- Filter bar: status (multi-select), detected form (multi-select, options
  = union of process's current allowed analyzers + any `detectedForm`
  present in loaded results), needs-review toggle, reviewed tri-state,
  unclassified toggle, file name text search, submitted date range,
  "Clear filters" — every control synced bidirectionally with the URL
  query string (deep-linkable, survives refresh).
- Table: file name, submitted time, status badge, detected form (or "no
  matching form"), field count, needs-review badge, reviewed indicator;
  ordered newest first; capped by `limit` with a "showing first N of M —
  narrow your filters" hint using the summary total.
- Live updates: while any listed job is `queued`/`running`, re-poll every
  2s (backing off to 10s after 60s), stop after 10 minutes or when no
  in-flight jobs remain.
- Row interactions: `succeeded`/unclassified rows → `inference-review`
  (return path preserves this screen's filters); `failed` rows show
  `error` (expandable) + Retry; `queued`/`running` rows show inline
  processing state, not clickable.
- Empty states: distinguish "no jobs yet" vs. "no jobs match these
  filters."

**Out of scope:** the review UI itself (task 13); process-detail's
preview list (task 11, already done — this is the expanded view).

## Dependencies

- Task 07 (filterable jobs list + summary endpoints).
- Task 11 (entry point/navigation source, shared badge/status components
  likely factored out here for reuse).

## Subtasks

1. Implement URL query-string ↔ filter-state synchronization (e.g. via
   `useSearchParams`/`router.replace`).
2. Build the filter bar UI components (multi-selects, toggles, date
   range, text search) wired to the synced state.
3. Wire `GET .../jobs` and `GET .../jobs/summary` with TanStack Query,
   both keyed on the same filter state so they refetch together.
4. Implement the live-update polling condition (any row `queued`/
   `running`) with the documented backoff/stop.
5. Build the table with all documented columns, badges, and the
   "showing first N of M" hint.
6. Wire row click-through with return-path filter preservation (e.g. pass
   the current query string through to `inference-review` and back).
7. Build both empty states.
8. Write Vitest tests: filter bar changes update the URL and trigger a
   refetch with correct params; summary counts render independent of
   `limit`; live-update polling starts/stops based on row statuses;
   both empty states render correctly; Retry action call on a failed row.

## Acceptance Criteria

- **Given** a filter selection, **when** applied, **then** the URL query
  string reflects it and reloading the page preserves the same filtered
  view.
- **Given** more matching jobs than `limit`, **when** the table renders,
  **then** the "showing first N of M" hint appears using the *summary*
  total, not the table's row count.
- **Given** at least one `running` job in the current view, **when** the
  screen is open, **then** it polls every 2s and updates the row in place
  once the job completes, without a full reload.
- **Given** no jobs exist for the process, **when** the screen loads,
  **then** the "no jobs yet" empty state (with a prompt to upload from
  process-detail) is shown, distinct from the "no matches" state.
- **Given** an active filter that matches nothing, **when** applied,
  **then** the "no jobs match these filters" empty state with a "clear
  filters" affordance is shown.
- **Given** a `succeeded` row clicked, **when** navigating to
  `inference-review` and then returning, **then** the same filters are
  still applied.

## Test Instructions

```bash
cd apps/web
npm run test -- process-jobs
npm run dev &
```

Manual walkthrough (needs backend with several jobs seeded, e.g. via task
16's seed script once available, or manually triggering several uploads):
1. Open `process-jobs` for a process with 10+ jobs of mixed status.
2. Apply status + needs-review filters — confirm URL updates and table/
   summary both reflect the filter.
3. Refresh the page — confirm filters persist.
4. Trigger a new upload from `process-detail` while this screen is open in
   another tab — confirm the row appears and updates live within 2-10s.
5. Clear filters — confirm the full unfiltered view returns.

## Definition of Done

- [x] All filter parameters verified against the real backend, both
      individually and combined.
- [x] URL sync verified via manual refresh test.
- [x] Live-update behavior verified to stop after all jobs settle.
- [x] Both empty states verified.
- [x] Return-path filter preservation verified round-trip through
      `inference-review`.
