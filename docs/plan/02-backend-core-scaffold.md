# Task 02 — Backend Core Scaffold

## Status

Done

## Objective

Build the shared backend infrastructure every feature endpoint depends on:
config/settings loading, Cosmos DB client + container bootstrap, Blob
Storage client, Queue Storage client, the Pydantic models mirroring the
data model, and the OpenAPI-contract-first wiring (FastAPI app configured
to match `docs/spec/api/openapi.yaml`).

## Spec References

- `docs/spec/DATA-MODEL.md` — full document, this task implements its
  container/blob/queue shapes as code (not yet the business logic that
  writes to them).
- `docs/spec/api/openapi.yaml` — the authoritative contract; models must
  match its schemas exactly.
- `docs/spec/TECHNOLOGY.md` — Backend section, Data Storage section.

## Scope

**In scope:**
- `apps/api/app/config.py` — settings loaded from env vars (Cosmos
  connection string, Azurite connection strings, CU endpoint/key/model,
  SMTP settings, `WEB_ORIGIN`), using `pydantic-settings`.
- `apps/api/app/models/` — Pydantic models: `BusinessProcess`, `Job`,
  `Field` (recursive, discriminated union on `type`), `Error`, `Health`,
  matching `openapi.yaml` schemas field-for-field including internal-only
  fields noted in `DATA-MODEL.md` (kept as separate internal models, not
  exposed by the public response models).
- `apps/api/app/db/cosmos.py` — Cosmos client wrapper; on startup, ensures
  `processes` (pk `/id`) and `jobs` (pk `/processId`) containers exist
  (idempotent create-if-not-exists) against the Cosmos DB Emulator.
- `apps/api/app/storage/blob.py` — Blob client wrapper for the `documents`
  container against Azurite; ensures the container exists on startup.
- `apps/api/app/storage/queue.py` — Queue client wrapper for the `jobs`
  queue against Azurite; ensures the queue exists on startup.
- `apps/api/app/main.py` — FastAPI app with CORS configured for
  `WEB_ORIGIN`, OpenTelemetry SDK initialized (console exporter only —
  full span wiring is task 14), and `/healthz` upgraded to check Cosmos +
  Blob + Queue connectivity, returning the `Health` schema with per-
  dependency status and `503` if any dependency is down.
- Round-trip unit tests: write/read a `BusinessProcess` and a `Job`
  document against the Cosmos emulator; write/read a blob against Azurite;
  send/receive a queue message against Azurite.
- Codegen wiring in `packages/shared`: script that generates a TypeScript
  client from `openapi.yaml` (e.g. `openapi-typescript` or
  `openapi-generator`), runnable via `npm run generate` — used by frontend
  tasks starting at 09.

**Out of scope:** any actual endpoint logic beyond `/healthz` (tasks
03/05/06/07/08), CU client wrapper (task 04 introduces it since it's
provisioning-specific, though the raw SDK dependency can be added here).

## Dependencies

- Task 00 (repo scaffold, docker-compose emulators running).

## Subtasks

1. Define Pydantic models exactly matching `openapi.yaml` — cross-check
   every field name and type against both `openapi.yaml` and
   `DATA-MODEL.md`'s JSON examples (including the discriminated `Field`
   union with `array`/`object` recursion).
2. Implement Cosmos wrapper with startup container bootstrap.
3. Implement Blob wrapper with startup container bootstrap.
4. Implement Queue wrapper with startup queue bootstrap.
5. Wire config/settings from env vars, matching `.env.example` from task 00.
6. Upgrade `/healthz` to the real dependency-check implementation with the
   `Health` schema (per-dependency status, `503` on any failure).
7. Add OpenTelemetry SDK init with console exporter (no spans yet beyond
   framework auto-instrumentation).
8. Set up `packages/shared` codegen script and generate the first TS
   client artifact, commit the generation script (not necessarily the
   generated output, unless the team prefers committing it — recommend
   committing it since `apps/web` will import it directly).
9. Write unit tests for each wrapper (Cosmos round-trip, Blob round-trip,
   Queue round-trip) using the local emulators from docker-compose.

## Acceptance Criteria

- **Given** the Cosmos DB Emulator running, **when** the API starts,
  **then** the `processes` and `jobs` containers exist with the correct
  partition keys (verifiable via the emulator's data explorer or the SDK).
- **Given** Azurite running, **when** the API starts, **then** the
  `documents` blob container and `jobs` queue both exist.
- **Given** all three emulators running, **when**
  `curl http://localhost:8000/healthz` is called, **then** it returns
  `200` with a `Health` body showing each dependency as healthy.
- **Given** one emulator stopped (e.g. `docker compose stop azurite`),
  **when** `/healthz` is called, **then** it returns `503` with that
  dependency marked unhealthy in the body.
- **Given** `openapi.yaml`, **when** `npm run generate` runs in
  `packages/shared`, **then** a TypeScript client/types module is produced
  with no generation errors, matching every schema in the spec.
- **Given** a `Job` document with nested `array`/`object` fields (per the
  `DATA-MODEL.md` example), **when** it round-trips through the Pydantic
  model (serialize → deserialize), **then** the structure and every leaf
  value is preserved exactly.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run pytest tests/test_cosmos.py tests/test_blob.py tests/test_queue.py -v
uv run uvicorn app.main:app --reload &
curl -s http://localhost:8000/healthz | jq   # all deps "healthy", 200

docker compose stop azurite
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8000/healthz  # 503
docker compose start azurite

cd ../../packages/shared
npm run generate
ls src/generated   # client/types present
```

## Definition of Done

- [x] All Pydantic models match `openapi.yaml` schemas exactly (spot-check
      by generating the TS client and diffing field names against the
      Python models).
- [x] Cosmos, Blob, Queue wrappers pass round-trip tests against local
      emulators.
- [x] `/healthz` reflects true per-dependency status including `503`.
- [x] TS client generation runs cleanly and is documented in
      `packages/shared/README.md`.
- [x] OpenTelemetry SDK initialized (verify console shows auto-
      instrumented spans for the `/healthz` request).
