# API performance deployment

Status: Deployed

## 1. Scope

Update the existing containerized FastAPI App Service only. No provisioning,
region changes, scaling, secret changes, worker deployment, or web deployment.
Keep unrelated uncommitted changes out of the performance commit.

## 2. Azure context

User approved `existing-production` through the deployment confirmation:
subscription `6c2eb3e0-ae84-4bce-9cfc-45d928e50254`,
resource group `rg-cl-idp-prod-eus2`, API `clidpprod-api`, compute region
Canada East, registry `clidpprodacr`.
Subscription name: `ME-MngEnvMCAP358470-aniaggarwal-1`.
Keep the existing B1 plan, VNet, private endpoints, storage identities and settings.
Provisioning inventory: zero new resources and zero additional compute capacity;
regional resource quotas are unchanged.

## 3. Recipe

recipe.type: azcli

Use a minimal Docker overlay and an immutable unique image tag. Its base is the
running image, pinned by digest:
`clidpprodacr.azurecr.io/clidp-api@sha256:f50e5af5a3f85bdafc80f017390d3864f26a22ceb719e9149e86f2aa8a995035`.
Rollback image: `clidpprodacr.azurecr.io/clidp-api:20261028-private-login-1`.
SHA-256 comparisons confirmed that all eight overlay targets in that image match
their pre-performance committed source. Copy only those eight changed application
files; do not rebuild or deploy unrelated local configuration, telemetry, storage,
worker, documentation, or infrastructure edits.

## 4. Comparison

Before deploying, run authenticated, read-only browser and API workloads.
Repeat the same workload, session, data, and concurrency after deployment.
Measure time to dashboard data, request latency, response errors, and summary
correctness. Do not equate public page-shell latency with data readiness.

Authenticated baseline captured on 2026-10-28 using existing demo-admin credentials
loaded into memory without logging them. Five fresh-context browser runs and five
concurrent API bursts, against the same process set:
dashboard KPI median 7629 ms; all-data median 7643 ms; API burst median 5608 ms;
summary median 5022 ms; data-request p95 6073 ms; zero response errors.
Detailed samples and response fingerprints are stored in session artifacts
`hosted-before.json` and the repeatable harness `benchmark-hosted.cjs`.

## 5. Release validation

- [x] All validation checks pass
  - [x] Core validation: Azure CLI, authenticated target, permissions and image-only scope.
        ARM/Bicep compile, validate and what-if are not applicable: no infrastructure
        template is submitted and the sole management change is the container image.
  - [x] Docker overlay build and source byte-for-byte verification.
  - [x] Policy compatibility: retain the existing approved registry, identities,
        VNet, private endpoints, TLS, SKU, settings and resource tags.
  - [x] Static role verification and live existing-role confirmation.

Confirm baseline image source compatibility, scoped changes, registry access,
managed-identity image-pull permissions, dependency health, and regression tests.

The existing API identity has `AcrPull` on the existing registry. Registry public
access is enabled; no RBAC or network changes are needed. Prior focused validation:
65 API regressions, 8 Mongo summary tests and 14 Cosmos job/summary tests passed.
Whole-app Mypy has three pre-existing errors outside the performance changes;
changed-module Mypy and Ruff pass.

## 6. Deployment and rollback

Deploy only after validation. If health or functional checks fail, restore the
recorded image. Push scoped performance changes only after noticeable hosted
improvement is demonstrated.

## 7. Validation Proof

Validated commands executed on 2026-10-28, completed at 17:37 UTC:

- `az account show --subscription 6c2eb3e0-ae84-4bce-9cfc-45d928e50254`:
  correct approved subscription.
- `az webapp show` and `az webapp config show`: approved running API, Canada East,
  existing B1 plan, Always On, managed-identity ACR pull, `/healthz`.
- `az acr manifest show-metadata`: rollback digest
  `sha256:f50e5af5a3f85bdafc80f017390d3864f26a22ceb719e9149e86f2aa8a995035`.
- `az acr login --subscription ... --name clidpprodacr`: successful registry auth.
- `docker build --file <session>/Dockerfile.performance --tag
  clidpprodacr.azurecr.io/clidp-api:20261028-perf-173627 apps/api`:
  succeeded, local image ID
  `sha256:a33df3c4dde37a7aaef8d54a81fd6da45adc87017980ccfd3432d8ea7038d5af`.
- SHA-256 comparison of every application Python source file in baseline and
  release containers: exactly eight intended files differ; all eight match the
  validated working-tree files. All other deployed application source is preserved.
- `docker run --rm --entrypoint python ... -c 'from app.main import app; ...'`:
  release container imports successfully.
- Scoped `ruff check` and `mypy --follow-imports=silent`: passed.
- `pytest tests/test_request_concurrency.py -q`: four tests passed.
- Prior targeted regression evidence remains applicable: 65 API tests, eight Mongo
  summary tests and fourteen Cosmos tests passed with these source changes.
- `curl --fail https://clidpprod-web.azurewebsites.net/api-proxy/healthz`:
  HTTP 200; database, Blob and Queue all `ok`.
- Static review of `rbac-local.bicep` and `rbac-acr.bicep`: existing data-plane
  roles are appropriate; no generated or modified infrastructure is deployed.
- `az role assignment list --assignee-object-id <api-principal> --all`:
  existing `AcrPull`, Blob/Queue Data Contributor, Key Vault Secrets User, and
  Cognitive Services User confirmed on their individual service resources.

No unresolved release validation failures. Unrelated whole-app static typing
errors are outside the release overlay and remain unchanged. No infrastructure
compile/validate/what-if or provisioning is performed for this image-only update.

## 8. Hosted deployment and comparison

Image-only rollout completed at 2026-10-28T17:38:39Z:
`clidpprodacr.azurecr.io/clidp-api:20261028-perf-173627`,
digest `sha256:a33df3c4dde37a7aaef8d54a81fd6da45adc87017980ccfd3432d8ea7038d5af`.
Five consecutive dependency-health checks passed. The application-settings
fingerprint is unchanged and post-deployment runtime roles remain correct.

Five authenticated browser runs and five equivalent eleven-request API bursts:

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| Dashboard KPI median | 7629 ms | 2517 ms | 67.0% |
| Dashboard all-data median | 7643 ms | 2530 ms | 66.9% |
| Summary median under concurrent load | 5022 ms | 1213 ms | 75.8% |
| Data request p95 under concurrent load | 6073 ms | 2468 ms | 59.4% |
| Full API burst median, including analyzer catalog | 5608 ms | 5236 ms | 6.6% |

All job-list and summary payload fingerprints match the baseline; no response
errors. The upstream analyzer-catalog call remains variable but no longer blocks
unrelated data requests. Noticeable user-visible improvement is achieved without
scaling resources or changing secrets. Samples and comparison are retained in
session artifacts `hosted-before.json`, `hosted-after.json`, and
`hosted-comparison.json`.
