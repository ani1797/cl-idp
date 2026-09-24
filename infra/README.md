# Infrastructure

Bicep infrastructure-as-code for the Enterprise IDP production-shaped Azure
deployment. Deploys a **single, self-contained resource group** with
everything the application needs — no cross-resource-group dependencies.

## Layout

```
infra/
├── main.bicep                 # subscription-scope entry point — creates the RG and wires modules
├── main.parameters.json       # default parameter values
└── modules/
    ├── log-analytics.bicep          # Log Analytics workspace + Application Insights
    ├── key-vault.bicep              # Key Vault (RBAC authorization mode)
    ├── storage.bicep                # Storage account: "documents" blob container, "jobs" queue
    ├── cosmos-mongo.bicep           # Azure Cosmos DB for MongoDB (RU API) — db + collections
    ├── content-understanding.bicep  # AI Foundry account + project + model deployment
    ├── kv-secret.bicep              # Writes a secret into an existing Key Vault
    ├── app-service.bicep            # Generic Linux App Service (plan + site) — used for web and api
    ├── function-app.bicep           # Linux Consumption Function App (worker)
    ├── rbac-local.bicep             # Role assignments on storage + Key Vault (same RG)
    └── rbac-cognitive-services.bicep # Role assignment on the Content Understanding account
```

## Topology

| Component | Azure service | Notes |
|---|---|---|
| web    | App Service (Linux, Node 20) | Next.js frontend |
| api    | App Service (Linux, Python 3.12) | FastAPI trigger/query API |
| worker | Function App (Linux, Python 3.12, Consumption) | Queue-triggered pipeline worker, replaces `apps/api/app/worker/main.py`'s standalone loop |
| db     | Azure Cosmos DB for MongoDB (RU API) | Same `pymongo`/`mongodb://` code path as local dev (`DB_BACKEND=mongo`) — **not** MongoDB Atlas, since Atlas isn't ARM/Bicep-deployable |
| blob/queue | Storage account | "documents" container, "jobs" queue |
| AI    | Azure AI Foundry (`AIServices` account + project + `gpt-4.1-mini` deployment) | Content Understanding — provisioned in this RG, not shared/reused |
| secrets | Key Vault (RBAC-authorized) | Holds the Cosmos Mongo connection string; apps read it via Key Vault references |
| observability | Log Analytics + Application Insights | Diagnostic settings on every App Service/Function App |

See [`docs/spec/TECHNOLOGY.md`](../docs/spec/TECHNOLOGY.md) ("Azure
Production Architecture" and "RBAC Permissions") for the full narrative and
the [architecture diagram](../docs/architecture/) for the resource-group
visual. For the full step-by-step process to stand up a live environment
end-to-end (infra + app code + worker + demo data), see
[`docs/DEPLOYMENT-GUIDE.md`](../docs/DEPLOYMENT-GUIDE.md).

## Deploy

```bash
az deployment sub create \
  --name cl-idp-prod-eus2 \
  --location eastus2 \
  --template-file infra/main.bicep \
  --parameters infra/main.parameters.json
```

This is a **subscription-scope** deployment: it creates the resource group
(`rg-cl-idp-prod-eus2` by default) itself, then deploys every module into it.

### Region split

Two region parameters exist because this subscription currently has **zero
App Service Plan / Function Consumption Plan quota in `eastus2`** (a default
for sponsorship/internal subscriptions) while `canadaeast` has quota:

- `location` (default `eastus2`) — Cosmos DB, Key Vault, Content
  Understanding/AI Foundry, Log Analytics.
- `computeLocation` (default `canadaeast`) — App Service Plans, Function App
  (and its storage account, which Azure Functions requires to be co-located
  with the compute).

Both regions' resources live in the **same resource group** — this is a
resource-placement choice, not a second resource group. If your subscription
has App Service quota in `eastus2`, set `computeLocation` to `eastus2` too.

### Governance tag

`tags.SecurityControl = 'Ignore'` is applied to every resource (and the
resource group). This tenant's built-in governance policies
(`StorageAccount_PublicNetwork_Modify`,
`StorageAccount_DisableLocalAuth_Modify`, `KeyVault_PublicNetwork_Modify`,
`CosmosDB_PublicNetwork_Modify`) force `publicNetworkAccess = Disabled` and
`allowSharedKeyAccess = false` on new Storage/Key Vault/Cosmos DB resources
by default. The Function App Consumption plan cannot reach
network-restricted storage, and non-VNet-integrated App Service cannot reach
a private Key Vault/Cosmos endpoint — so this demo genuinely needs public
reachability, and `SecurityControl: Ignore` is the policy authors' own
documented exemption tag for exactly this case (checked at resource **or**
resource-group scope). A real production deployment would instead add VNet
integration + private endpoints and drop this tag.

### Content Understanding

Provisioned fresh in this resource group (`AIServices` account + project +
a `gpt-4.1-mini` `GlobalStandard` deployment) rather than reused from any
other environment, per the "everything self-sufficient and enclosed in the
resource group" requirement. `disableLocalAuth: true` — the API and worker
managed identities are the *only* way to call it (RBAC `Cognitive Services
User`, no API key fallback).

## Outputs

| Output | Description |
|---|---|
| `webAppUrl` | Public URL of the Next.js web app |
| `apiAppUrl` | Public URL of the FastAPI API |
| `workerAppName` | Function App name (worker) |
| `keyVaultName` | Key Vault name |
| `cosmosMongoAccountName` | Cosmos Mongo API account name |
| `storageAccountName` | Storage account name |
| `contentUnderstandingEndpoint` | AI Foundry / Content Understanding endpoint |

## Status

Deployed, **application code is live, and the demo is seeded and verified
working end-to-end** against a live Azure subscription
(`rg-cl-idp-prod-eus2` in `eastus2`) — web, api, and worker are all serving
real traffic, not the platform's default placeholder page.

- **web** (`clidpprod-web`) and **api** (`clidpprod-api`) run as Linux
  container App Services, pulling `clidp-web`/`clidp-api` images from the
  Bicep-managed Container Registry (`clidpprodacr`) via managed identity
  (`AcrPull`, no admin user/credentials). Build and push new images with
  `az acr build --registry clidpprodacr --image clidp-<app>:<tag> ...`
  (the web image needs `docker build --build-context shared=./packages/shared`
  locally, since `az acr build` doesn't support `--build-context`), then
  redeploy with `webImageTag`/`apiImageTag` set to the new tag — **always use
  a unique tag, never re-deploy `:latest`**, since App Service can cache
  image pulls and silently skip a same-tag update.
- **worker** (`clidpprod-worker`) is a Python Azure Functions app
  (`apps/worker/function_app.py`, queue-triggered on the `jobs` queue) that
  wraps the same job-processing logic used by the local/standalone worker
  (`apps/api/app/worker/main.py`). Deploy it with
  `infra/scripts/deploy-worker.sh` — this packages `apps/worker/*` together
  with a copy of `apps/api/app` (so the logic isn't duplicated in source)
  and zip-deploys it via `az functionapp deployment source config-zip`.
  **Important**: `apps/worker/host.json` sets
  `extensions.queues.messageEncoding` to `"none"`, because the API sends
  queue messages as plain JSON text, not Base64 (the Functions queue
  trigger's own default) — without this, every message is rejected at the
  binding level and silently ends up in the `jobs-poison` queue.
- **Custom Content Understanding analyzers** must be trained once per
  environment (`apps/api/scripts/train_custom_analyzers.py`, requires
  `Cognitive Services User` on the Foundry account and CU "defaults" set
  for both a completion and an embedding model deployment via
  `ContentUnderstandingClient.update_defaults(...)` — see that script's
  docstring/comments) before `apps/api/scripts/seed.py` can create demo
  business processes.
- Known Cosmos DB for MongoDB (RU API) compatibility gaps fixed in
  `apps/api/app/db/mongo.py`: it does not support the `collation` index
  option (falls back to a case-sensitive unique index) and requires an
  explicit index on any field used in an unfiltered `.sort()`.

