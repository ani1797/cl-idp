# Task 31 — Multi-Document Upload Queue on `process-detail`

## Status

Done

## Why This Exists

The `process-detail` upload panel only ever accepted one file at a time:
`validateUpload` rejected a selection of more than one file, the file
input lacked `multiple`, the dropzone disabled itself while a single job
was in flight, and a successful trigger auto-navigated to
`inference-review`. Users testing several documents against a process had
to upload, wait for the result, navigate back, and repeat — one at a
time. The user asked for the ability to select/drop several documents at
once and have them queue up for processing.

## Approach: Client Fan-Out (No Backend Changes)

`POST /processes/{processId}/trigger` (`apps/api/app/routers/trigger.py`)
still rejects anything but exactly one file per request — unchanged, and
the OpenAPI spec (`docs/spec/api/openapi.yaml`) / generated TS client
(`packages/shared/src/generated/api.ts`) are untouched. Instead, the
browser fans a multi-file selection out into N individual
`POST .../trigger` calls through a client-managed, concurrency-limited
queue, and reconciles status for the whole batch via one aggregated
`GET /processes/{processId}/jobs` poll rather than one `GET .../jobs/{id}`
poll per queued item (the worker (`apps/api/app/worker/main.py`) is
serial — `max_messages=1` — so a large batch still drains one job at a
time server-side; the queue UI must make "queued, waiting its turn" look
visually distinct from "processing" so this doesn't look stalled).

Explicit decisions made with the user up front (via `ask_user`) and
honored throughout:

| Decision | Choice |
|---|---|
| Fan-out location | **Client-side** — no backend/OpenAPI changes |
| Max files per selection | 100 (silently truncated beyond that, surfaced as a notice) |
| Concurrent uploads | 5 at a time |
| Invalid files in a mixed selection | Skip-and-report; valid files in the same selection still queue |
| Post-upload navigation | **Never auto-navigate** — always show the queue list with per-row links to `inference-review` |
| Server-side batch grouping | None — no new `batchId` concept; the batch is purely a client-side-session construct |
| Queue persistence | Ephemeral — an in-memory `queueItems` array, lost on reload (no `localStorage`/server persistence) |

## Scope

**In scope:**

- `apps/web/lib/upload-queue.ts` — shared types/logic: queue item
  lifecycle (`pending → uploading → queued → running → succeeded |
  unclassified | failed`, or `rejected` for client-side-validation
  failures that never left the browser), `validateFile`,
  `partitionSelection` (splits a raw `FileList`/`File[]` into
  accepted/rejected/overflow), `summarizeQueue`, and
  `mapJobToQueueUpdate` (maps a polled `Job` onto queue-item field
  updates).
- `apps/web/components/upload-queue.tsx` — presentational
  `UploadQueuePanel`: per-row status badge, progress summary, "View
  review" (succeeded/unclassified rows with a `jobId`), "Retry" (failed
  rows that still hold their original `File`), "Clear completed", "Clear
  all".
- `apps/web/components/process-detail-page.tsx` — rewired upload card:
  `multiple` file input, `aria-label="Choose documents"`, a
  concurrency-limited upload scheduler effect (promotes up to
  `UPLOAD_CONCURRENCY` `pending` items to `uploading` and fires
  `api.triggerJob` per item), an aggregated `queueStatusQuery`
  (`api.listJobs`) + reconciliation effect in place of the old per-job
  `getJob` poll, a manual-refresh-after-timeout effect anchored on the
  earliest in-flight item, and handlers wiring the panel's actions.
  `retryMutation` (the existing "Recent jobs" history table's per-row
  retry, for a server-side job failure) now pushes a synthetic queue item
  so a history-table retry shares the same panel/polling as a fresh
  upload.
- Updated `apps/web/components/process-detail-page.test.tsx`,
  `apps/web/e2e/helpers.ts`, `apps/web/e2e/live-suite.spec.ts` for the new
  behavior (multi-file selection, concurrency cap, mixed valid/invalid
  selections, no auto-navigation, retry-requeues).
- Spec updates: `docs/spec/screen/process-detail.md`,
  `docs/spec/features/pipeline-trigger-api.md` (clarifies the API is
  still single-file-per-request; the UI fans out), `DEMO.md`.

**Out of scope (explicitly deferred per the decisions above):**

- Any backend/OpenAPI multi-file upload endpoint or server-side batch
  grouping concept.
- Persisting the queue across reloads/tabs.
- Changing worker concurrency (`max_messages=1` stays serial).

## Key Design Points

- **Aggregated polling over per-job polling** — a `useQueries`-per-item
  approach was rejected because a 100-file batch would mean up to 100
  `GET .../jobs/{id}` requests per poll tick. One `api.listJobs(processId,
  { limit })` call per tick is reconciled against in-flight queue items by
  `job.id === item.jobId` instead. `queueStatusLimit` is sized as
  `min(500, max(inFlightCount + 10, RECENT_JOBS_LIMIT))` (the API's
  `limit` query param caps at `le=500`).
- **Terminal-transition-gated invalidation** — the reconciliation effect
  only invalidates the "Recent jobs" preview query when something in the
  batch actually reached a terminal state, not on every poll tick, so a
  large in-progress batch doesn't force that query to refetch constantly.
- **Two distinct "retry" concepts** — the queue panel's "Retry" (a
  client-upload failure; re-queues the same in-memory `File`) and the
  history table's "Retry" (a server-side job failure, no `File` object
  available; calls `POST .../jobs/{jobId}/retry` over the already-stored
  document) are different code paths that both terminate in the same
  queue panel.
- **`setState`-in-effect lint rule** — this repo's ESLint config flags
  direct synchronous `setState` calls inside a `useEffect` body
  (`react-hooks/set-state-in-effect`). Every effect-driven state update
  introduced here (the scheduler's "mark as uploading", the reconciler's
  queue-item merge, the manual-refresh timers) follows this file's
  existing convention of deferring the call into a `window.setTimeout(...,
  0)` (cleaned up via the effect's return function), matching the
  pre-existing `processPollingStartedAt`/`showAnalyzerManualRefresh`
  effects.

## Test Instructions

```bash
cd apps/web
npx vitest run lib/upload-queue.test.ts        # 16 unit tests on the shared lib
npx vitest run components/process-detail-page.test.tsx  # 9 tests covering the rewired page
npx vitest run                                  # full suite — 100/100 passing
npx tsc --noEmit
npm run lint
```

Live/E2E (`apps/web/e2e/live-suite.spec.ts`, requires the full stack up
per `15a-e2e-live-suite-local.md`): happy path now asserts the queue
row's "View review" link instead of auto-navigation; a new "multi-file
selection" test uploads two valid files plus one invalid file in a
single selection and asserts the invalid one is rejected inline while
both valid ones queue, upload, and succeed without navigating away from
`process-detail`.

## Definition of Done

- [x] `lib/upload-queue.ts` written and unit-tested in isolation.
- [x] `components/upload-queue.tsx` presentational panel written.
- [x] `process-detail-page.tsx` rewired: multi-file input, concurrency
      scheduler, aggregated polling/reconciliation, retry wiring, no
      auto-navigation, no stale references to removed single-job state.
- [x] `process-detail-page.test.tsx` updated and passing (9/9).
- [x] Full `apps/web` Vitest suite passing (100/100), `tsc --noEmit`
      clean, `npm run lint` clean.
- [x] `e2e/helpers.ts` / `e2e/live-suite.spec.ts` updated for multi-file
      selection and no-auto-navigate assertions.
- [x] `docs/spec/screen/process-detail.md`,
      `docs/spec/features/pipeline-trigger-api.md`, `DEMO.md` updated.
- [x] This task file created and registered in `docs/plan/README.md`.
- [x] Verified live against the local Docker Compose stack via Playwright
      MCP browser automation: multi-file selection correctly rejects an
      invalid file client-side, queues/uploads valid files up to the
      concurrency cap, reconciles terminal states (succeeded/unclassified/
      failed+retried) via the aggregated `listJobs` poll, never
      auto-navigates away from `process-detail`, and the "View review"
      links work. No source changes were needed.
- [x] Deployed to the live Azure environment
      (`rg-cl-idp-prod-eus2`/`clidpprod-web`): built the web image locally
      (`docker build --build-context shared=./packages/shared -f
      apps/web/Dockerfile apps/web`, context must be `apps/web`, not the
      repo root), pushed a new unique tag to `clidpprodacr`, and re-ran
      `az deployment sub create` with that `webImageTag` (keeping the
      existing `apiImageTag` unchanged, since this feature is web-only).
      Confirmed via browser against `https://clidpprod-web.azurewebsites.net`
      that the new "Drag and drop documents here" / "Choose documents"
      multi-upload UI is live.
