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
  - `infra/` — Bicep IaC (added when productionizing)
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

- **Database**: **Azure Cosmos DB Emulator** locally → **Azure Cosmos DB** in
  production. Stores business process configuration (name, description,
  allowed analyzers, confidence threshold, owner email) and job/review records.
- **File/blob storage**: **Azurite** (Azure Storage emulator) locally →
  **Azure Blob Storage** in production. Stores uploaded documents (PDF,
  PNG, JPG, TIFF).
- **Async queue**: **Azurite Queue Storage** locally → **Azure Storage
  Queue** in production. Decouples the trigger endpoint from pipeline
  execution to support the async job/poll contract.

Using Azurite for both blob and queue storage means the backend talks to the
same Azure Storage SDK/API in dev and prod — only the connection
string/endpoint changes.

## Email Notifications

- **Local dev**: **Mailpit/MailHog** SMTP catcher running in Docker; the app
  sends real SMTP messages that are captured and viewable locally instead of
  being delivered externally.
- **Production**: real SMTP relay or **Azure Communication Services** /
  SendGrid, swapped in via configuration only (same SMTP-sending code path
  where possible).
- Used to notify the configured business owner email when an extraction
  falls below the process's confidence threshold. Sent synchronously by the
  backend job worker, exactly once per job, immediately after the job
  transitions to `succeeded` with a non-empty `confidenceViolations` list
  (single email listing all violating fields for that job — not one per
  field, and not resent on later re-poll/review).
- **Delivery is best-effort.** If the SMTP send fails, the error is logged,
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

- **Docker Compose** — spins up local dependencies: Cosmos DB Emulator,
  Azurite (blob + queue), Mailpit.
- **Azure AI Content Understanding is *not* containerizable** — a real Azure
  CU resource and credentials are a prerequisite for running the pipeline
  locally.
- **`.env` files** — local configuration and connection strings/keys
  (never committed; `.env.example` provided as a template, covering storage
  and Cosmos connection strings, SMTP settings, `WEB_ORIGIN`, and the CU
  endpoint/credential settings).
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

- **Bicep** — Azure-native IaC, added when standing up the production
  environment. Deferred until the demo needs a real Azure deployment, but
  the choice is fixed now so infra work follows Azure conventions
  consistently.

## Deployment Target (Production)

- **Azure Kubernetes Service (AKS)** — chosen as the eventual production
  target for expandability (multiple services, scaling pipeline workers
  independently from the API/web tiers). Local dev does not require
  Kubernetes; Docker Compose is sufficient until a production deployment is
  needed.

## Dev → Prod Mapping Summary

| Concern            | Local Dev                          | Production                              |
|---------------------|-------------------------------------|------------------------------------------|
| Database            | Cosmos DB Emulator                  | Azure Cosmos DB                          |
| File storage        | Azurite (Blob)                      | Azure Blob Storage                       |
| Job queue           | Azurite (Queue)                     | Azure Storage Queue                      |
| Content Understanding | **Real Azure CU (no emulator)**   | Real Azure CU                            |
| CU credential       | `az login` / DefaultAzureCredential | Managed identity                         |
| Email               | Mailpit (SMTP catcher)              | Azure Communication Services / SendGrid  |
| Auth                | None (any user)                     | None (or Entra ID if introduced later)   |
| Compute             | Docker Compose                      | Azure Kubernetes Service (AKS)           |
| Observability       | OpenTelemetry → console             | OpenTelemetry → Azure Monitor            |
| IaC                 | N/A                                  | Bicep                                    |

## Status

Ready for implementation.
