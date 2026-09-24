# Enterprise IDP

Enterprise IDP is a monorepo with a FastAPI backend, a Next.js frontend,
and local Azure-compatible emulators for development.

## Repository layout

- `apps/api` — uv-managed FastAPI skeleton
- `apps/web` — Next.js App Router skeleton with Tailwind + shadcn/ui
- `packages/shared` — placeholder for generated/shared contracts
- `infra` — placeholder for future Bicep

## Quickstart

### Option 1: Dev Container

1. Open the repository in VS Code.
2. Reopen in the provided dev container.
3. Ensure Content Understanding settings are available either in
   `apps/api/.env` or a repo-root `.env` copied from `.env.example` and
   filled in with real `CU_*` values. If your Azure AI resource has
   `disableLocalAuth=true`, make sure you are already signed in with
   `az login`; the containerized workflow below reuses that host Azure CLI
   session by mounting `~/.azure` read-only into the API/worker containers.
4. After the post-create step finishes, run:

   ```bash
   docker compose up -d
   ```

### Option 2: Local machine

1. Install Docker, Python 3.12+, `uv`, Node.js 24+, and npm.
2. Provide Content Understanding configuration:

   ```bash
   # If you already have apps/api/.env with real values, keep using it.
   # Otherwise:
   cp .env.example .env
   ```

   Before starting the API, replace the blank `CU_ENDPOINT` and
   `CU_MODEL_DEPLOYMENT` values in `.env`. Leave `CU_API_KEY` blank if
   you will authenticate with `az login` instead.

3. Start local dependencies:

   ```bash
   docker compose up -d
   ```

   This default command intentionally starts only the local dependency
   services (MongoDB, Cosmos DB Emulator, Azurite, Mailpit). MongoDB is the
   default datastore (`DB_BACKEND=mongo`); the Cosmos DB Emulator is kept
   running alongside it as a config-selectable fallback (`DB_BACKEND=cosmos`).
   This remains the recommended setup for the existing host-process
   API/worker/web workflow below.

## Run the API

```bash
cd apps/api
uv sync --dev
uv run uvicorn app.main:app --reload --port 8000
```

Health check:

```bash
curl http://localhost:8000/healthz
```

## Run the worker

This is required for uploads to progress from `queued`/`running` to a
terminal state.

```bash
cd apps/api
uv run python -m app.worker.main
```

## Run the web app

```bash
cd apps/web
npm install
npm run dev
```

Open <http://localhost:3000>.

## Optional: run the full stack in Docker Compose

Use the opt-in `app` profile when you want API, worker, and web containerized
alongside the existing emulators:

```bash
cp .env.example .env
```

Populate `CU_ENDPOINT` and `CU_MODEL_DEPLOYMENT` in the repo-root `.env`
(or `apps/api/.env`). Then choose one CU auth path:

- **Recommended for local dev / this repo's current Azure resource**:
  run `az login` on the host first. The Compose `app` profile mounts the
  host's `~/.azure` directory read-only into the API and worker containers and
  installs Azure CLI in the image so `DefaultAzureCredential` /
  `AzureCliCredential` inside the containers can reuse that login.
- **Optional when your CU resource allows local auth**: set `CU_API_KEY`.

Then build and start the full stack:

```bash
docker compose --profile app up -d --build
docker compose ps
curl http://localhost:8000/healthz
curl -I http://localhost:3000/
```

A one-shot `seed` container runs automatically on every `up` (after `api`
is healthy and `worker` has started): it trains/updates the custom Content
Understanding analyzers and seeds the three demo business processes (see
`DEMO.md` section 2 for exactly what gets created). It's idempotent —
existing processes/jobs are reused rather than duplicated — so you can
safely run `docker compose --profile app up -d` again at any time. Watch
its progress with `docker compose logs -f seed`; it can take several
minutes the first time since it trains real analyzers against Azure AI
Content Understanding.

Open <http://localhost:3000>.

Notes:

- `NEXT_PUBLIC_API_BASE_URL` and `WEB_ORIGIN` stay host-facing
  (`http://localhost:8000` / `http://localhost:3000`) even in containers,
  because the browser still connects from the host machine.
- The API/worker/seed containers mount `${HOME}/.azure` read-only and copy
  it into the container's writable Azure CLI config directory at startup.
  If `az login` works on the host but CU auth fails in containers, verify
  that the mount exists and that the container user is still `root` with
  home directory `/root`.
- The web image bakes `NEXT_PUBLIC_API_BASE_URL` in at build time. If you
  change it, rebuild with `docker compose --profile app up -d --build`.
- Stop the containerized app stack with `docker compose --profile app down`.
- In CI/production you would normally use a service principal via
  `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and `AZURE_TENANT_ID` rather than
  mounting a host Azure CLI session.
