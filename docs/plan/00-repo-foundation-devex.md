# Task 00 — Repo Foundation & Dev Environment

## Status

Done

## Objective

Stand up the monorepo skeleton, local dependency emulators, and the
baseline CI checks — the shared ground every other task builds on. No
feature logic lives here.

## Spec References

- `docs/spec/TECHNOLOGY.md` — Repository Layout, Local Development
  Environment, CI/CD sections.

## Scope

**In scope:**
- Monorepo layout: `apps/web`, `apps/api`, `packages/shared`, `infra/`
  (empty placeholder), `docs/` (already exists).
- `apps/api`: uv-managed Python project skeleton (`pyproject.toml`), empty
  FastAPI app that serves `GET /healthz` returning `{"status": "ok"}` (no
  dependency checks yet — that's task 02/05).
- `apps/web`: Next.js app skeleton (TypeScript), Tailwind CSS + shadcn/ui
  installed and configured, no real screens yet (default landing page ok).
- `docker-compose.yml`: Cosmos DB Emulator, Azurite (blob + queue),
  Mailpit — all with published ports and healthchecks.
- `.env.example` at repo root covering: Cosmos connection string, Azurite
  connection strings, SMTP host/port, `WEB_ORIGIN`, `CU_ENDPOINT`,
  `CU_API_KEY` (optional), CU model deployment name, and
  `NEXT_PUBLIC_API_BASE_URL` (consumed by task 09's `apps/web/lib/api.ts` —
  not named in `TECHNOLOGY.md`, so it won't surface from the grep in
  subtask 4 below; add it explicitly). **No real values, no secrets
  committed.**
- `.devcontainer/devcontainer.json` — uv, Python, Node, Docker-in-Docker
  access, post-create step that installs deps for both apps.
- GitHub Actions workflow skeleton: lint + type-check job for both apps,
  triggered on PR, needing no secrets (can be near-empty until 02/09 add
  real lint targets — just prove the workflow runs).
- Root `README.md` (repo root, not `docs/`) with quickstart: clone → devcontainer
  or docker-compose up → run api → run web.

**Out of scope:** any business logic, Cosmos/blob/queue client code
(task 02), real lint rules beyond framework defaults, the live-CU CI
workflow (task 15).

## Dependencies

None. This is the first task.

## Subtasks

1. Scaffold `apps/api` with `uv init`, add `fastapi`, `uvicorn`, `httpx`,
   `pytest`; add `/healthz` route; add a Makefile or `uv run` script to
   start it (`uv run uvicorn app.main:app --reload`).
2. Scaffold `apps/web` with `npx create-next-app` (TypeScript, App Router),
   add Tailwind, run `npx shadcn init`.
3. Write `docker-compose.yml` with the three emulator services and named
   volumes; confirm all three start and expose their default ports
   (Cosmos emulator 8081, Azurite 10000-10002, Mailpit 8025/1025).
4. Write `.env.example` with every variable name used across the spec
   (grep `docs/spec/TECHNOLOGY.md` for env var mentions, plus
   `NEXT_PUBLIC_API_BASE_URL` for the frontend — not documented in
   `TECHNOLOGY.md` but required by task 09) and placeholder (non-secret)
   values or comments.
5. Write `.devcontainer/devcontainer.json` referencing the compose file as
   an additional service, or documenting `docker compose up -d` as a
   manual post-create step if devcontainer-compose integration is more
   friction than it's worth.
6. Add `.github/workflows/ci.yml` with a `lint-and-typecheck` job: install
   uv + Python deps, run `ruff`/`mypy` (or equivalent) on `apps/api`;
   install Node deps, run `npm run lint` / `tsc --noEmit` on `apps/web`.
7. Write the root `README.md` quickstart.

## Acceptance Criteria

- **Given** a fresh clone of the repo, **when** a contributor runs
  `docker compose up -d`, **then** Cosmos DB Emulator, Azurite, and Mailpit
  all report healthy within a few minutes.
- **Given** the API skeleton, **when** run locally and
  `curl http://localhost:8000/healthz` is called, **then** it returns
  `200 {"status": "ok"}`.
- **Given** the web skeleton, **when** run locally and opened in a
  browser, **then** the default Next.js/Tailwind/shadcn page renders with
  no console errors.
- **Given** a pull request, **when** CI runs, **then** the
  lint-and-typecheck job completes (pass or documented expected-fail
  placeholder) without requiring any repository secret.
- **Given** `.env.example`, **when** compared against every env var named
  in `TECHNOLOGY.md`, **then** every one is present with a comment
  explaining it.

## Test Instructions

```bash
# Emulators
docker compose up -d
docker compose ps   # all three services "healthy"

# API
cd apps/api && uv run uvicorn app.main:app --reload --port 8000 &
curl -s http://localhost:8000/healthz   # {"status":"ok"}

# Web
cd apps/web && npm run dev &
curl -s http://localhost:3000 | head -5   # HTML renders, no 500

# CI locally (optional, mirrors the workflow)
cd apps/api && uv run ruff check . && uv run mypy .
cd apps/web && npm run lint && npx tsc --noEmit
```

Visually confirm the web page in a browser to check Tailwind/shadcn are
actually wired (a styled button/component from shadcn renders correctly,
not just plain HTML).

## Definition of Done

- [x] `docker compose up -d` brings up all three emulators healthy.
- [x] `apps/api` serves `/healthz`.
- [x] `apps/web` renders a styled page using at least one shadcn component.
- [x] `.env.example` covers every variable named in `TECHNOLOGY.md`.
- [ ] `.devcontainer` builds successfully ("Reopen in Container" works).
  - Task 18 re-ran `npx --yes @devcontainers/cli up --workspace-folder .`.
    A repo-side fix was applied (`docker-in-docker` now sets `"moby": false`),
    but the build still fails in this sandbox during the Node feature install
    with `npm ERR_SSL_SSL/TLS_ALERT_HANDSHAKE_FAILURE`, so this remains
    environment-limited rather than falsely checked.
- [ ] CI workflow runs on a test PR without secrets and passes.
  - Explicitly deferred with the same no-git-repo / no-remote blocker tracked
    by task 15b; task 18 did not attempt to fabricate a repo or PR.
- [x] Root `README.md` quickstart followed verbatim by someone unfamiliar
      with the repo gets them to a running API + web app.
