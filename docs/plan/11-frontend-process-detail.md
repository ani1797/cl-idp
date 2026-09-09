# Task 11 — process-detail Screen

## Status

Done

## Objective

Implement the process overview screen: config summary with routing-
analyzer status polling, the upload panel with trigger + job-status
polling, and the recent-jobs history preview.

## Spec References

- `docs/spec/screen/process-detail.md` — full screen spec.
- `docs/spec/DECISIONS.md` — #26 (UI polling intervals/backoff/timeout).

## Scope

**In scope:**
- Header: name, description, allowed analyzers (denormalized names),
  threshold as %, owner email, routing analyzer status with Edit/Delete
  actions; while `building`, poll `GET /processes/{id}` every 5s, back off
  to 10s after 60s, stop after 10 minutes with a manual-refresh prompt;
  `failed` shows `routingAnalyzerError` inline.
- Delete: confirmation dialog naming the process, warning about cascading
  deletion, then `DELETE /processes/{id}` → back to `process-list`.
- Upload panel: drag-and-drop/file picker with client-side type/size
  checks mirroring backend limits (immediate feedback before any network
  call); disabled with an explanatory message while routing analyzer is
  not `ready`; on upload, `POST .../trigger`, then poll
  `GET .../jobs/{jobId}` every 2s, backing off to 10s after 60s, stopping
  after 10 minutes with manual refresh; on completion, auto-navigate to
  `inference-review` except for `unclassified` (shown inline instead).
- Job history preview: most recent jobs (file name, submitted time,
  status, detected form), row → `inference-review`; failed rows show
  `error` + Retry action; "needs review"/"no matching form" badges;
  `hasViolations=true` toggle; "View all jobs" → `process-jobs`.

**Out of scope:** the full filterable jobs table (task 12, though the
preview here is a strict subset using the same list endpoint); the
two-pane review UI itself (task 13, this screen only links to it).

## Dependencies

- Task 04 (routing analyzer status transitions to observe).
- Task 05 (trigger endpoint).
- Task 06 (worker, so triggered jobs actually complete for the polling
  demo to be meaningful).
- Task 10 (shared `ProcessForm`/list patterns, Edit link target).

## Subtasks

1. Build the header section with status polling (TanStack Query
   `refetchInterval` with the documented backoff/stop behavior).
2. Build the Delete confirmation flow.
3. Build the upload panel with client-side validation, trigger call, and
   job-status polling with the same backoff pattern.
4. Implement post-completion navigation logic (auto-navigate vs. inline
   unclassified message).
5. Build the job history preview list with badges and the "needs review"
   filter toggle, and the Retry action for failed rows.
6. Write Vitest component tests mocking the API client for: building →
   ready transition rendering, failed status + error display, upload
   validation rejecting an oversized/wrong-type file client-side, job
   polling reaching `succeeded` and triggering navigation, unclassified
   inline message, failed job Retry action call.

## Acceptance Criteria

- **Given** a process with `routingAnalyzerStatus: "building"`, **when**
  the screen is open, **then** it polls every 5s and updates to `ready`
  in place once the backend transitions, without a full page reload.
- **Given** a process with `routingAnalyzerStatus: "failed"`, **when**
  displayed, **then** `routingAnalyzerError` text is visible inline.
- **Given** a `ready` process, **when** a valid document is uploaded,
  **then** the panel shows a processing state, polls every 2s, and on
  `succeeded` (non-unclassified) auto-navigates to `inference-review` for
  that job.
- **Given** the uploaded document is classified as `unclassified`,
  **when** the job completes, **then** the panel shows the "didn't match
  any form" message inline instead of navigating away.
- **Given** an oversized file selected via the picker, **when** chosen,
  **then** an inline error appears immediately with **no** network call
  made (verify via network inspector/mock assertion).
- **Given** a failed job in the history preview, **when** displayed,
  **then** its `error` message and a Retry button are shown instead of a
  review link, and clicking Retry calls the retry endpoint.

## Test Instructions

```bash
cd apps/web
npm run test -- process-detail
npm run dev &
```

Manual walkthrough (needs full backend stack from tasks 03-06 running):
1. Create a process, land on its detail page — confirm `building` shows,
   then transitions to `ready` within the CU provisioning time.
2. Upload `samples/invoice.pdf` — confirm processing state, then
   navigation to `inference-review`.
3. Upload an unrelated document (e.g. a random text-heavy PDF not matching
   any configured analyzer) — confirm the inline "didn't match" message.
4. Upload an oversized/invalid file — confirm client-side rejection with
   no network call.

## Definition of Done

- [x] Polling behaviors (both routing-analyzer and job) verified to
      respect the documented intervals/backoff/10-minute stop.
- [x] Upload validation verified to block invalid files before any network
      call.
- [x] Auto-navigation and unclassified-inline-message paths both verified.
- [x] Job history preview badges verified against real violation/
      unclassified data.
- [x] Vitest tests passing; manual walkthrough against real backend
      completed.
