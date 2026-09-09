# Task 24 — Custom Analyzer Authoring: Backend Control-Plane API

## Status

Not Started

## Why This Exists

Task 20 proved custom, schema-based Content Understanding analyzers work
end-to-end against the live CU resource, but only via a one-off script
(`apps/api/scripts/train_custom_analyzers.py`) run by an operator with
direct CU credentials. `docs/spec/screen/custom-analyzers-list.md` and
`docs/spec/screen/analyzer-training.md` (written in this planning pass)
specify a real in-app authoring experience — admins create, edit, test, and
publish custom analyzers from the web UI, without touching a script or the
raw CU API. This task builds the backend control-plane surface those two
screens depend on. It does **not** build the frontend (task 25) or change
the existing `GET /analyzers` picker's filtering contract, which already
composes prebuilt + custom analyzers correctly per
`apps/api/app/cu/catalog.py`.

## Spec References

- `docs/spec/screen/custom-analyzers-list.md` — list/search/filter, status
  lifecycle (`draft`/`training`/`ready`/`failed`), creation modal payload,
  delete-vs-deprecate rules, polling contract.
- `docs/spec/screen/analyzer-training.md` — the full draft resource shape,
  sample management, test-run (temporary internal analyzer) flow, and
  publish flow this API must support. **Read the "Data / API needs"
  section of both files closely — they are the API contract for this
  task.**
- `docs/spec/CONTENT-UNDERSTANDING.md` — "Custom Trained Analyzers" section
  (real field-schema shape, ID rules, `allowReplace=true` semantics,
  polling contract, known CU quirks like unanswered-field objects).
- `apps/api/scripts/train_custom_analyzers.py` — the authoritative
  `fieldSchema` payload shape (`field_definition(...)`, `AnalyzerSpec`) and
  the working PUT → poll → analyzeBinary flow to reuse (via `CuClient`),
  not reimplement.
- `apps/api/app/cu/catalog.py` — `APP_OWNED_ANALYZER_PREFIX` /
  `list_available_analyzers` filtering rules that both the live published
  analyzer ID and the temporary test-analyzer ID must respect (temporary
  test analyzers **should** use the `idp_`/`createdBy: cl-idp` app-owned
  convention so they stay hidden from `GET /analyzers`; user-published
  analyzers must **not**).
- `docs/spec/DATA-MODEL.md` — existing Cosmos DB container / Blob Storage
  conventions (`processes`, `jobs` containers, `documents` blob container)
  to follow for the new `customAnalyzers` container and a
  `custom-analyzer-samples` blob prefix/container.
- `docs/spec/api/openapi.yaml` — existing path/response/error conventions
  (`{ code, message, details? }` error shape, camelCase bodies, `201`
  create / `204` delete) this task's new paths must match.

## Scope

**In scope:**

- New Cosmos DB container (e.g. `customAnalyzers`, partitioned by
  `analyzerId` or a synthetic id — decide and document, consistent with
  existing container docs in `DATA-MODEL.md`) storing: id, name,
  description, `baseAnalyzerId`, status, `fieldSchema` (draft + last
  published), sample document metadata, latest test-run summary, latest
  publish error, `referencedProcessCount` (denormalized or computed),
  timestamps.
- Blob storage location for uploaded sample documents (mirroring the
  existing `documents` container's per-job layout convention, scoped per
  analyzer draft instead of per job).
- REST endpoints (exact paths from the two screen specs' "Data / API
  needs" sections):
  - `GET /custom-analyzers`, `POST /custom-analyzers`,
    `GET /custom-analyzers/{analyzerId}`,
    `PUT /custom-analyzers/{analyzerId}`,
    `DELETE /custom-analyzers/{analyzerId}`
  - `POST /custom-analyzers/{analyzerId}/samples`,
    `DELETE /custom-analyzers/{analyzerId}/samples/{sampleId}`,
    `GET /custom-analyzers/{analyzerId}/samples/{sampleId}/document`
  - `POST /custom-analyzers/{analyzerId}/suggest-fields` — body references
    an already-uploaded `sampleId`; calls the resolved completion model
    (`resolve_completion_model_name()`) with the sample document to
    propose candidate field definitions (`name`, `type`, `method`,
    `description`, best-effort `enum`/`examples`); returns the candidate
    list for client-side review/accept and **never** mutates the stored
    draft schema itself (the client applies accepted rows via the normal
    `PUT`). This is an authoring aid only — it never touches the live or
    temporary CU analyzer.
  - `POST /custom-analyzers/{analyzerId}/test-run`,
    `GET /custom-analyzers/{analyzerId}/test-run/{runId}`
  - `POST /custom-analyzers/{analyzerId}/publish`,
    `GET /custom-analyzers/{analyzerId}/publish-status`
  - `POST /custom-analyzers/{analyzerId}/deprecate` — hides the analyzer
    from `GET /analyzers` (sets a `deprecated` flag) without deleting it or
    touching any referencing process's `allowedAnalyzerIds`; the
    counterpart to hard `DELETE` when `referencedProcessCount > 0`.
- Reusing `CuClient`/provisioning helpers (same pattern as
  `apps/api/app/cu/provisioning.py`) for the actual
  `PUT .../analyzers/{id}?allowReplace=true` → poll → `:analyzeBinary` →
  poll calls that back publish and test-run.
- Delete/deprecate logic: hard delete only when `referencedProcessCount ==
  0`; otherwise a **Deprecate** action that hides the analyzer from
  `GET /analyzers` without touching existing processes' stored
  `allowedAnalyzerIds` (which then behave exactly like today's stale-
  analyzer case in `process-form`/`process-detail`).
- Fixing the real gap flagged in `custom-analyzers-list.md`:
  `list_available_analyzers()` in `apps/api/app/cu/catalog.py` currently
  applies no status filter, so a `training`/`failed`/deprecated custom
  analyzer could leak into the `process-form` picker. This task must add a
  `status == "ready"` (and not-deprecated) filter there.
- The **Suggest** field-suggestion endpoint: a single completion-model call
  against a selected sample document's extracted layout/text, returning
  candidate field definitions for client-side review — no new persistent
  state, no CU analyzer call.
- Adding the new OpenAPI paths/schemas to `docs/spec/api/openapi.yaml`
  (currently only described in prose in the two screen specs).
- Unit/integration tests for the new endpoints (CRUD, sample upload/
  fetch, test-run polling, publish polling, delete-vs-deprecate branching,
  app-owned-namespace enforcement for temporary test analyzers).

**Out of scope:**

- Any frontend work (task 25).
- Changing `GET /analyzers` or its filtering contract — it already works
  correctly; this task's published analyzers must simply not trip its
  `idp_`/`createdBy: cl-idp` exclusion.
- Retraining/redesigning the two analyzers from task 20 — this is
  infrastructure for *authoring new ones* in-app.
- Any batch/bulk import of existing script-created analyzers into the new
  `customAnalyzers` container (the two task-20 analyzers can continue to
  be managed by the script until someone chooses to adopt them into the
  new UI; that migration is not required for this task's Definition of
  Done).

## Dependencies

- Task 04 (`CuClient`/provisioning helpers).
- Task 20 (real field-schema shape and live-verified CU quirks this API's
  payloads must match).
- The two screen specs written in this planning pass:
  `docs/spec/screen/custom-analyzers-list.md`,
  `docs/spec/screen/analyzer-training.md`.

## Subtasks

1. Add the `customAnalyzers` Cosmos container and sample-document blob
   layout to `docs/spec/DATA-MODEL.md`, following the existing
   `processes`/`jobs`/`documents` documentation pattern.
2. Add the new paths/schemas to `docs/spec/api/openapi.yaml`, matching the
   two screen specs' documented request/response shapes and existing error
   conventions.
3. Implement the CRUD + sample-management endpoints against the new
   container/blob layout.
4. Implement the test-run flow: save-if-needed, provision/replace an
   `idp_`-namespaced temporary analyzer via `CuClient`, poll to
   ready/failed, run `:analyzeBinary` against the selected sample, poll the
   analysis operation, normalize the result into the same
   page/field/bounding-box shape `inference-review` already consumes.
5. Implement the publish flow: provision/replace the user-visible analyzer
   ID via `CuClient` with `allowReplace=true`, poll to ready/failed, persist
   status/error, and ensure a failed republish leaves the last `ready`
   schema/analyzer untouched (per `custom-analyzers-list.md`'s "Retraining
   and broken replacements" section).
6. Implement delete-vs-deprecate branching based on
   `referencedProcessCount`, and confirm the existing stale-analyzer UX in
   `process-form`/`process-detail` is unaffected by an out-of-band removal.
7. Add the `status == "ready"` (and not-deprecated) filter to
   `list_available_analyzers()` in `apps/api/app/cu/catalog.py`.
8. Implement `POST /custom-analyzers/{analyzerId}/suggest-fields`: fetch
   the referenced sample's stored bytes, call the resolved completion
   model with a schema-suggestion prompt, parse and validate the response
   into candidate field definitions, and return them (no draft mutation).
9. Tests: unit tests per endpoint/branch, plus one live-CU-backed
   integration test (same conventions as task 01/20's live scratch tests)
   proving a full create → add sample → edit schema → test-run → publish →
   ready round trip against the real resource.

## Acceptance Criteria

- **Given** the new endpoints, **when** a draft is created, edited, has a
  sample uploaded, is test-run, and is published, **then** each step
  matches the request/response shapes documented in
  `analyzer-training.md`'s "Data / API needs" section.
- **Given** a published analyzer, **when** `GET /analyzers` is called,
  **then** it appears exactly like any other custom analyzer (proving the
  app-owned filter is respected) and a temporary test analyzer never does.
- **Given** an analyzer referenced by at least one process, **when** delete
  is attempted, **then** the API rejects hard delete and deprecate succeeds
  instead, consistent with `custom-analyzers-list.md`.
- **Given** a `ready` analyzer that is republished and fails, **when** its
  status is queried, **then** it reports `failed` with the CU error while
  the previously published analyzer definition remains live/usable by
  existing processes.

## Test Instructions

```bash
cd apps/api
uv run pytest tests/test_custom_analyzers_api.py -v
# live-CU-backed round trip (requires CU_ENDPOINT + az login, same as task 20)
uv run python scripts/train_custom_analyzers.py   # sanity: existing script still works unchanged
uv run pytest tests/test_custom_analyzers_live.py -v -m live
```

## Definition of Done

- [ ] `docs/spec/DATA-MODEL.md` and `docs/spec/api/openapi.yaml` updated
      with the new container/blob layout and REST surface.
- [ ] All endpoints from both screen specs' "Data / API needs" sections
      implemented and tested.
- [ ] Test-run uses an app-owned-namespaced temporary analyzer that never
      appears in `GET /analyzers`.
- [ ] Publish uses the real live CU flow and correctly reports
      `draft`/`training`/`ready`/`failed`.
- [ ] Delete-vs-deprecate branching verified, including the existing
      stale-analyzer UX remaining correct for out-of-band removals.
- [ ] A full live-CU round trip (create → sample → test → publish → ready)
      has been run at least once against the real resource and recorded
      here.
