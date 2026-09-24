# Deployment Guide

How to deploy the entire Enterprise IDP platform — infrastructure, application
code, and demo data — into a single self-contained Azure resource group from
scratch. This is the exact sequence used to stand up the live environment; see
[`infra/README.md`](../infra/README.md) for infra-only reference details and
[`docs/spec/TECHNOLOGY.md`](spec/TECHNOLOGY.md) for the architecture narrative
and RBAC design behind each step.

## Overview

| # | Stage | Tool |
|---|---|---|
| 1 | Deploy infrastructure (Bicep) | `az deployment sub create` |
| 2 | Build & push container images (web, api) | `docker` / `az acr build` |
| 3 | Point App Services at the new images | `az deployment sub create` (re-run) |
| 4 | Deploy the worker (Azure Functions) | `infra/scripts/deploy-worker.sh` |
| 5 | Set Content Understanding model defaults | one-off Python (SDK) |
| 6 | Train the custom analyzers | `apps/api/scripts/train_custom_analyzers.py` |
| 7 | Seed the demo data | `apps/api/scripts/seed.py` |
| 8 | Verify | `/healthz`, browser/Playwright |

Everything lands in **one resource group** (default `rg-cl-idp-prod-eus2`) —
web, api, worker, Cosmos DB for MongoDB, Storage, Key Vault, AI
Foundry/Content Understanding, Container Registry, and Log
Analytics/Application Insights. Nothing is shared with or depends on another
resource group.

### Prerequisites

- Azure CLI (`az`), logged in (`az login`) with **Owner**/**Contributor +
  User Access Administrator** on the target subscription (the deployment
  creates RBAC role assignments).
- `docker` (for building the web/api images) — or rely on `az acr build` for
  the api image, which has no local build-context requirements.
- Python 3.12 + [`uv`](https://docs.astral.sh/uv/) for running the seed and
  training scripts from `apps/api`.
- Confirm App Service Plan / Function Consumption Plan quota exists in your
  chosen `computeLocation` (see [Region split](../infra/README.md#region-split)
  in the infra README) — some subscriptions default to zero quota in certain
  regions.

## 1. Deploy the infrastructure

```bash
az deployment sub create \
  --name cl-idp-prod-eus2 \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json
```

This is a **subscription-scope** deployment: it creates the resource group
itself, then every module inside it (Log Analytics, Key Vault, Storage,
Cosmos DB for MongoDB, AI Foundry/Content Understanding, Container Registry,
the web/api App Service plan + sites, and the worker Function App), plus all
RBAC role assignments between them. On first run, the web/api App Services
come up serving the platform's placeholder page — no application code is
running yet.

Capture the outputs for later steps:

```bash
az deployment sub show --name cl-idp-prod-eus2 --query properties.outputs -o json
```

Key outputs: `webAppUrl`, `apiAppUrl`, `workerAppName`, `keyVaultName`,
`cosmosMongoAccountName`, `storageAccountName`, `contentUnderstandingEndpoint`,
`containerRegistryLoginServer`.

## 2. Build and push the web and api images

The Container Registry (`clidpprodacr` by default) is created by step 1 with
admin auth **disabled** — App Services pull via managed identity (`AcrPull`).
For pushing new images, temporarily enable admin auth or use
`az acr build`, which runs the build server-side and pushes directly:

```bash
ACR=clidpprodacr   # containerRegistryLoginServer output, minus the domain suffix
TAG=$(date +%Y%m%d%H%M%S)   # always a unique tag — see note below

# api: no special build context needed
az acr build --registry "$ACR" --image "clidp-api:$TAG" apps/api

# web: needs the shared package as an extra build context, which
# `az acr build` cannot pass through — build locally and push instead
docker build \
  --build-context shared=./packages/shared \
  --build-arg NEXT_PUBLIC_API_BASE_URL="https://$(az deployment sub show --name cl-idp-prod-eus2 --query properties.outputs.apiAppUrl.value -o tsv)" \
  -t "$ACR.azurecr.io/clidp-web:$TAG" \
  -f apps/web/Dockerfile .
az acr login --name "$ACR"   # requires admin user or an ACR RBAC push role temporarily
docker push "$ACR.azurecr.io/clidp-web:$TAG"
```

> **Always use a brand-new tag, never `:latest`.** App Service can cache an
> image pull and silently skip a same-tag update, leaving the old code
> running with no error.

## 3. Point the App Services at the new images

Re-run the same deployment with the new tags — this is idempotent and only
touches what changed:

```bash
az deployment sub create \
  --name cl-idp-prod-eus2 \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json \
  --parameters webImageTag="$TAG" apiImageTag="$TAG"
```

`webImageTag` and `apiImageTag` are **independent parameters** — always
redeploy both together with matching new tags for a given release, or you
will unintentionally repoint one app at a stale/missing image while updating
the other.

Verify the API is healthy before moving on:

```bash
curl -sf "https://<apiAppUrl>/healthz" | jq
# {"status":"ok","dependencies":{"database":"ok","blob":"ok","queue":"ok"}}
```

## 4. Deploy the worker (Azure Functions)

The worker has no container image — it's deployed as a zip package containing
`apps/worker/*` plus a copy of `apps/api/app` (so the job-processing logic
isn't duplicated in source):

```bash
./infra/scripts/deploy-worker.sh
```

This packages the code with Python's `zipfile` module and deploys via
`az functionapp deployment source config-zip` to the Function App named in
the `workerAppName` output. Confirm the `jobs_worker` function registered:

```bash
az functionapp function list --name <workerAppName> --resource-group rg-cl-idp-prod-eus2 -o table
```

> `apps/worker/host.json` sets `extensions.queues.messageEncoding` to
> `"none"` — the API sends queue messages as plain JSON text, not the
> Functions queue trigger's default Base64. Without this the worker silently
> drops every message into the `jobs-poison` queue after 5 retries, with no
> visible exception anywhere except an App Insights trace saying
> `"Message has reached MaxDequeueCount of 5"`.

## 5. Set Content Understanding model defaults

Content Understanding requires per-environment "defaults" — a completion
model and (specifically) the literal key `prebuilt-analyzer-embedding` — set
once before any custom analyzer can be trained or run:

```bash
cd apps/api
CU_ENDPOINT="<contentUnderstandingEndpoint output>" \
uv run python - <<'PY'
from app.config import Settings
from app.cu.client import CuClient

client = CuClient(Settings())
client._sdk_client.update_defaults(  # ContentUnderstandingClient.update_defaults
    body={
        "modelDeployments": {
            "gpt-5-mini": "gpt-4.1-mini",
            "prebuilt-analyzer-embedding": "text-embedding-3-small",
        }
    }
)
print("defaults set")
PY
```

This step authenticates with your own Azure identity (`az login`), so
temporarily grant yourself `Cognitive Services User` on the Foundry account:

```bash
az role assignment create \
  --assignee "$(az ad signed-in-user show --query id -o tsv)" \
  --role "Cognitive Services User" \
  --scope "$(az cognitiveservices account show --name <foundryAccountName> --resource-group rg-cl-idp-prod-eus2 --query id -o tsv)"
```

Remember to remove this role assignment again once training (step 6) is
done — the API and worker's own managed identities are the intended callers
in normal operation.

## 6. Train the custom analyzers

```bash
cd apps/api
CU_ENDPOINT="<contentUnderstandingEndpoint output>" uv run scripts/train_custom_analyzers.py
```

Trains and verifies all four demo analyzers (`drug_prior_auth_glp1`,
`group_benefits_application`, `canada_life_invoice`, `cheque_verification`)
against the sample documents in `samples/`. If you hit transient `429`
rate-limit errors during a training burst, bump the completion model's
`modelCapacity` in `infra/modules/content-understanding.bicep` and redeploy
(step 1) before retrying.

## 7. Seed the demo data

```bash
cd apps/api
uv run scripts/seed.py --api-base-url "https://<apiAppUrl>"
```

Idempotent — creates the three demo business processes, uploads every sample
file, and waits for each job to reach a terminal state. Safe to re-run at any
time (it cleans up any stale/legacy process names from earlier iterations
first).

## 8. Verify

```bash
curl -sf "https://<apiAppUrl>/healthz" | jq
curl -sf "https://<apiAppUrl>/processes" | jq '.[].status'
```

Then open `https://<webAppUrl>` in a browser (or drive it with Playwright)
and confirm the seeded processes and their job history — extracted fields,
confidence scores, cost estimates, "Succeeded" statuses — render correctly.

## Troubleshooting

See the ["Status"](../infra/README.md#status) section of `infra/README.md`
for the full list of Cosmos DB for MongoDB compatibility gaps and other
gotchas discovered while bringing this environment up live (collation index
support, unfiltered-sort indexing, queue message encoding, image-tag
caching).

## Tearing down

```bash
az group delete --name rg-cl-idp-prod-eus2 --yes --no-wait
```

Deletes every resource in one call — nothing in this stack lives outside the
resource group.
