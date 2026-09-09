# Task 03 — Process CRUD & Analyzer Discovery API

## Status

Done

## Objective

Implement the control-plane API: `GET/POST /processes`,
`GET/PUT/DELETE /processes/{processId}`, and `GET /analyzers`. This is the
first user-facing capability and unblocks both the frontend's
process-list/process-form screens (task 10) and the provisioning task (04).

## Spec References

- `docs/spec/features/onboarding-business-process.md` — full feature.
- `docs/spec/DATA-MODEL.md` — `processes` container section, uniqueness
  check, cascade delete, `allowedAnalyzers` denormalization.
- `docs/spec/CONTENT-UNDERSTANDING.md` — Analyzer Discovery section
  (curated catalog + CU custom analyzers, `idp_` filtering).
- `docs/spec/api/openapi.yaml` — `/processes`, `/processes/{processId}`,
  `/analyzers` paths, request/response schemas, error codes.
- Findings from task 01 (whether prebuilts appear in CU's list — affects
  whether the catalog can be partially live-enriched).

## Scope

**In scope:**
- `GET /analyzers` — composes the curated static prebuilt catalog
  (hardcoded list per `CONTENT-UNDERSTANDING.md`'s Analyzer Discovery
  section) with live `GET /contentunderstanding/analyzers` results, filters
  out `idp_`-prefixed / `createdBy: cl-idp`-tagged analyzers, follows
  pagination to completion. Returns `502` (shared `Error` schema) if CU is
  unreachable.
- `POST /processes` — validates name uniqueness (case-insensitive,
  cross-partition query), validates `allowedAnalyzerIds` (1-199, no dupes,
  no `other`, every ID exists in the composed analyzer list), resolves and
  denormalizes `allowedAnalyzers` display names **synchronously** (fails
  `502` if CU unreachable at save time), persists with
  `routingAnalyzerStatus: "building"`, returns `201`. **Does not yet
  actually provision the CU routing analyzer** — that's task 04, which
  this task must leave a clean extension point for (e.g. an internal
  "provision" function stubbed to just flip status to `ready`, replaced in
  04, or a genuine async task queue/background trigger — decide and note
  in code comments; recommend a simple `BackgroundTasks` call in task 04 to
  keep this task decoupled).
- `GET /processes` — list ordered by `createdAt` descending.
- `GET /processes/{processId}` — single process, `404` if missing.
- `PUT /processes/{processId}` — same validation as create; only resets
  `routingAnalyzerStatus` to `building` when `allowedAnalyzerIds` actually
  changed (compare against stored value); `404` if missing, `409` on name
  collision with a *different* process.
- `DELETE /processes/{processId}` — cascades: delete all jobs in that
  partition, delete all blobs under `{processId}/`, delete the process
  document. CU analyzers deliberately left alone (see spec).
- Uniqueness check, validation errors, and cascade delete all covered by
  integration tests against the Cosmos/Blob emulators.

**Out of scope:** actually creating CU routing/derived analyzers (task 04
owns the real provisioning logic and will replace/extend the stub this
task leaves); the trigger/upload endpoint (task 05); jobs endpoints (07/08).

## Dependencies

- Task 01 (analyzer catalog/discovery behavior confirmed).
- Task 02 (Cosmos/Blob wrappers, Pydantic models).

## Subtasks

1. Implement the curated prebuilt catalog as a static config module (ID,
   friendly name, description) per the 8 analyzers listed in
   `CONTENT-UNDERSTANDING.md`.
2. Implement `GET /analyzers` composing catalog + live custom analyzers,
   with `idp_`/`createdBy` filtering and pagination handling.
3. Implement name-uniqueness check (cross-partition Cosmos query,
   case-insensitive).
4. Implement `allowedAnalyzerIds` validation (count bounds, dupes, `other`
   reserved word, existence against composed analyzer list).
5. Implement `POST /processes`, `GET /processes`, `GET /processes/{id}`,
   `PUT /processes/{id}`, `DELETE /processes/{id}` per the OpenAPI schemas
   and the change-detection rule for `routingAnalyzerStatus` reset.
6. Implement cascade delete (jobs + blobs + process document).
7. Stub the provisioning trigger point clearly (e.g. a `# TODO(task-04):
   invoke real CU provisioning here` comment plus a function signature
   task 04 will fill in) so 04 is a clean addition, not a rewrite.
8. Write pytest integration tests against the Cosmos/Blob emulators for
   every endpoint, including edge cases: duplicate name on create, `409`
   on rename collision, `400` on invalid analyzer selection (200+, dupe,
   `other`), `404` on missing process, cascade delete verified by
   confirming jobs/blobs are gone after.

## Acceptance Criteria

- **Given** no processes exist, **when** `GET /processes` is called,
  **then** it returns `200` with an empty array.
- **Given** a valid payload, **when** `POST /processes` is called,
  **then** it returns `201` with `routingAnalyzerStatus: "building"` and
  denormalized `allowedAnalyzers` names populated.
- **Given** an existing process named "Invoice Intake", **when**
  `POST /processes` is called with the same name (any case), **then** it
  returns `409` with the shared `Error` schema.
- **Given** a payload selecting an analyzer ID not present in
  `GET /analyzers`, **when** `POST /processes` is called, **then** it
  returns `400` naming the invalid analyzer.
- **Given** an existing process, **when** `PUT` changes only `description`,
  **then** `routingAnalyzerStatus` is unchanged from its prior value.
- **Given** an existing process, **when** `PUT` changes
  `allowedAnalyzerIds`, **then** `routingAnalyzerStatus` resets to
  `"building"`.
- **Given** a process with jobs and uploaded blobs, **when**
  `DELETE /processes/{id}` is called, **then** it returns `204`, and a
  subsequent `GET /processes/{id}`, any job under it, and any blob under
  `{processId}/` all return not-found.
- **Given** CU is unreachable (simulate by pointing `CU_ENDPOINT` at a
  closed port), **when** `GET /analyzers` is called, **then** it returns
  `502` with the shared `Error` schema, and `POST /processes` also returns
  `502` rather than saving a half-labelled process.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run pytest tests/test_processes_api.py tests/test_analyzers_api.py -v

# Manual smoke test
uv run uvicorn app.main:app --reload &
curl -s http://localhost:8000/analyzers | jq
curl -s -X POST http://localhost:8000/processes -H 'Content-Type: application/json' -d '{
  "name": "Invoice Intake", "description": "test",
  "allowedAnalyzerIds": ["prebuilt-invoice"],
  "confidenceThreshold": 0.8, "ownerEmail": "owner@example.com"
}' | jq
curl -s http://localhost:8000/processes | jq
```

Confirm the created process appears in Cosmos DB Emulator's data explorer
(https://localhost:8081/_explorer/index.html) with the expected shape.

## Definition of Done

- [x] All 5 process endpoints + `/analyzers` implemented per OpenAPI.
- [x] Name uniqueness, analyzer validation, and cascade delete covered by
      passing integration tests.
- [x] `502` behavior verified when CU is unreachable.
- [x] Provisioning extension point clearly stubbed/commented for task 04.
- [x] Generated TS client (`packages/shared`) regenerated and reflects any
      schema clarifications discovered while implementing.
