# Task 04 — CU Routing/Derived Analyzer Provisioning

## Status

Done

## Objective

Implement the real asynchronous provisioning pipeline: on process
create/update (when `allowedAnalyzerIds` changed), determine the per-form
target analyzer for each selected analyzer (**derived when supported,
direct when derivation is rejected**), then create a routing analyzer over
those targets plus the `other` catch-all, polling each to `ready`/`failed`
and updating the process document accordingly.

## Spec References

- `docs/spec/CONTENT-UNDERSTANDING.md` — Resource Naming and Ownership
  (canonical `idp_r_{p}` / `idp_d_{p}_{a}` scheme), Derived Analyzers
  section, The Routing Analyzer section, Stale Analyzer References
  section.
- `docs/spec/features/onboarding-business-process.md` — Routing Analyzer
  Provisioning, Stale Analyzer Selections sections.
- `docs/spec/DATA-MODEL.md` — `processes` container fields
  (`routingAnalyzerId`, `derivedAnalyzerIds`, `routingAnalyzerError`).
- Task 01 findings on `allowReplace` mechanics and analyzer ID limits.

## Scope

**In scope:**
- CU client wrapper (`apps/api/app/cu/client.py`) using
  `azure-ai-contentunderstanding` with `httpx` REST fallback,
  `DefaultAzureCredential` primary auth / `CU_API_KEY` fallback, pinned to
  `2025-11-01`.
- Deterministic ID generation: `idp_r_{p}` and `idp_d_{p}_{a}` per the
  hashing scheme in `CONTENT-UNDERSTANDING.md`, using only allowed
  characters (underscores + lowercase hex).
- Category description derivation: curated catalog text for prebuilts, the
  analyzer's own description (or ID fallback) for customs, truncated to
  the 120-char name+description combined limit.
- Routing-analyzer model binding: set `models.completion` explicitly to a
  supported logical model name (currently `gpt-5-mini`), resolving the
  deployment from CU defaults / configuration.
- Provisioning orchestration (background task, e.g. FastAPI
  `BackgroundTasks` or a lightweight async job runner — no new
  infrastructure needed since this isn't the document pipeline queue):
  1. For each selected analyzer, attempt a derived-analyzer `PUT`
     (`allowReplace=true`) with `estimateFieldSourceAndConfidence: true`.
  2. If derivation succeeds, poll until `ready`/`failed` and record that
     derived analyzer ID as the routing target for that selected analyzer.
  3. If derivation is rejected as unsupported for that base analyzer
     (for example `InvalidBaseAnalyzerId`), record the original selected
     analyzer ID as the routing target instead of failing the whole build.
  4. If the selected analyzer is missing or any non-recoverable CU error
     occurs, stop and set `routingAnalyzerStatus: "failed"` with
     `routingAnalyzerError` naming the missing/failing analyzer.
  5. Once all category targets are known, `PUT` the routing analyzer with
     `contentCategories` mapping each selected analyzer ID → resolved
     target analyzer ID (derived or direct), plus the injected `other`
     category.
  6. Poll routing analyzer until `ready`/`failed`; update the process
     document's `routingAnalyzerStatus`, `routingAnalyzerId`,
     `derivedAnalyzerIds`, `routingAnalyzerError` accordingly. Persist
     only the successfully created derived analyzers in
     `derivedAnalyzerIds`.
- Wiring into task 03's stubbed extension point in `POST`/`PUT
  /processes`.
- Stale analyzer detection: validate every `allowedAnalyzerIds` entry
  against the composed analyzer list at provisioning time too (not just at
  save time, in case it was deleted from CU between save and provisioning)
  and surface the specific missing ID in `routingAnalyzerError`.

**Out of scope:** the trigger/upload endpoint and worker that *use* the
routing analyzer for inference (tasks 05/06); the process-detail polling
UI (task 11, which just polls `GET /processes/{id}` — already covered by
03).

## Dependencies

- Task 01 (confirmed `allowReplace` mechanics, ID length limit).
- Task 03 (process CRUD endpoints and extension point).

## Subtasks

1. Implement CU client wrapper with auth (`DefaultAzureCredential` +
   `CU_API_KEY` fallback), the pinned API version, and explicit routing
   analyzer completion-model binding.
2. Implement deterministic ID generation functions with unit tests
   covering the hashing scheme, allowed characters, and bounded length.
3. Implement category description derivation + truncation with unit
   tests covering the 120-char combined limit.
4. Implement per-analyzer target resolution: attempt derived analyzer
   provisioning (create + poll), fall back to direct routing on supported
   "cannot derive this base analyzer" failures, and fail on missing or
   otherwise invalid analyzers.
5. Implement routing analyzer provisioning (create + poll), including the
   injected `other` category, `enableSegment: false`, `omitContent:
   false`, and explicit `models.completion`.
6. Implement the orchestration function wired into task 03's stub,
   triggered as a background task after `POST`/`PUT /processes` returns
   the initial `201`/`200` (so the API response is not blocked on
   provisioning, matching the "asynchronous" spec requirement).
7. Implement failure surfacing: any step's failure sets
   `routingAnalyzerStatus: "failed"` + a specific `routingAnalyzerError`.
8. Write integration tests against the **live** CU resource (marked
   `@pytest.mark.live`, skip cleanly without credentials) covering: a
   successful build where at least one selected analyzer routes directly
   because derivation is unsupported, a build with a nonexistent analyzer
   ID (fails with a specific error), and a rebuild that changes the
   analyzer set (confirms deterministic IDs and harmless orphans for any
   old derived analyzers).

## Acceptance Criteria

- **Given** a process created with `allowedAnalyzerIds: ["prebuilt-invoice",
  "prebuilt-receipt"]`, **when** provisioning completes, **then** the
  process document has `routingAnalyzerStatus: "ready"`,
  `routingAnalyzerId` set, and `derivedAnalyzerIds` containing only the
  analyzers that were actually derivable.
- **Given** the same process, **when** inspected in the CU account,
  **then** one routing analyzer exists with the documented `idp_` ID
  scheme and `createdBy: cl-idp` tag, and any successful derived analyzers
  also follow that scheme.
- **Given** a selected analyzer whose derivation is unsupported by CU,
  **when** provisioning runs, **then** the routing analyzer category for
  that selection points directly at the selected analyzer ID instead of
  failing the whole process.
- **Given** a process re-saved with the identical `allowedAnalyzerIds`,
  **when** `PUT` completes, **then** no new provisioning is triggered (the
  status stays `ready` throughout, no CU calls made for analyzer
  creation).
- **Given** a process whose `allowedAnalyzerIds` changes, **when** `PUT` is
  called, **then** `routingAnalyzerStatus` becomes `building` immediately
  in the response, then transitions to `ready` once background
  provisioning completes (poll `GET /processes/{id}` to observe).
- **Given** a process selecting an analyzer ID that doesn't exist in CU,
  **when** provisioning runs, **then** `routingAnalyzerStatus` becomes
  `failed` and `routingAnalyzerError` names the specific missing analyzer.
- **Given** an existing routing analyzer, **when** provisioning re-runs
  with `allowReplace=true` against the same deterministic ID, **then** it
  succeeds rather than erroring on "analyzer already exists."

## Test Instructions

```bash
cd apps/api
# Unit tests (no CU credentials needed)
uv run pytest tests/test_cu_ids.py tests/test_cu_descriptions.py -v

# Live tests (needs CU_ENDPOINT/CU_API_KEY in .env; costs a small amount)
uv run pytest tests/test_cu_provisioning.py -v -m live

# End-to-end manual check
uv run uvicorn app.main:app --reload &
curl -s -X POST http://localhost:8000/processes -d '{...}' | jq '.routingAnalyzerStatus'   # "building"
# poll:
watch -n2 'curl -s http://localhost:8000/processes/<id> | jq ".routingAnalyzerStatus, .routingAnalyzerError"'
```

Confirm in the Azure Foundry portal (or via
`GET /contentunderstanding/analyzers` directly) that the expected
`idp_r_*` and any `idp_d_*` analyzers appear with `status: ready`.

## Definition of Done

- [x] Provisioning runs asynchronously and updates process status
      correctly through `building` → `ready`/`failed`.
- [x] Deterministic IDs verified stable across repeated runs (no orphan
      accumulation on re-save with the same selection).
- [x] Failure path (missing analyzer) verified against live CU with a
      specific, actionable `routingAnalyzerError`.
- [x] Change-detection (`only rebuild when allowedAnalyzerIds changed`)
      verified — a description-only edit causes zero CU calls.
- [x] Live tests marked `@pytest.mark.live` and skip cleanly without
      credentials (verify by unsetting `CU_ENDPOINT` and re-running).
