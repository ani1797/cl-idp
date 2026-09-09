# Task 26 — Full-Stack Containerization (API, Worker, Web)

## Status

Complete

Validation notes:

- Verified `docker compose --profile app up -d --build` reaches six running
  services (`api`, `worker`, `web`, `cosmosdb-emulator`, `azurite`,
  `mailpit`).
- Verified the container image installs Azure CLI, mounts the host `~/.azure`
  state read-only, copies it into a writable in-container Azure config dir at
  startup, and successfully reuses the host `az login` session:
  `docker compose exec api az account show` worked and
  `docker compose exec api python ... CuClient(...).list_analyzers()` returned
  145 analyzers with no `CU_API_KEY`.
- Verified a fresh backend state clear followed by
  `uv run python apps/api/scripts/seed.py --api-base-url http://localhost:8000`
  completed successfully end-to-end against the fully containerized API/worker,
  including successful CU processing for invoice, receipt, unrelated, and
  general-document samples.
- Verified the production web container serves `http://localhost:3000`, shows
  the seeded processes, renders the PDF viewer on a real inference-review page
  (`GET .../document => 200`, `pdf.worker...mjs => 200`, `canvasCount=1`), and
  saves an approval successfully (`PUT .../review => 200`).
- Verified the default emulator-only startup remains unchanged after
  `docker compose --profile app down` followed by `docker compose up -d`.
- Verified existing non-live API and web suites still pass.

## Objective

Today, `docker-compose.yml` only containerizes the **local dependency
emulators** (Cosmos DB Emulator, Azurite, Mailpit) — the FastAPI server,
the queue worker, and the Next.js web app all run as bare host processes
(`uv run uvicorn ...`, `uv run python -m app.worker.main`, `npm run dev`).
The user has asked to be able to run the **entire system containerized**
on their machine. This task adds real, production-shaped container images
for the API/worker and the web app, and wires them into Docker Compose
alongside the existing emulators, without breaking the existing
fast-iteration host-process dev workflow that every other task in this
plan (and its test instructions) assumes.

## Spec References

- `docs/spec/TECHNOLOGY.md` — "Local Development Environment" section
  (Docker Compose spins up local dependencies today; CU is not
  containerizable — a real Azure CU resource/credentials remain a
  hard prerequisite) and the "Dev → Prod Mapping Summary" table (`Compute`
  row: local = Docker Compose, prod = AKS) and the CI section (mentions
  PR-time "build container images" — no Dockerfiles exist yet to satisfy
  that, a related gap worth closing here too if in scope/time allows,
  but not required — see Out of Scope).
- `docker-compose.yml` (repo root) — existing emulator-only services to
  extend, not replace.
- `apps/api/pyproject.toml` / `apps/api/uv.lock` — dependency manifest for
  the Python image (uses `uv`).
- `apps/web/package.json` — Next.js 16 canary + React 19; `npm run build`
  / `npm run start` are the production build/run scripts.
- `.env.example` — the full set of configuration keys already used by
  `apps/api/app/config.py`'s `Settings` (Cosmos/Azurite connection
  strings, SMTP host/port, `WEB_ORIGIN`, `NEXT_PUBLIC_API_BASE_URL`,
  `APPLICATIONINSIGHTS_CONNECTION_STRING`, `CU_ENDPOINT`, `CU_API_KEY`,
  `CU_MODEL_DEPLOYMENT`).

## Known Gotchas (confirmed by direct inspection — read before starting)

1. **Cosmos emulator TLS verification only trusts `localhost`/`127.0.0.1`
   today.** `apps/api/app/db/cosmos.py`'s `_should_verify_connection()`
   disables SSL verification *only* when the connection string's
   `AccountEndpoint` hostname is exactly `localhost` or `127.0.0.1`. If
   the containerized API instead talks to the emulator via its Docker
   Compose service-DNS hostname (e.g. `cosmosdb-emulator`), the SDK will
   try to verify the emulator's self-signed cert against that hostname
   and fail. **You must handle this** — the cleanest fix is likely an
   explicit opt-in escape hatch (e.g. an env-driven allowlist of
   insecure-ok hostnames, or a dedicated `COSMOS_TLS_INSECURE=true`
   setting consulted in addition to the existing localhost/127.0.0.1
   check) rather than silently trusting more hostnames by default —
   keep the default behavior for non-container/prod use unchanged
   (still verifies real Cosmos DB), and only relax it for the documented
   local-emulator-in-compose-network case. Write a unit test for whatever
   you land on.
2. **`NEXT_PUBLIC_API_BASE_URL` is browser-visible** — it must resolve
   from the *user's host machine/browser*, not from inside the Docker
   Compose network. Do not point it at an internal service DNS name
   (e.g. `http://api:8000`); it must stay `http://localhost:8000` (or
   whatever port you publish the API container on) since the browser
   running on the host, not another container, is what calls it. Next.js
   inlines `NEXT_PUBLIC_*` vars at build time — make sure the build-time
   `ARG`/`ENV` in the web Dockerfile actually gets this value before
   `npm run build` runs, and document that changing it requires an image
   rebuild (a real Next.js/Docker limitation, not a bug to work around).
3. **`WEB_ORIGIN`** (backend CORS) is the inverse — it must stay the
   browser-facing web origin (`http://localhost:3000`), not an internal
   compose hostname, since CORS validates the browser's `Origin` header.
4. **This repo's current Azure AI resource has `disableLocalAuth=true`, so
   `CU_API_KEY` is not obtainable at all.** `az cognitiveservices account
   keys list` fails for the mapped resource (`aif-idp-dev-isfpt7snlrame` in
   `rg-idp-dev`) with `disableLocalAuth=true`. That means the containerized
   path must support the same Entra-ID/Azure-CLI login flow as the host-process
   backend today. The practical local-dev pattern is to:
   - install Azure CLI in the API/worker image,
   - mount the host `~/.azure` directory into the API/worker containers
     read-only (matching the container user's home directory), and
   - let `DefaultAzureCredential` / `AzureCliCredential` inside the container
     reuse the host's existing `az login`.
   Verify this actually works in-container; a UID/home-dir mismatch or missing
   `az` binary is a common failure mode. `CU_API_KEY` may still be documented
   as an optional fallback for other CU resources where local auth is enabled,
   but it is not the primary path for this environment.
5. **Do not break the existing host-process dev workflow.** Every other
   task's "Test Instructions" in this plan (and `DEMO.md`) run
   `uv run uvicorn ...` / `npm run dev` directly on the host against
   `docker compose up -d`'s emulators-only default. Add the new
   api/worker/web services as an **opt-in Compose profile** (e.g.
   `profile: app`) so plain `docker compose up -d` continues to start
   only the three emulators exactly as before; a new
   `docker compose --profile app up -d --build` (or equivalent) is what
   starts the fully containerized stack. State this explicitly in the
   root `README.md`.

## Scope

**In scope:**
- `apps/api/Dockerfile`: multi-stage build using `uv` (match the
  `requires-python = ">=3.12"` pin), producing a single image reused for
  **both** the API server and the worker (they share the same
  dependencies/codebase) — differentiate via the Compose service's
  `command` (`uvicorn app.main:app --host 0.0.0.0 --port 8000` vs.
  `python -m app.worker.main`), not two separate images, to avoid
  duplication/drift.
- `apps/web/Dockerfile`: multi-stage Next.js production build
  (`npm ci` → `npm run build` → slim runtime stage running
  `npm run start` or the Next.js `standalone` output, whichever is
  smaller/simpler given this repo's Turbopack/Tailwind setup — confirm
  `next build` succeeds in a container before committing to an approach,
  since Turbopack's build path is newer/less battle-tested than webpack).
- `docker-compose.yml`: add `api`, `worker`, `web` services behind a
  `profile: ["app"]` (or equivalent), with:
  - correct internal service-DNS hostnames for Cosmos/Azurite/Mailpit
    connection strings (adjusting the gotcha #1 TLS issue above),
  - `depends_on` with `condition: service_healthy` on the three existing
    emulator health checks,
  - `env_file: .env` (or explicit `environment:` passthrough) for
    CU/observability/app config, keeping `NEXT_PUBLIC_API_BASE_URL` and
    `WEB_ORIGIN` host-facing per gotchas #2/#3,
  - published ports matching today's host-process convention (`8000`
    for API, `3000` for web) so existing bookmarks/docs/`DEMO.md` steps
    (browsing `http://localhost:3000`) keep working unchanged,
  - a basic healthcheck for the `api` service (reuse `/healthz`).
- `.env.example` / root `README.md`: document the new
  `docker compose --profile app up -d --build` containerized-run path
  side-by-side with the existing host-process instructions, including
  the host-`az login` + mounted `~/.azure` pattern from gotcha #4 and
  the note that `CU_API_KEY` is optional/unavailable for some resources.
- `.dockerignore` files for `apps/api` and `apps/web` (exclude
  `.venv`/`node_modules`/`.next`/test artifacts/`samples` if not needed
  at runtime, etc.) to keep build contexts/images lean.

**Out of scope:**
- Any change to production/Azure deployment (Bicep/AKS) — this task is
  purely about **local** containerized execution on the user's machine,
  consistent with `TECHNOLOGY.md`'s dev/prod mapping (`Compute` row:
  local = Docker Compose, prod = AKS is a separate, not-yet-scheduled
  concern).
- Rewriting or "fixing" the emulator services already in
  `docker-compose.yml` — only add to it.
- CI workflow changes (`.github/workflows/*.yml`) — task 15b already
  covers real CI dispatch and remains separately deferred/blocked; if
  you want to reuse these new Dockerfiles from CI later, that is a
  natural follow-up, not required here.
- Any change to task 22's `apps/web/lib/use-object-url.ts` viewer fix —
  out of scope; if you validate the containerized web app's
  `inference-review` screen as part of this task's smoke test (a good
  idea, since it's the first time the app runs in a **production**
  Next.js build rather than dev mode), just confirm it still works and
  report it — do not modify it.

## Acceptance Criteria

- **Given** a fresh checkout with `.env` populated (real CU endpoint/model
  config, and either `az login` already performed on the host or a valid
  `CU_API_KEY` for resources that allow local auth), **when** the user runs
  `docker compose --profile app up -d --build`, **then** all six
  containers (3 emulators + api + worker + web) reach a healthy/running
  state without manual intervention.
- **Given** that stack, **when** the user browses to
  `http://localhost:3000`, **then** the app loads and behaves identically
  to the host-process dev workflow (can create a process, upload a
  document, see it processed, review it).
- **Given** that stack, **when** `uv run python scripts/seed.py
  --api-base-url http://localhost:8000` is run from the host (or from
  inside the `api` container), **then** it completes successfully exactly
  as it does against the host-process backend.
- **Given** a plain `docker compose up -d` (no profile flag), **when** it
  completes, **then** only the three original emulator containers start —
  confirming the existing default workflow is unaffected.
- **Given** the containerized web app, **when** a real inference-review
  job page is opened, **then** the PDF/image viewer renders correctly
  (this is a production Next.js build — a good incidental regression
  check on task 22's fix, which was previously only verified under
  `next dev`).

## Test Instructions

```bash
# Full containerized stack
docker compose --profile app up -d --build
docker compose ps   # expect 6 healthy/running containers

curl -s http://localhost:8000/healthz
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/

# Seed and manually verify in a browser at http://localhost:3000
uv run python apps/api/scripts/seed.py --api-base-url http://localhost:8000

# Confirm default (no profile) behavior is unchanged
docker compose --profile app down
docker compose up -d
docker compose ps   # expect only the 3 emulator containers
```

Also re-run the existing non-live pytest/vitest suites unmodified
afterward to confirm no source changes in this task broke anything:

```bash
cd apps/api && uv run pytest -m "not live"
cd apps/web && npm run lint && npx tsc --noEmit && npm run test
```

## Definition of Done

- [x] `apps/api/Dockerfile` builds and runs both API and worker roles
      correctly (verified by actually running both from the built image).
- [x] `apps/web/Dockerfile` builds a production Next.js image that serves
      the app correctly (verified live, not just a successful build).
- [x] `docker-compose.yml` updated with `api`/`worker`/`web` behind an
      opt-in profile; default `docker compose up -d` behavior unchanged
      (verified by actually running it and checking `docker compose ps`).
- [x] Cosmos emulator TLS-verification gotcha resolved with an explicit,
      narrowly-scoped opt-in mechanism (not a blanket relaxation), with a
      unit test.
- [x] Full containerized stack smoke-tested end-to-end: seed script runs
      against it, a real document upload → review → approve flow works
      through the browser at `http://localhost:3000`.
- [x] `.env.example` and root `README.md` updated with the new
      containerized-run instructions and the mounted-`~/.azure` auth note
      (with `CU_API_KEY` described only as an optional fallback where
      local auth is enabled).
- [x] Existing non-live pytest/vitest/lint/tsc suites re-run and still
      pass (no regressions from Dockerfile/compose changes to app code,
      other than the narrowly-scoped TLS-verification change above).
