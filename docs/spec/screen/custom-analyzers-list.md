---
page: custom-analyzers-list
---

## Status: not yet implemented

No `/custom-analyzers` route/page exists in `apps/web`, no
`/custom-analyzers` router exists in `apps/api`, and no app-owned analyzer
table exists yet. This spec is written together with
`docs/spec/screen/analyzer-training.md` and their two backing plan docs
(`docs/plan/24-custom-analyzer-authoring-api.md`,
`docs/plan/25-custom-analyzer-authoring-ui.md`) as one coherent design —
see `analyzer-training.md`'s "Design principle" section for why this
revision uses an app-owned **draft** record (schema + samples + test
history) instead of treating the live CU analyzer as the only state:
without draft persistence, an admin loses all schema/sample work on every
reload, and CU's own analyzer list doesn't carry a "someone started this
but hasn't trained it yet" state at all.

Landing screen for administering the app's **custom, schema-based Content
Understanding analyzers** — the analyzers admins train and that
`process-form` offers alongside the curated prebuilt catalog. Entry point
into the `analyzer-training` workbench. Route: `/custom-analyzers`.

- **Navigation**: `apps/web/components/app-shell.tsx`'s real sidebar today
  has only **Processes** (active) and a disabled **Settings** placeholder
  — there is no top-level **Jobs** item; job lists live nested under a
  specific process at `/processes/{id}/jobs`. Add **Custom Analyzers** as a
  new, enabled top-level `SidebarItem` alongside **Processes**, above the
  disabled **Settings** placeholder, using the same active-route
  highlighting pattern (`isJobsRoute`-style path matcher) already used
  there. Breadcrumb root for both this screen and `analyzer-training` is
  `Custom Analyzers`.

- **Layout**: page header with title, short explanation, and a **New
  Analyzer** action. Under it, compact summary cards (Draft / Training /
  Ready / Failed counts), then a filter/search bar, then a table (stacked
  cards on small screens).

- **List content**: rows ordered by `updatedAt` descending. Columns:
  - analyzer **name** plus immutable CU-facing **ID**
  - **status**: `draft` / `training` / `ready` / `failed` (see below)
  - **base analyzer** (today always `prebuilt-document`)
  - **field count** (top-level fields in the current draft/published
    schema) and **sample document count**
  - **used by N processes** — real data, computed from the app's own
    process store (`allowedAnalyzerIds`), not from CU
  - **last updated** timestamp
  - a status-appropriate **primary action**

  Short description stays in the first column rather than adding another
  column.

- **Status semantics**:
  - `draft`: a metadata/schema draft exists in the app, but either no
    training run has ever been submitted, or the draft has unpublished
    changes relative to what's currently live. Primary action:
    **Continue Training**.
  - `training`: the app has submitted or replaced the live CU analyzer and
    is waiting on CU's terminal status (the same `wait_for_analyzer_
    terminal_status` lifecycle already used for routing analyzers).
    Primary action: **View Progress**.
  - `ready`: the latest publish succeeded; the analyzer is eligible for
    `GET /analyzers` / `process-form` selection unless separately
    deprecated. Primary action: **Edit Schema** (retraining happens from
    the workbench, in place, same ID).
  - `failed`: the last publish attempt ended in error. Primary action:
    **View Error**, opening `analyzer-training` with the CU error inline
    and **Retry Publish** available.

- **Creation flow**: **New Analyzer** opens a lightweight modal — **Name**,
  **Analyzer ID**, **Base analyzer** (fixed to `prebuilt-document`),
  **Short description** — with client-side ID validation (alphanumeric +
  underscore only, no hyphens; blocks `idp_*` prefix / `other` /
  `createdBy: cl-idp` collision). Submitting calls
  `POST /custom-analyzers` to create the draft shell, then navigates to
  `analyzer-training` pre-seeded with those values and an empty schema/
  sample set. Everything past this hand-off (fields, samples, saving,
  testing, publishing) belongs to the workbench.

- **Search and filters**: free-text search over name/ID/description, plus
  status filters (All/Draft/Training/Ready/Failed), mirrored in the URL
  query string. First implementation fetches the full list and filters
  client-side, consistent with expected demo scale; the API may still
  accept `q`/`status` params for future-proofing.

- **Empty states**: explain what a custom analyzer is when the list is
  empty (and that prebuilt analyzers remain available separately in
  process setup); offer **Clear filters** when a filter matches nothing.

- **Row interactions**:
  - row click / `ready` row button → **Edit Schema** in `analyzer-training`
  - `draft` row button → **Continue Training**
  - `training` row button → **View Progress**
  - `failed` row button → **View Error**
  - overflow actions: **Delete**, **Deprecate**, **Copy analyzer ID**

- **Delete / deprecate / stale references**, consistent with
  `process-form`'s existing stale-analyzer handling:
  - if `referencedProcessCount == 0`, allow **Delete** after confirmation
    (wraps `CuClient.delete_analyzer` for any published record, plus the
    draft's own metadata/sample cleanup)
  - if one or more processes still reference it, block hard delete and
    offer **Deprecate** instead — hides the analyzer from `GET /analyzers`
    without touching existing processes' stored `allowedAnalyzerIds`
  - if an analyzer is nevertheless removed out-of-band (directly in CU),
    any process still carrying that ID behaves exactly like today's stale
    `allowedAnalyzerIds` handling already implemented in `process-form.tsx`
    (`StaleAnalyzerChip`): a flagged removable chip, and the next routing
    analyzer rebuild fails until the process is repaired

- **Retraining and broken replacements**: retraining does not silently
  break every process using a `ready` analyzer. If a `ready` analyzer is
  retrained in place and the attempt fails, the row shows `failed`, but the
  last successfully published revision remains the one exposed to existing
  processes until a later successful replacement — the failure is an admin
  action item, not an automatic outage.

- **Status polling**: while any visible row is `training`, poll
  `GET /custom-analyzers` every 5 seconds, updating rows in place; stop
  once no `training` rows remain or after 10 minutes, then show a manual
  refresh affordance (same convention as `process-detail`).

- **Data/API needs**: full shape specified in
  `docs/plan/24-custom-analyzer-authoring-api.md`; at minimum this screen
  needs:
  - `GET /custom-analyzers` — list drafts and published analyzers,
    optionally filterable by `status`/`q`; items include `id`, `name`,
    `description`, `baseAnalyzerId`, `status`, `fieldCount`,
    `sampleDocumentCount`, `referencedProcessCount`, `updatedAt`, and
    latest `error`/training-operation metadata when relevant.
  - `POST /custom-analyzers` — create the metadata-only draft from the
    modal and return the created resource for navigation.
  - `DELETE /custom-analyzers/{analyzerId}` — hard-delete an unreferenced
    draft/published record; `409`s with the shared error shape if
    `referencedProcessCount > 0` (use **Deprecate** instead).
  - `POST /custom-analyzers/{analyzerId}/deprecate` — hide from
    `GET /analyzers` without deleting or touching referencing processes.

- **Consistency with `GET /analyzers`**: `list_available_analyzers()` in
  `apps/api/app/cu/catalog.py` currently applies no status filter at all,
  so a `training`/`failed`/deprecated custom analyzer could leak into the
  `process-form` picker today. This is a real gap task 24 must close:
  `list_available_analyzers()` should filter to `status == "ready"` (and
  not deprecated) so only analyzers this list marks `ready` are selectable
  in `process-form`.

- **Concurrency**: no optimistic concurrency needed for the list itself.
  Last-write-wins; refresh from the server after every mutating action.
