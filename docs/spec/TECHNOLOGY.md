# Technology Stack

This document defines the technology choices for **Enterprise IDP**, the
product name used in UI headers and documentation. The stack is optimized to
be **light and local for development**, with an explicit, low-friction path
to the equivalent production Azure services — mostly achieved by using
Azure-compatible emulators locally so dev and prod talk the same protocols.

The one exception is Azure AI Content Understanding, which has no emulator;
see [Azure AI Content Understanding](#azure-ai-content-understanding) below.

## Repository Layout

- **Monorepo**, single root:
  - `apps/web` — Next.js frontend
  - `apps/api` — FastAPI backend
  - `packages/shared` — shared types/contracts (e.g., generated OpenAPI
    client, common TS/py models) where useful
  - `infra/` — Bicep IaC (deployed; see [Azure Production
    Architecture](#azure-production-architecture))
  - `docs/spec/` — this spec

## Backend

- **Language/framework**: Python, managed with **uv**, served via
  **FastAPI**.
- **HTTP client**: **httpx** for outbound calls (Azure AI Content
  Understanding, other integrations).
- **Async job pattern**: backend exposes `POST /processes/{processId}/trigger`
  (enqueues a job, returns a job ID immediately) and
  `GET /processes/{processId}/jobs/{jobId}` (polls status/result), per the
  Pipeline Trigger API spec.
- **Image handling**: **Pillow** for server-side TIFF → PDF conversion (see
  Frontend), since browsers cannot render TIFF natively and a multi-page
  TIFF must stay navigable page by page.

## Azure AI Content Understanding

The full integration contract — resource model, routing/derived analyzers,
result shape, coordinate normalization, and service limits — lives in
[`CONTENT-UNDERSTANDING.md`](./CONTENT-UNDERSTANDING.md). The
technology-level choices are:

- **SDK**: **`azure-ai-contentunderstanding`** (Python, GA), falling back to
  direct REST via `httpx` for anything the SDK does not cover. This is *not*
  `azure-ai-documentintelligence`, which is a different service.
- **API version**: pinned to **`2025-11-01`** (GA).
- **Resource**: a **Microsoft Foundry** resource with a completion model
  deployment; endpoint shape
  `https://{resource-name}.services.ai.azure.com/`.
- **Authentication**: **`DefaultAzureCredential`** by default (`az login`
  locally, managed identity in production; RBAC role *Cognitive Services
  User*), with a static API key as a configured fallback for constrained
  environments.
- **No emulator exists.** Unlike every other dependency, Content
  Understanding cannot be run locally. **Local development requires a real
  Azure CU account** in one of its supported regions, and each analysis run
  incurs real (small) cost. `.env.example` documents the required
  `CU_ENDPOINT`, optional `CU_API_KEY`, and the model deployment name.

## Frontend

- **Framework**: **Next.js** (React, SSR-capable).
- **Package manager**: **npm**.
- **Styling/components**: **Tailwind CSS** with **shadcn/ui**.
- **Server state**: **TanStack Query** — it owns the polling, refetch, and
  cache-invalidation behavior the job/analyzer status screens depend on.
- **Forms/validation**: **react-hook-form** with **Zod** schemas.
- **Document rendering**: **react-pdf** (pdf.js) for PDFs and a native
  `<img>` for PNG/JPG. **TIFF is converted to PDF server-side** by the
  document passthrough route, because no browser renders TIFF natively and
  converting to PDF (rather than a flat image) keeps multi-page TIFFs usable
  in the same paged viewer as PDFs.
- Used for the business process onboarding UI and the side-by-side
  document/extraction review UI.

### Frontend ↔ Backend Wiring

The browser calls the FastAPI service **directly**; FastAPI configures
**CORS** for the web origin (`WEB_ORIGIN` env var). Next.js does not proxy
API traffic.

### API Contract Ownership

[`api/openapi.yaml`](./api/openapi.yaml) is **hand-written and
authoritative**. FastAPI implements it, and the TypeScript client in
`packages/shared` is **generated from the YAML** — so the spec leads the
implementation rather than trailing it.

## Data Storage

- **Database**: **MongoDB `mongo:7` community image** locally → **Azure
  Cosmos DB for MongoDB (RU-based API)** in production. Stores business
  process configuration (name, description, allowed analyzers, confidence
  threshold, owner email) and job/review records. Chosen over MongoDB Atlas
  because Atlas is a third-party SaaS marketplace product outside ARM/Bicep
  — it cannot be declared as IaC in this repo's `infra/` — while Cosmos DB
  for MongoDB is a native Azure resource that is wire-compatible with the
  **same `pymongo`/`mongodb://` code path** (`DB_BACKEND=mongo`) already
  used against the local `mongo:7` container. Only the connection
  string/TLS settings change between dev and prod; no application code
  branches on "which Mongo".
- **Backend abstraction**: a `DataStore` protocol (`app/db/base.py`)
  decouples routers/worker from the concrete database, with `MongoService`
  as the default implementation. **Azure Cosmos DB for NoSQL** remains
  available as a config-selectable fallback (`CosmosService`, same
  protocol) via the `DB_BACKEND=mongo|cosmos` setting, in case a deployment
  specifically wants the NoSQL API instead — both implementations are
  exercised by an identical backend-agnostic contract test suite
  (`tests/test_datastore_contract.py`) so they stay behaviorally
  equivalent.
- **Auth caveat**: unlike the Cosmos NoSQL API, Cosmos DB for MongoDB (RU)
  does not support Microsoft Entra ID data-plane authentication — access is
  by connection string/primary key only. The connection string is written
  to Key Vault as a secret at deployment time and read by the API/worker via
  App Service/Function App Key Vault references (resolved using their
  managed identity's `Key Vault Secrets User` role) — see [RBAC
  Permissions](#rbac-permissions) below.
- **File/blob storage**: **Azurite** (Azure Storage emulator) locally →
  **Azure Blob Storage** in production. Stores uploaded documents (PDF,
  PNG, JPG, TIFF).
- **Async queue**: **Azurite Queue Storage** locally → **Azure Storage
  Queue** in production. Decouples the trigger endpoint from pipeline
  execution to support the async job/poll contract.

Using Azurite for both blob and queue storage means the backend talks to the
same Azure Storage SDK/API in dev and prod — only the connection
string/endpoint changes. MongoDB uses the same driver (**pymongo**) and
`mongodb://` connection string protocol against the local container and
Atlas — only the connection string (and TLS/auth settings) changes between
environments.

## Email Notifications

- **Local dev**: **Mailpit/MailHog** SMTP catcher running in Docker; the app
  sends real SMTP messages that are captured and viewable locally instead of
  being delivered externally. Default config (`MAIL_AUTH_MODE=none`,
  `MAIL_TLS_MODE=none`) targets this unauthenticated relay.
- **Production**: a pluggable `MailSender` (`app/mail.py`) selects behavior
  purely from configuration, over the same SMTP-sending code path:
  - **Unauthenticated SMTP relay** (`MAIL_AUTH_MODE=none`) — for a legacy
    internal open relay, if one is already trusted/available.
  - **Authenticated SMTP relay** (`MAIL_AUTH_MODE=basic`, `MAIL_TLS_MODE=
    starttls` or `smtps`) — SMTP AUTH with credentials from Key Vault
    (`SMTP_USERNAME`/`SMTP_PASSWORD`), for providers such as Exchange
    Online/M365 SMTP AUTH, SendGrid, or Mailgun.
  - **Private authenticated relay** — identical authenticated-SMTP config as
    above, but the relay endpoint is only reachable over a private network
    path (VNet integration/private endpoint), so app/API/worker compute must
    be attached to the relevant VNet. This is an infra/networking concern
    layered on top of authenticated SMTP, not a distinct application code
    path.
  - Note: **Azure Communication Services (including ACS Email) is being
    retired** (new signups blocked Oct 2026, full retirement Sept 2028), so
    it should **not** be adopted for a new production deployment — use one
    of the modes above instead. It is used **only** for the hosted demo
    (see below), as a stop-gap until a real enterprise/M365 relay is
    available; Microsoft Graph `sendMail` was evaluated but is explicitly
    out of scope for this system.
- **Hosted demo (current state)**: the demo deployment (`rg-cl-idp-prod-eus2`)
  uses **Azure Communication Services Email** (Azure-managed domain) as an
  **authenticated SMTP relay** — `smtp.azurecomm.net:587`, STARTTLS, SMTP
  AUTH via a dedicated Entra app registration (client-secret credentials,
  password stored in Key Vault as `smtp-password`). This exercises the same
  `MAIL_AUTH_MODE=basic`/`MAIL_TLS_MODE=starttls` code path a real
  enterprise/M365 relay would use — no Graph consent or mailbox is
  required, only an Azure RBAC role assignment (`Communication and Email
  Service Owner`) scoped to the ACS resource. Provisioned by
  `infra/modules/communication-email.bicep`, gated behind the
  `enableAcsEmailDemo` parameter in `infra/main.bicep` (default `false` —
  do not enable for a real production deployment; swap to a real relay by
  setting `MAIL_AUTH_MODE`/`MAIL_TLS_MODE`/`SMTP_HOST`/`SMTP_USERNAME`/
  `SMTP_PASSWORD` directly instead).
- Used to notify the configured business owner email when an extraction
  falls below the process's confidence threshold. Sent synchronously by the
  backend job worker, exactly once per job, immediately after the job
  transitions to `succeeded` with a non-empty `confidenceViolations` list
  (single email listing all violating fields for that job — not one per
  field, and not resent on later re-poll/review).
- **Delivery is best-effort.** If the SMTP send fails (including auth/TLS
  failures against an authenticated or private relay), the error is logged,
  the job remains `succeeded`, and `notificationSent` stays `false`. A
  notification failure never fails a job whose extraction succeeded.

## Authentication

- **None for this demo** — no real identity provider is wired up; any user
  may onboard a process, and the trigger API is unauthenticated, per the
  feature specs. Auth can be introduced later (e.g., Microsoft Entra ID)
  without changing the core architecture.

  (This concerns *end-user* auth. The backend still authenticates to Azure
  services — see Azure AI Content Understanding above.)

## Security Posture — Not Production Ready

Stated explicitly so it is a decision rather than an omission. In its
current form the application:

- **Has no authentication or authorization.** Anyone who can reach the
  service can create, edit, and delete business processes.
- **Accepts unauthenticated document uploads** on
  `POST /processes/{processId}/trigger`.
- **Serves any stored document to any caller** who knows or guesses a
  process/job ID via `GET .../jobs/{jobId}/document`. IDs are UUIDs, which
  is obscurity, not access control.
- **Performs no malware scanning** on uploads.
- **Applies no rate limiting or quota**, so an open deployment can drive
  unbounded Content Understanding spend.

Consequently the service **must only be run locally or on a trusted private
network**. Before any real deployment it needs, at minimum: Entra ID
authentication, per-process authorization, upload scanning, and rate
limiting.

## Accessibility

**Out of scope for this demo**, stated explicitly. The bounding-box overlay
and review workflow in particular are not designed against WCAG criteria and
have no keyboard-equivalent story for the overlay interaction.

## Local Development Environment

- **Docker Compose** — spins up local dependencies: MongoDB (`mongo:7`),
  Azurite (blob + queue), Mailpit. The Cosmos DB Emulator is also available
  in the compose file for exercising the `DB_BACKEND=cosmos` fallback path.
- **Azure AI Content Understanding is *not* containerizable** — a real Azure
  CU resource and credentials are a prerequisite for running the pipeline
  locally.
- **`.env` files** — local configuration and connection strings/keys
  (never committed; `.env.example` provided as a template, covering storage
  and MongoDB/Cosmos connection strings, SMTP settings, `WEB_ORIGIN`, and
  the CU endpoint/credential settings).
- **`.devcontainer`** — VS Code/Codespaces devcontainer definition so a
  contributor can get a fully working environment (uv, Python, Node, Docker
  access) with a single "Reopen in Container."
- **Seed script + samples** — a seed command creates example business
  processes, `samples/` holds representative documents (invoice, receipt, an
  unrelated document to demonstrate the unclassified path), and `DEMO.md`
  documents the happy-path walkthrough.

## Testing

- **pytest** — backend unit and integration tests (FastAPI endpoints, queue
  processing, Content Understanding integration).
- **Vitest** — frontend unit/component tests (Next.js/React components).
- **Playwright** — end-to-end tests spanning frontend + API (e.g., upload →
  poll → review flow).

**Tests run against live Content Understanding.** There is no mock or
record/replay layer for CU: the integration's value is in its real behavior,
and a mock would mostly assert our own assumptions. The consequences are
accepted deliberately:

- Any test touching the pipeline requires CU credentials and incurs cost.
- Such tests are marked (e.g. `@pytest.mark.live`) and **skip cleanly** when
  credentials are absent, so a contributor without an account can still run
  lint, type checks, and the non-CU suites.
- Tests must tolerate real latency and non-deterministic extraction values —
  assert on structure, status transitions, and field presence rather than
  exact extracted strings.

## Observability

- **OpenTelemetry** instrumentation in the FastAPI backend (and Next.js
  where practical), exporting to console/local collector in dev.
- **Named spans** across the pipeline so a single document's journey is
  traceable end to end: `trigger.request`, `blob.write`, `queue.enqueue`,
  `worker.dequeue`, `cu.analyze.submit`, `cu.analyze.poll`,
  `job.persist`, `notify.email`, `review.save`.
- **Correlation ID** — generated on the trigger request, carried on the
  queue message, stamped onto the job document, and attached to every log
  record and span for that job. This is the only way to connect a synchronous
  HTTP request to the asynchronous work it caused.
- **Production**: switch exporter to **Azure Monitor / Application
  Insights** via configuration, no code changes to instrumentation points.

### Logging and PII

Uploaded documents may contain personal or commercially sensitive data.
**Field values and document content are never logged or attached to spans.**
Logs and traces carry only: process/job/correlation IDs, file name, field
*names*, confidence scores, counts, status transitions, and error messages.
There is no verbose payload-logging mode to accidentally leave enabled.

## CI/CD

- **GitHub Actions**.
- **On every pull request**: lint, type-check, frontend unit tests, and the
  backend tests that do not touch Content Understanding; build container
  images. This suite needs no secrets, so it works for fork PRs.
- **On `main`, nightly, and manual dispatch**: the full live-CU suite,
  including Playwright end-to-end runs, using repository secrets for the CU
  endpoint and credentials.
- This split exists because live tests cost money and cannot run on pull
  requests from forks, which have no access to secrets.

## Infrastructure as Code

- **Bicep** — Azure-native IaC, in [`infra/`](../../infra/). Deployed as a
  single **subscription-scope** template (`infra/main.bicep`) that creates
  its own resource group and every resource inside it — see [Azure
  Production Architecture](#azure-production-architecture) below.

## Deployment Target (Production)

- **Azure App Service (Linux) for both web and API tiers, Azure Functions
  for the worker** — chosen over Azure Kubernetes Service for this scale of
  system: three independently-scaling components (web, API, worker) map
  cleanly onto two App Service plans plus one Function App, with no
  cluster/control-plane to operate, patch, or pay for. AKS remains the right
  choice if the system grows into many more independently-versioned
  services; that migration is deferred until the demo needs it. Local dev
  does not require any of this — Docker Compose is sufficient.
- See [Azure Production Architecture](#azure-production-architecture) for
  the full compute/API-hosting rationale.

## Azure Production Architecture

The system deploys as three independently-scaling compute tiers plus shared
data/AI resources, all inside **one self-contained resource group**
(`infra/main.bicep` is a subscription-scope template that creates the
resource group itself — no dependency on any other resource group). See
[`infra/README.md`](../../infra/README.md) for the deploy command and
region/governance notes, and the [architecture
diagram](../architecture/canada-life-idp-azure-production-topology.md)
(rendered [SVG](../architecture/canada-life-idp-azure-production-topology.svg),
editable
[`.excalidraw`](../architecture/canada-life-idp-azure-production-topology.excalidraw))
for the visual resource-group layout.

### Compute topology

| Tier | Azure service | Why |
|---|---|---|
| **web** (Next.js) | **App Service** (Linux, Node 20) | Requirement. Standard hosting for a Next.js SSR app; independent App Service plan so it scales separately from the API. |
| **api** (FastAPI trigger/query API) | **App Service** (Linux, Python 3.12) | *This document's API hosting choice.* FastAPI's trigger endpoint and job-polling endpoints are long-lived HTTP request/response traffic with no natural per-message unit of work — a better fit for an always-on App Service than for a Functions HTTP trigger (which optimizes for short, bursty, per-invocation billing). App Service also gives the API the same hosting model and deployment mechanics (zip/container deploy, deployment slots, VNet integration path) as the web tier, keeping the two HTTP-facing components operationally uniform. Azure Container Apps was considered and rejected for now — it adds a revisions/ingress model this system doesn't yet need at this scale; it remains the natural next step if the API needs to scale to zero or run multiple container-based services. |
| **worker** (pipeline worker) | **Function App** (Linux, Python 3.12, Consumption) | Requirement. The worker is a pure queue consumer (`apps/api/app/worker/main.py`'s loop becomes a queue-triggered function bound to the `jobs` Storage Queue) — exactly the event-driven, scale-with-queue-depth shape Azure Functions is built for. It scales independently of, and fails independently from, the API that enqueues work. |

### Data / AI resources (shared by all three compute tiers)

| Resource | Purpose |
|---|---|
| **Azure Cosmos DB for MongoDB (RU API)** | Production database — see [Data Storage](#data-storage). |
| **Storage account** | `documents` blob container (uploaded files) + `jobs` queue (async job dispatch) + Function App content storage. |
| **Azure AI Foundry** (`AIServices` account + project + `gpt-4.1-mini` deployment) | Content Understanding — see [Azure AI Content Understanding](#azure-ai-content-understanding). Provisioned inside this resource group so the whole stack is independently deployable. |
| **Key Vault** (RBAC-authorized, no access policies) | Holds the Cosmos Mongo connection string; App Service/Function App read it via Key Vault references. |
| **Log Analytics + Application Insights** | Centralized logs/traces/metrics for all three compute tiers — see [Observability](#observability). |

### Region note

App Service Plan and Function App Consumption Plan quota is not guaranteed
in every region/subscription (this deployment's subscription had zero quota
in `eastus2` and needed `canadaeast`). `infra/main.bicep` exposes `location`
(data/AI resources) and `computeLocation` (App Service/Function App +
their co-located storage) as separate parameters for exactly this reason —
both still deploy into the one resource group.

## RBAC Permissions

Every compute identity is a **system-assigned managed identity** with the
minimum Azure RBAC roles it needs — no shared credentials, no
subscription-level Contributor grants, and (per [Data
Storage](#data-storage)) the Content Understanding account has
`disableLocalAuth: true`, so RBAC is the *only* way to call it (no API-key
fallback in production).

| From (identity) | Role | On (scope) | Why |
|---|---|---|---|
| **api** App Service | `Storage Blob Data Contributor` | Storage account | Writes uploaded documents to the `documents` container; the document-passthrough route reads them back. |
| **api** App Service | `Storage Queue Data Contributor` | Storage account | Enqueues a message per triggered job onto the `jobs` queue. |
| **api** App Service | `Key Vault Secrets User` | Key Vault | Resolves the Cosmos Mongo connection string via a Key Vault reference (`MONGO_URI` app setting). |
| **api** App Service | `Cognitive Services User` | AI Foundry account | Calls Content Understanding to analyze documents synchronously where applicable and to list available analyzers. |
| **worker** Function App | `Storage Blob Data Contributor` | Storage account | Reads the uploaded document from the `documents` container to submit for analysis. |
| **worker** Function App | `Storage Queue Data Contributor` | Storage account | Consumes (dequeues/deletes) messages from the `jobs` queue — this is also the Function App's queue *trigger* binding. |
| **worker** Function App | `Key Vault Secrets User` | Key Vault | Resolves the Cosmos Mongo connection string to persist job/review records. |
| **worker** Function App | `Cognitive Services User` | AI Foundry account | Submits documents to Content Understanding and polls for results — the actual pipeline call. |
| **web** App Service | `Key Vault Secrets User` | Key Vault | Reserved for future secrets (e.g. auth provider config) — the web tier has no direct Azure data-plane access today; it calls the API over HTTPS, never Azure resources directly. |
| *(none)* | — | — | Nothing is granted `Contributor`/`Owner` on the resource group; all access is scoped to the single resource each identity needs, at the resource level. |

Deployment-time role assignments (Bicep `modules/rbac-local.bicep` and
`modules/rbac-cognitive-services.bicep`) are made by whichever principal
runs `az deployment sub create` — that principal needs `Owner` or `User
Access Administrator` at the subscription/resource-group scope for the
duration of the deploy, but that is a one-time IaC-operator grant, not a
permission any application component holds at runtime.

## Dev → Prod Mapping Summary

| Concern            | Local Dev                          | Production                              |
|---------------------|-------------------------------------|------------------------------------------|
| Database            | MongoDB (`mongo:7`, Cosmos Emulator fallback) | Azure Cosmos DB for MongoDB (RU API)     |
| File storage        | Azurite (Blob)                      | Azure Blob Storage                       |
| Job queue           | Azurite (Queue)                     | Azure Storage Queue                      |
| Content Understanding | **Real Azure CU (no emulator)**   | Real Azure CU (Foundry account in the same resource group) |
| CU credential       | `az login` / DefaultAzureCredential | Managed identity + RBAC (`disableLocalAuth: true`, no API key) |
| Email               | Mailpit (SMTP catcher, unauthenticated) | Azure Communication Services Email, via authenticated SMTP relay (`smtp.azurecomm.net`, SMTP AUTH with an Entra app + client secret) — **demo-only**; see note below. A real production deployment should use an authenticated SMTP relay (M365 SMTP AUTH / Mailgun / etc.) or the same over a private VNet relay instead. |
| Auth                | None (any user)                     | None (or Entra ID if introduced later)   |
| Web compute         | Docker Compose                      | Azure App Service (Linux, Node)          |
| API compute         | Docker Compose                      | Azure App Service (Linux, Python)        |
| Worker compute       | Docker Compose                      | Azure Function App (Linux, Python, queue-triggered) |
| Observability       | OpenTelemetry → console             | OpenTelemetry → Azure Monitor            |
| IaC                 | N/A                                  | Bicep (`infra/`)                         |

## Status

Ready for implementation.
