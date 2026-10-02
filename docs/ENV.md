# Environment Variables

Every setting below is read via `apps/api/app/config.py`'s `Settings`
(`pydantic-settings`), which **both the `api` and `worker` apps share** —
the worker (`apps/worker/function_app.py` in Azure, or
`python -m app.worker.main` locally/in Docker Compose) imports the exact
same `app.config.get_settings()` as the FastAPI backend, so there is no
separate worker-specific settings class. The `web` app (Next.js) has its
own, much smaller set of server-side env vars, listed separately below.

`Settings` loads, in order, `./.env` (repo root) then `apps/api/.env`
(later files win), both optional — see `env_file` in `config.py`. Copy
[`.env.example`](../.env.example) to `.env` and fill in real values for
local/manual (non-Docker-Compose) runs. Docker Compose's `app` profile
injects most of these directly as container `environment:` instead (see
[docker-compose.yml](../docker-compose.yml)) and does not require a `.env`
file to exist, though `env_file:` entries are still honored if one is
present for overrides.

In Azure, these are App Service/Function App **application settings**,
wired by `infra/main.bicep` — secrets are injected as Key Vault references
(`@Microsoft.KeyVault(SecretUri=...)`), not plaintext values. See
[`infra/README.md`](../infra/README.md) and
[`docs/spec/TECHNOLOGY.md`](./spec/TECHNOLOGY.md#rbac-permissions) for the
full production wiring and the managed-identity RBAC grants that replace
connection-string/API-key auth wherever possible.

## `api` / `worker` (shared `Settings`)

### Datastore

| Variable | Default | Purpose |
|---|---|---|
| `DB_BACKEND` | `mongo` | Selects the datastore backend: `mongo` (MongoDB Atlas-compatible — used against the local `mongo:7` container and Azure Cosmos DB for MongoDB RU API in production) or `cosmos` (Cosmos DB's native/Core SQL API, kept as a config-selectable fallback against the Cosmos DB Emulator). Both are fully implemented (`app/db/mongo.py`, `app/db/cosmos.py`) and tested. |
| `MONGO_CONNECTION_STRING` | `mongodb://localhost:27017/?directConnection=true` | Used when `DB_BACKEND=mongo`. Points at the local `mongo:7` Compose service for local dev; in Azure, resolved from Key Vault (`mongoSecretUri`) to the Cosmos DB for MongoDB RU API connection string. |
| `MONGO_DATABASE_NAME` | `enterprise-idp` | Database name within the Mongo-compatible connection above. Not in `.env.example` — rarely needs overriding. |
| `COSMOS_CONNECTION_STRING` | Cosmos DB Emulator's documented default key | Used when `DB_BACKEND=cosmos`. Targets the local Cosmos DB Emulator by default. |
| `COSMOS_TLS_INSECURE` | `false` | Local-only escape hatch: skip TLS verification when the API/worker reach the Cosmos Emulator by its Docker Compose service DNS name (self-signed cert) rather than `localhost`. Leave `false` everywhere else. |

### Blob storage and queue

| Variable | Default | Purpose |
|---|---|---|
| `AZURITE_BLOB_CONNECTION_STRING` | Azurite's documented default dev key | Blob storage connection string for the `documents` container (uploaded source files). Despite the name, this is also the production Azure Storage connection string in Azure (resolved from Key Vault, `storageSecretUri`) — the variable name is a holdover from local dev against Azurite. |
| `AZURITE_QUEUE_CONNECTION_STRING` | Azurite's documented default dev key | Queue storage connection string for the `jobs` queue (async job dispatch, consumed by the worker). Same production/Key-Vault note as above. |
| `BLOB_CONTAINER_NAME` | `documents` | Blob container name. Not in `.env.example` — rarely needs overriding. |
| `QUEUE_NAME` | `jobs` | Storage queue name. Not in `.env.example` — rarely needs overriding. |

### Mail (review-needed notifications)

| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | `127.0.0.1` | SMTP relay host. Local dev default targets the Mailpit catcher. |
| `SMTP_PORT` | `1025` | SMTP relay port. Local dev default targets Mailpit. |
| `MAIL_AUTH_MODE` | `none` | `none` (unauthenticated — Mailpit/legacy internal open relay) or `basic` (SMTP AUTH with `SMTP_USERNAME`/`SMTP_PASSWORD`). Use `basic` for M365 SMTP AUTH, SendGrid, Mailgun, or a private authenticated relay. |
| `MAIL_TLS_MODE` | `none` | `none`, `starttls` (typical for port 587 authenticated relays), or `smtps` (implicit TLS, typical for port 465). |
| `SMTP_USERNAME` | unset | Only used when `MAIL_AUTH_MODE=basic`. |
| `SMTP_PASSWORD` | unset | Only used when `MAIL_AUTH_MODE=basic`. In production, resolved from Key Vault, never committed to `.env`. |
| `MAIL_FROM_ADDRESS` | `enterprise-idp@localhost` | From address on outbound notification emails. Authenticated relays typically require a verified/allowed sender. |

### Web/API integration and auth

| Variable | Default | Purpose |
|---|---|---|
| `WEB_ORIGIN` | `http://localhost:3000` | Allowed browser origin for FastAPI CORS, and the base URL the worker uses to build "review needed" email links (`app/worker/main.py`). In Azure, set to the `web` App Service's public URL. |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Declared in `Settings` for parity with `.env.example`/Docker Compose, but **not read anywhere in `apps/api`** today — it is consumed at build/run time by the `web` app instead (see below). Harmless to leave set; `extra="ignore"` means an unrecognized var would not error either way. |
| `JWT_SECRET` | auto-generated, ephemeral | Signs the httpOnly session-cookie JWT. Leave blank only for local throwaway dev — the API generates an ephemeral secret and logs a warning, which invalidates sessions on every restart. Set a long random value in any shared/production environment (Key Vault in Azure). |
| `JWT_ALGORITHM` | `HS256` | JWT signing algorithm for the shared-secret setup. |
| `JWT_EXPIRY_MINUTES` | `480` | Browser session lifetime. |
| `API_TOKEN_EXPIRY_MINUTES` | `60` | Lifetime of bearer tokens minted by `POST /auth/token` — short-lived by design; meant for scripts/ad-hoc testing, not long-running services. |
| `SESSION_COOKIE_NAME` | `cl_idp_session` | httpOnly cookie name for browser sessions. The frontend must send `credentials: "include"` on every request. |
| `SESSION_COOKIE_SECURE` | `false` | Set `true` only when serving the API over HTTPS (always `true` in Azure). |
| `SESSION_COOKIE_SAMESITE` | `lax` | `lax` works when web/api share a site for cookie purposes (e.g. both on `localhost`). When web and api live on different `*.azurewebsites.net` subdomains (different sites per the Public Suffix List), browsers silently drop a `lax` cookie on credentialed cross-site calls — those deployments must set this to `none`, which in turn requires `SESSION_COOKIE_SECURE=true` (browsers reject `SameSite=None` without `Secure`). Not in `.env.example`; set explicitly to `none` in `infra/main.bicep`'s api app settings. |
| `SERVICE_API_TOKEN` | unset | Static bearer token for non-interactive service access (seed scripts, workers, e2e tests) — send as `Authorization: Bearer <token>`. Separate from the per-user tokens `POST /auth/token` mints. In production, resolved from Key Vault. Never commit a real value. |

### Demo users

| Variable | Default | Purpose |
|---|---|---|
| `DEMO_IT_ADMIN_EMAIL` / `DEMO_IT_ADMIN_PASSWORD` | unset | Seeded by `apps/api/scripts/seed.py`. |
| `DEMO_REVIEWER_EMAIL` / `DEMO_REVIEWER_PASSWORD` | unset | Seeded by `apps/api/scripts/seed.py`. |
| `DEMO_END_USER_EMAIL` / `DEMO_END_USER_PASSWORD` | unset | Seeded by `apps/api/scripts/seed.py`. |

One user is created per display-only role label; passwords are hashed with
argon2 by the API. Never commit real passwords.

### Observability

| Variable | Default | Purpose |
|---|---|---|
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | unset | When set, OpenTelemetry exports traces/metrics/logs to Azure Monitor/Application Insights instead of the console exporter. In Azure, set automatically from the shared Log Analytics/Application Insights resource (`infra/modules/log-analytics.bicep`). |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | When set, all telemetry is exported via OTLP/HTTP instead (e.g. the Compose `otel-collector` service, or any local OpenTelemetry Collector/Grafana Alloy). Takes precedence over `APPLICATIONINSIGHTS_CONNECTION_STRING`. `docker compose up` sets this automatically for the containerized `api`/`worker` services; set it manually (e.g. `http://127.0.0.1:4318`) when running them as host processes against the Compose-provided collector. |

### Azure AI Content Understanding

| Variable | Default | Purpose |
|---|---|---|
| `CU_ENDPOINT` | `""` | Azure AI Content Understanding endpoint, e.g. `https://{account}.cognitiveservices.azure.com/`. Required before starting the API/worker in any mode that touches Content Understanding — there is no emulator. |
| `CU_API_KEY` | unset | Optional. Leave blank when the Azure AI resource has local auth disabled (`disableLocalAuth: true`, the production default) and you authenticate via `az login`/managed identity instead. The Compose `app` profile mounts the host's `~/.azure` directory so the `api`/`worker` containers can reuse that Azure CLI login. |
| `CU_MODEL_DEPLOYMENT` | `""` | Content Understanding's completion-model deployment name (production default `gpt-4.1-mini`, see `infra/modules/content-understanding.bicep`'s `modelName`). |

### Azure Foundry AI Agent Judge (pre-judgement)

A best-effort, advisory LLM pre-judgement the worker runs after
extraction, before a job is handed to a human reviewer — see
[`spec/TECHNOLOGY.md`](./spec/TECHNOLOGY.md#azure-foundry-ai-agent-judge-pre-judgement)
for the full design. Disabled by default; no emulator, like CU, so
enabling it requires a real Foundry project and incurs real (small) cost
per adjudication.

| Variable | Default | Purpose |
|---|---|---|
| `JUDGE_ENABLED` | `false` | Master switch. When `false` (or the project endpoint/model aren't configured), the worker skips the judge entirely, `job.judge` stays `null`, and the UI renders exactly as it does without the feature. |
| `JUDGE_PROJECT_ENDPOINT` | unset | Foundry Agent Service project endpoint, e.g. `https://{account}.services.ai.azure.com/api/projects/{project}` — a different endpoint *shape* than `CU_ENDPOINT`. Leave blank to derive it automatically from `CU_ENDPOINT` (same underlying Azure AI Foundry account) via `project_endpoint_from_cu_endpoint()`. |
| `JUDGE_MODEL_DEPLOYMENT` | `gpt-5-mini` | Model deployment backing the judge agent — deliberately **different** from `CU_MODEL_DEPLOYMENT` (`gpt-4.1-mini` in production) so judge calls never compete with Content Understanding analysis calls for the same deployment's RPM/TPM quota. `infra/modules/content-understanding.bicep` provisions this as its own isolated deployment whenever the judge model differs from the CU model. |
| `JUDGE_AGENT_NAME` | `cl-idp-review-judge` | Name the judge's versioned Foundry agent is created/reused under in the project (visible in the Foundry portal's **Agents** tab). Resolved-or-versioned once per process, not recreated per run. |
| `JUDGE_TIMEOUT_SECONDS` | `45` | Per-job timeout for the judge's agent call (passed straight through to the Responses API call) before giving up and leaving the job without a recommendation. |
| `JUDGE_MAX_FIELDS` | `25` | Upper bound on how many low-confidence fields are sent to the judge per job; excess fields are truncated, not sent, and never error. |

Authentication is the same `DefaultAzureCredential` chain as Content
Understanding (`az login` locally, system-assigned managed identity in
Azure — RBAC role `Foundry User` in addition to `Cognitive Services User`,
granted by `infra/modules/rbac-ai-agents.bicep`).

## `web` (Next.js)

The frontend has its own, much smaller env surface — it does not read
`apps/api`'s `Settings` at all.

| Variable | Where | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Build arg (`apps/web/Dockerfile`'s `ARG`/`ENV`), default `http://localhost:8000` | Baked into the client JS bundle at **build time** (standard Next.js `NEXT_PUBLIC_*` semantics) for any code path that needs the API's base URL in the browser. |
| `API_BASE_URL` | Runtime container env, e.g. `http://api:8000` (Compose) or `https://{namePrefix}-api.azurewebsites.net` (Azure) | Server-side target for the same-origin `/api-proxy/[...path]` route handler (`apps/web/app/api-proxy/[...path]/route.ts`). **Must be reachable from the server the Next.js process runs on**, not the browser — this is what lets the browser treat the session cookie as same-origin even though `web` and `api` are different Azure App Services/sites, sidestepping `SameSite`/third-party-cookie restrictions entirely. Required: the proxy route throws if unset. |
| `HOSTNAME` / `PORT` | Runtime container env (Compose: `0.0.0.0`/`3000`) | Standard Next.js standalone-server bind address/port. |

No other runtime env vars are read by `apps/web` source (verified by
grepping for `process.env.*` outside `node_modules`/`.next`/test
tooling). Playwright-specific vars (`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`,
`CI`) only affect `apps/web/playwright.config.ts` and are not part of the
running application.

## Docker Compose "app" profile

`docker compose --profile app up` injects every `api`/`worker` variable
above directly as container `environment:` (pointed at the compose-local
`mongo`/`cosmosdb-emulator`/`azurite`/`mailpit`/`otel-collector` services)
rather than requiring a `.env` file — see the `api`/`worker`/`web`/`seed`
service definitions in [`docker-compose.yml`](../docker-compose.yml). An
`env_file:` entry for `./apps/api/.env` and `./.env` is still honored for
local overrides (e.g. `CU_ENDPOINT`, `JUDGE_*`, `JWT_SECRET`,
`SERVICE_API_TOKEN`, `DEMO_*`), since those require real Azure
values/secrets that can't have a safe baked-in default. The `seed` service
only needs `CL_IDP_API_BASE_URL`, `SERVICE_API_TOKEN`, and the `DEMO_*`
vars — it talks to the already-running `api` service over HTTP rather than
importing `Settings` directly.

## Azure production (`infra/`)

In Azure, none of the above are hand-set — `infra/main.bicep` wires them
as App Service/Function App application settings, sourcing values from:

- **Key Vault references** (`@Microsoft.KeyVault(SecretUri=...)`) for
  secrets: `MONGO_CONNECTION_STRING`, `AZURITE_BLOB_CONNECTION_STRING`,
  `AZURITE_QUEUE_CONNECTION_STRING`, `JWT_SECRET`, `SERVICE_API_TOKEN`,
  and (if configured) `SMTP_PASSWORD`.
- **Module outputs** for endpoints: `CU_ENDPOINT` and
  `JUDGE_PROJECT_ENDPOINT` from `contentUnderstanding.outputs`,
  `WEB_ORIGIN`/`API_BASE_URL` from the sibling App Service's hostname.
- **Bicep parameters** (`infra/main.parameters.json`) for everything else
  configurable per-environment: `judgeEnabled`, `judgeModelDeployment`,
  `judgeAgentName`, `cuModelName`/`cuModelVersion`, mail settings, image
  tags, SKUs, etc. — see `infra/main.bicep`'s `param` declarations for the
  full list and defaults.
- **Fixed overrides** that only make sense in production:
  `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAMESITE=none`.

See [`infra/README.md`](../infra/README.md) and
[`docs/DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) for the full deployment
walkthrough, and
[`docs/spec/TECHNOLOGY.md`](./spec/TECHNOLOGY.md#rbac-permissions) for the
managed-identity RBAC grants that replace connection-string/API-key auth
wherever Azure RBAC makes that possible (Storage, Key Vault, Cognitive
Services, and — for the judge — the Foundry Agent Service and its
Application Insights connection).
