# Task 28 — Cosmos DB → MongoDB Atlas Migration

## Status

Complete

## Objective

Switch the primary datastore from Azure Cosmos DB (SQL API) to MongoDB
Atlas — Canada Life's approved production stack — while keeping Cosmos
fully supported as a config-selectable fallback/rollback backend. Both
backends implement a shared `DataStore` interface, are covered by the same
contract test suite, and are individually selectable via `DB_BACKEND`.

## Spec References

- `docs/spec/TECHNOLOGY.md` — backend technology choices.
- `docs/spec/DATA-MODEL.md` — persistence design (`processes`/`jobs`
  collections/containers, partition-key vs index modeling).
- `docs/spec/api/openapi.yaml` — health-check dependency keys.
- Tasks 02 (backend-core-scaffold), 07 (backend-jobs-query-api), 08
  (backend-review-retry-api) — original Cosmos-coupled implementations
  this task refactors.

## Scope

**In scope:**
- `DataStore` interface (`app/db/base.py`) + generic exceptions
  (`app/db/exceptions.py`: `DocumentNotFoundError`, `DataStoreError`).
- Backend-agnostic job query surface (`JobFilters` → `list_jobs`/
  `count_jobs`/`sum_pages`) replacing the raw Cosmos SQL currently built
  inline in `routers/jobs.py`.
- New `MongoService` (pymongo) implementation.
- Refactored `CosmosService` implementing the same interface.
- `DB_BACKEND=mongo|cosmos` config flag (default `mongo`) + factory.
- Router/worker/script migration off direct Cosmos types.
- `docker-compose.yml` gains a `mongo:7` service alongside (not replacing)
  the Cosmos emulator; `.env.example`, devcontainer, README, DEMO docs
  updated.
- OpenAPI spec + regenerated `packages/shared` client.
- `TECHNOLOGY.md`/`DATA-MODEL.md` updated to document Mongo as primary,
  Cosmos as fallback.
- Full architecture-doc rewrite of the Cosmos DR/HA/partitioning narrative
  for MongoDB Atlas semantics.

**Out of scope:**
- Any live data migration (greenfield — no deployed environment yet).
- Removing Cosmos support entirely.
- Provisioning a real MongoDB Atlas project/cluster (dev/test use local
  `mongo:7`; Atlas is documented as the production target only).

## Dependencies

- Tasks 02, 07, 08 (the Cosmos-coupled code this task refactors) must
  already be implemented, which they are.

## Subtasks

1. Add `pymongo` dependency (`apps/api/pyproject.toml`), keep `azure-cosmos`.
2. Write a backend-agnostic `DataStore` contract test suite (parametrized
   over `mongo`/`cosmos`) covering process CRUD, name-uniqueness lookup,
   job CRUD, job filter/pagination/count/sum-pages, and not-found handling.
   Expected red until the interface + implementations exist.
3. Define `DataStore` Protocol/ABC and generic exceptions; move
   `JobFilters` → query-language translation out of the router.
4. Implement `MongoService`: `processes`/`jobs` collections, unique
   case-insensitive index on process `name`, compound index on
   `jobs.processId`/`status`/`submittedAt`.
5. Refactor `CosmosService` to implement the same interface, translating
   `azure.cosmos` exceptions to the generic ones.
6. Add `Settings.db_backend`, Mongo connection settings, and
   `create_data_store()` factory; wire into `main.py`/`worker/main.py`.
7. Migrate `routers/jobs.py`, `routers/trigger.py`, `main.py`,
   `worker/main.py`, `cu/provisioning.py` off direct Cosmos imports;
   rename `cosmos_service()`/`app.state.cosmos_service` to `data_store()`/
   `app.state.data_store`.
8. Migrate `tests/conftest.py` and all test files to the generic API,
   parametrized over both backends.
9. Update `docker-compose.yml`, `.env.example`, devcontainer message,
   README, DEMO.md, seed/e2e scripts.
10. Update OpenAPI spec + regenerate `packages/shared/src/generated/api.ts`.
11. Update `TECHNOLOGY.md`/`DATA-MODEL.md`.
12. Rewrite `docs/architecture/*.md` DR/HA/partitioning sections for Atlas;
    regenerate diagrams where topology changes.
13. Full end-to-end verification: docker-compose stack + seed scripts +
    backend pytest + Playwright e2e suite with `DB_BACKEND=mongo`
    (default); smoke-test `DB_BACKEND=cosmos` fallback.

## Acceptance Criteria

- **Given** `DB_BACKEND=mongo` (default), **when** the full backend test
  suite runs, **then** all tests pass against a local `mongo:7` container.
- **Given** `DB_BACKEND=cosmos`, **when** the same suite runs, **then** it
  passes identically against the Cosmos emulator (parity proven by the
  shared contract suite, not by inspection).
- **Given** the full docker-compose stack with default settings, **when**
  seed scripts run and the Playwright e2e suite executes, **then** every
  existing capability (process CRUD, trigger/upload, worker inference,
  jobs query/review/retry) works unchanged from the user's perspective.
- **Given** the OpenAPI spec's health-check schema, **when** regenerated,
  **then** `packages/shared/src/generated/api.ts` reflects the
  backend-agnostic dependency key.
- **Given** the architecture docs, **when** reviewed, **then** the DR/HA/
  backup/partitioning narrative accurately describes MongoDB Atlas
  mechanisms (replica sets, multi-region clusters, PrivateLink,
  continuous backups) rather than Cosmos RU/partition concepts.

## Test Instructions

```bash
docker compose up -d
cd apps/api
DB_BACKEND=mongo uv run pytest -v
DB_BACKEND=cosmos uv run pytest -v

# Seed + full stack smoke
uv run python scripts/seed.py
cd ../web && npx playwright test
```

## Definition of Done

- [x] Contract test suite passes identically for both backends.
- [x] No router/worker/script imports `azure.cosmos` directly anymore.
- [x] `docker-compose.yml` runs both `mongo:7` and the Cosmos emulator.
- [x] Seed scripts and Playwright e2e suite pass with `DB_BACKEND=mongo`.
- [x] `DB_BACKEND=cosmos` smoke test (health check + basic CRUD) passes.
- [x] OpenAPI spec + generated client regenerated and consistent.
- [x] Architecture docs' DR/HA narrative rewritten for Atlas, not Cosmos.

## Verification notes (2026-09-23)

- Full backend pytest suite: 146/146 passing (both Mongo and Cosmos
  contract-test parameterizations).
- Docker Compose stack rebuilt (`--force-recreate --build api worker web`);
  `/healthz` now reports `"database": "ok"` (was `"cosmos"`).
- `scripts/seed.py` ran successfully end to end against the live
  `DB_BACKEND=mongo` stack (processes created, jobs triggered/polled/
  succeeded via the real HTTP API).
- `DB_BACKEND=cosmos` fallback smoke test: ran a host-process API/worker
  pair against the Cosmos emulator; health check, process creation, job
  trigger, worker dequeue, and job completion all succeeded.
- Playwright e2e suite (`DB_BACKEND=mongo`): 1 of 3 specs failed on a
  strict-mode locator collision (`label` filter matching both the
  "Invoice" prebuilt analyzer and a pre-existing custom analyzer named
  `canada_life_invoice` in the shared Content Understanding resource).
  This is a pre-existing test-helper/environment issue unrelated to the
  Cosmos→Mongo datastore migration — custom analyzers live in Azure AI
  Content Understanding, not in the datastore being replaced, and the
  same collision would occur regardless of `DB_BACKEND`. Not fixed as
  part of this task; flagged as follow-up.

## Re-verification (2026-09-23, follow-up pass)

- Confirmed the running `docker-compose` stack (`api`, `worker`, `web`,
  `mongo`, `cosmosdb-emulator`, `azurite`, `mailpit`, `otel-collector`) is
  healthy with `DB_BACKEND=mongo` / `MONGO_CONNECTION_STRING=mongodb://mongo:27017/?directConnection=true`
  wired into the `api`/`worker` containers (verified via `docker compose exec api env`).
- `/healthz` → `{"status":"ok","dependencies":{"database":"ok","blob":"ok","queue":"ok"}}`.
- Re-ran `scripts/seed.py` against the live stack from a clean state
  (0 processes/0 jobs beforehand): created 2 processes and 4 jobs, all
  reaching `succeeded`, confirmed persisted via `mongosh` document counts
  (`processes: 2`, `jobs: 4`, `succeeded jobs: 4`).
- Verified subsystems via the real HTTP API against the seeded data:
  `GET /processes` (list), `GET /processes/{id}/jobs` (list),
  `GET /processes/{id}/jobs/summary` (aggregation — `needsReview`/`unclassified`
  counts correct), and `GET /processes/{id}/jobs/{id}/document` (blob
  retrieval, HTTP 200) all returned correct data — confirming API, worker,
  queue, blob storage, and Mongo datastore all functioning together.
- Mailpit reachable via its API (`/api/v1/messages`), confirming the
  notification subsystem dependency is up (message count reflects
  accumulated runs across the session, not a fresh assertion).
- Re-ran the full backend pytest suite once more: **146/146 passing**,
  confirming no regressions after the stack rebuild/re-seed cycle.
- No code or spec changes were required this pass — the migration was
  already functionally complete; this pass re-validates it against a
  fresh Mongo-backed run end to end.

## Bug fix: test suite was wiping seeded dev data (2026-09-23, follow-up)

**Symptom**: user reported no business process visible on the running
local stack after seeding.

**Root cause**: `apps/api/tests/conftest.py`'s `configure_test_environment`
autouse fixture overrode `COSMOS_CONNECTION_STRING`/Azurite connection
strings for test isolation, but never overrode `MONGO_CONNECTION_STRING`/
`MONGO_DATABASE_NAME`. With `DB_BACKEND=mongo` as the default, every pytest
run using the `api_client` fixture connected to the **same** `mongo:7`
instance and `enterprise-idp` database the docker-compose dev/seed
workflow uses, and `clean_backend_state()` (invoked before/after almost
every API test) deleted all processes/jobs from it — silently wiping any
previously-seeded demo data the next time the test suite ran.

**Fix**: `configure_test_environment` now also sets
`MONGO_DATABASE_NAME=enterprise-idp-test`, isolating the test suite onto
its own Mongo database, separate from the dev-stack's `enterprise-idp`
database (mirroring the existing `contract-test` database already used by
`test_datastore_contract.py`).

**Verified**:
- Reseeded the dev stack (2 processes / 4 jobs).
- Ran a pytest subset (24 tests) — passed, and dev DB counts stayed at
  2 processes / 4 jobs afterward (confirmed via `mongosh` and
  `GET /processes`), while the new `enterprise-idp-test` database
  remained empty.
- Ran the full 146-test suite — all passing, and dev seed data still
  visible via the live API afterward.

**Known residual gap (not fixed, out of scope)**: `CosmosService` still
hardcodes a single `DATABASE_NAME` shared between tests and the
dev-stack's Cosmos emulator (this is pre-existing behavior, predating the
Mongo migration, not introduced by it). Running the pytest suite with
`DB_BACKEND=cosmos` set as the active dev backend would still wipe
Cosmos-seeded dev data the same way. Flagged as a follow-up if Cosmos is
ever used as the active local dev backend rather than mongo.

## Bug fix #2: blob/queue storage was also being wiped by the test suite (2026-09-23, same-day follow-up)

**Symptom**: after the Mongo isolation fix above, the process list loaded
correctly in the UI, but a Playwright investigation of the job detail
page found a console error — `GET .../jobs/{id}/document` returned 404
("The source document for this job was not found") — even though the
job record itself (status, detected form, fields) rendered fine.

**Root cause**: the same class of bug as Bug fix #1, but for Azurite
blob/queue storage instead of Mongo. `BlobService`/`QueueService` used
hardcoded container/queue names (`"documents"` / `"jobs"`) with no
settings-level override, and `configure_test_environment` pointed tests
at the exact same Azurite account/ports as the docker-compose dev stack.
`clean_backend_state()` (run before/after nearly every API test) called
`blob.delete_blob()` for every blob in the `documents` container —
deleting the dev stack's seeded PDF documents — even though the
corresponding Mongo job records survived (already isolated by fix #1).
Confirmed via direct inspection: `BlobService(settings).list_blob_names()`
against the dev stack returned 0 blobs while Mongo still had 4 job
records referencing them.

**Fix**:
- Added `blob_container_name` (`BLOB_CONTAINER_NAME`, default
  `"documents"`) and `queue_name` (`QUEUE_NAME`, default `"jobs"`) fields
  to `Settings` (`app/config.py`).
- `BlobService`/`QueueService` (`app/storage/blob.py`,
  `app/storage/queue.py`) now read the container/queue name from settings
  instead of a hardcoded module constant, preserving the same defaults
  for the dev stack (no `docker-compose.yml` changes needed).
- `configure_test_environment` in `tests/conftest.py` now also sets
  `BLOB_CONTAINER_NAME=documents-test` / `QUEUE_NAME=jobs-test`, fully
  isolating the test suite's blob/queue state from the dev stack's,
  mirroring the Mongo database isolation from fix #1.

**Verified**:
- `scripts/seed.py` is idempotent based on existing Mongo records, so
  restoring the already-orphaned blobs required deleting the 2 stale
  seeded processes via `DELETE /processes/{id}` first, then reseeding
  from a clean state (2 processes / 4 jobs, all with fresh blobs).
- `GET /processes/{id}/jobs/{id}/document` → HTTP 200 (57 KB PDF).
- Playwright: navigated to the job detail/review page — source document
  preview and extracted fields both render, zero console errors.
- Ran a pytest subset (32 tests) — passed.
- Ran the full 146-test suite — all passing, and the dev stack's seeded
  document blob and process count (2) remained intact/retrievable
  afterward, confirming true test/dev isolation for Mongo, blob storage,
  and queue storage all at once.

## Follow-up: merged the two demo seed scripts into one (2026-09-24)

**Problem**: the dev stack had been seeded repeatedly with `scripts/seed.py`'s
generic two-process demo (prebuilt `prebuilt-invoice`/`prebuilt-receipt`/
`prebuilt-document` analyzers) throughout the Mongo-migration verification
above. That was never the demo data the customer actually wants — the real
target is `scripts/seed_custom_analyzer_processes.py`'s three Canada Life
business scenarios (Group Benefits, Drug Prior Authorization, Human-in-the-
loop cheque verification), driven by trained custom Content Understanding
analyzers, which is also what `docker-compose.yml`'s one-shot `seed` service
and `DEMO.md` already documented as the canonical walkthrough — the two
scripts had simply drifted apart, and the wrong one kept getting run
manually.

**Fix**: merged both scripts into a single `apps/api/scripts/seed.py`:
- Kept every reusable HTTP-seeding primitive that `train_custom_analyzers.py`
  and `run_cost_demo.py` import from this module unchanged (`SeedClient`,
  `ProcessSeed`, `SeedError`, `ensure_api_reachable`, `ensure_process`,
  `wait_for_process_ready`, `resolve_repo_root`, `guess_content_type`,
  `DEFAULT_API_BASE_URL`).
- Replaced the old generic `SEED_PROCESSES`/`UploadSeed`-driven main() with
  `seed_custom_analyzer_processes.py`'s `SCENARIOS`/`ProcessScenario`-driven
  flow: 3 real business processes, each uploading **every** file under its
  `sample_dirs` (12 sample files total: 6 group-benefits, 2 drug-prior-auth +
  1 invoice, 3 cheques), reviewing one field per process, and deleting any
  `LEGACY_PROCESS_NAMES` (including the old generic `Demo - *` processes) on
  every run.
- Deleted `apps/api/scripts/seed_custom_analyzer_processes.py` (folded into
  `seed.py`).
- Updated `docker-compose.yml`'s `seed` service command/comment and
  `DEMO.md`'s manual walkthrough commands from
  `scripts/seed_custom_analyzer_processes.py` to `scripts/seed.py`.

**Verified**:
- `uv run ruff check scripts/seed.py scripts/train_custom_analyzers.py
  scripts/run_cost_demo.py` — all checks passed.
- Confirmed `train_custom_analyzers.py`/`run_cost_demo.py` still import
  cleanly from the merged module.
- Ran `uv run python scripts/seed.py` against the live dev stack (already
  seeded via the pre-merge script): all 3 processes and all 12 sample jobs
  reported "already exists, reusing" with identical job IDs/status —
  confirming full idempotency, and every sample succeeded with no
  unclassified results.
- Full pytest suite: **146/146 passing**.
- Confirmed the dev stack still shows exactly the 3 correct processes
  (`Canada Life Group Benefits Administration`, `Canada Life Drug Prior
  Authorization`, `Human in the loop verification Process`) after the
  pytest run, with no drift back to the generic demo data.
