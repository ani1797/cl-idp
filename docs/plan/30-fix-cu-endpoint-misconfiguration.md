# Task 30 — Fix Misconfigured `CU_ENDPOINT` (Content Understanding Was Never Actually Unreachable)

## Status

Done

## Why This Exists

During prior QA passes, `GET /analyzers` consistently returned
`502 content_understanding_unavailable`, and the `seed` container's
custom-analyzer training step consistently failed. This was **incorrectly
diagnosed** as "the sandbox has no network egress to Azure Content
Understanding" and treated as an accepted, unfixable environment
limitation across several prior sessions. The user corrected this
("We should be using CU!!!") during a live UI QA pass and prompted a
proper investigation.

## Actual Root Cause

`apps/api/.env` had:

```
CU_ENDPOINT=https://aif-idp-dev-isfpt7snlrame.services.ai.azure.com/
CU_MODEL_DEPLOYMENT=gpt-5-mini-405642
```

That hostname does not exist — `getent hosts` / `curl` both fail with
DNS `NXDOMAIN` from the host, not a connectivity/firewall block. General
Azure hostnames (`management.azure.com`, `login.microsoftonline.com`)
resolved fine, which is what exposed that this was a bad hostname, not a
blocked network.

Cross-checking `az resource list` against the logged-in subscription
found the actual, already-provisioned AI Foundry resource for this
project: `clidpprod-foundry` in resource group `rg-cl-idp-prod-eus2`
(name matches the `cl-idp` repo), with:

- Endpoint: `https://clidpprod-foundry.cognitiveservices.azure.com/`
- `publicNetworkAccess: Enabled` — genuinely reachable, not
  private-endpoint-gated.
- Already has every custom analyzer this project defines
  (`canada_life_invoice`, `cheque_verification`, `drug_prior_auth_glp1`,
  `group_benefits_application`, …) registered from prior work.
- `GET /contentunderstanding/defaults` reports
  `modelDeployments: {"gpt-5-mini": "gpt-4.1-mini", "prebuilt-analyzer-embedding": "text-embedding-3-small"}`
  — the configured `gpt-5-mini-405642` deployment name never existed on
  this (or any accessible) resource either.

`app/cu/client.py` uses `DefaultAzureCredential` (no `CU_API_KEY` is
set), which resolves via the host's `az login` session — already mounted
read-only into the `api`/`worker`/`seed` containers via
`${HOME}/.azure:/azure-host/.azure:ro` in `docker-compose.yml`, copied
into `AZURE_CONFIG_DIR` by `docker-entrypoint.sh`. That auth path was
never the problem; the endpoint value was.

## Fix

`apps/api/.env`:

```diff
-CU_ENDPOINT=https://aif-idp-dev-isfpt7snlrame.services.ai.azure.com/
-CU_MODEL_DEPLOYMENT=gpt-5-mini-405642
+CU_ENDPOINT=https://clidpprod-foundry.cognitiveservices.azure.com/
+CU_MODEL_DEPLOYMENT=gpt-4.1-mini
```

`CU_MODEL_DEPLOYMENT` must be the **deployment name** (the dict value),
not the CU-internal alias (the dict key) — `resolve_completion_model_name`
in `client.py` matches on value.

## Verification

- `GET /analyzers` (authenticated) → `200`, returns all 8 prebuilt +
  4 custom analyzers.
- Recreated `api`/`worker` containers with `docker compose up -d
  --force-recreate api worker`; `/healthz` stayed green throughout.
- Re-ran the `seed` container end-to-end
  (`docker compose --profile app up -d --force-recreate seed`):
  **exited 0**. Logs show every custom analyzer training to `status=ready`
  against live CU, every sample document processed
  (`job status: succeeded` for all 12 sample jobs across all 4
  processes), confidence-violation counts computed from real extraction
  results (not stubbed/fallback data).
- The dashboard's "Model health" panel (`dashboard-page.tsx`), which
  previously appeared to be stuck on a perpetual skeleton loader because
  the underlying `/analyzers` query was retrying against a dead host,
  now resolves normally.

## Follow-up: Stale Routing Analyzers (discovered immediately after this fix)

Fixing `CU_ENDPOINT` was necessary but not sufficient. Every existing
process's `routingAnalyzerStatus` was already `ready` in the database —
that status was set when the routing analyzer was (attempted to be)
created against the **old, nonexistent** endpoint, so provisioning
should have failed loudly at the time, but the stale `ready` flag
persisted across the endpoint fix and made it look, from the DB's point
of view, like nothing needed to be redone.

Symptom: uploading a document against a "Ready" process queued the job
successfully, but the worker's `analyzeBinary` call against the routing
analyzer ID (e.g. `idp_r_c5146cd16cb4`) returned `404 Not Found` — that
analyzer had never been created on the real `clidpprod-foundry`
resource. The worker correctly caught this and returned the job to the
queue with a 300s visibility-timeout backoff (by design, for transient
CU issues), but a permanently-missing analyzer meant every retry would
fail identically forever without manual intervention.

**Fix:** re-ran `provision_process_routing_analyzer` (the same function
`main.py` schedules as a background task on process create/update) for
every existing process, one-off, via `docker compose exec api python3
-c "..."` using the app's own `get_settings()` / `create_data_store()`
/ `provision_process_routing_analyzer()`. All 5 processes went to
`routingAnalyzerStatus: ready` with real, existing routing + derived
analyzers on `clidpprod-foundry`. The previously-stuck job
(`cb956148-…`, attempt 3) then succeeded end-to-end on its next
scheduled retry: 97% confidence, 7/7 fields extracted, `drug_prior_auth_glp1`
detected — confirmed live in the UI (process detail → recent jobs).

**Residual risk / follow-up:** this class of bug (DB state says `ready`
but the backing CU analyzer doesn't actually exist) can recur any time
`CU_ENDPOINT` changes environments without a corresponding
re-provisioning pass. There's no current reconciliation job or health
check that detects "routing analyzer status says ready but a 404 comes
back from CU" and self-heals; today it silently retries forever on a
5-minute backoff with no operator-facing signal beyond the job's stored
`error` string. Worth a future task: either (a) have the worker flip the
process back to `routingAnalyzerStatus: FAILED` after N consecutive
`404`s so it surfaces in the UI/dashboard instead of hanging silently,
or (b) add a startup/health check that reconciles routing analyzer
existence against the configured CU endpoint.

## Provenance Check (per explicit user request)

Confirmed via `infra/main.parameters.json` and
`infra/modules/content-understanding.bicep` that `clidpprod-foundry`
(`namePrefix=clidpprod` → `${namePrefix}-foundry`, in
`rg-cl-idp-prod-eus2`) is **exactly** the Bicep-defined, IaC-provisioned
resource for this project — not a coincidentally-named lookalike. Its
model deployment (`gpt-4.1-mini`) also matches
`main.parameters.json`'s `cuModelName`. No other CU/AI Foundry resource
in the subscription is referenced anywhere in the app config; this is
the only Azure endpoint reference in the entire `apps/api/.env`. Going
forward, `CU_ENDPOINT`/`CU_MODEL_DEPLOYMENT` should always be sourced
from this Bicep module's outputs (`endpoint`, `modelName`) for any
non-local environment, never hand-typed.

## Follow-ups

- Re-run the full live Playwright QA pass now that CU is genuinely live
  — prior "expected failure" assumptions about analyzer loading,
  dashboard model health, and process creation should all be
  re-validated against real success paths, not just error-state UX.
- Consider whether `.env.example` / onboarding docs should call out that
  `CU_ENDPOINT` must point to a real, reachable AI Foundry / Cognitive
  Services resource with Content Understanding capability enabled, and
  that `CU_MODEL_DEPLOYMENT` must be a deployment **name**, to prevent
  this class of misconfiguration recurring.
- Consider adding a reconciliation/self-heal mechanism for stale
  `routingAnalyzerStatus: ready` records (see residual risk above).

## Addendum — "Could Not Load Source Document" (found during the re-run QA pass)

### Symptom

While re-running the full-role QA pass requested above, the Reviewer and
IT Admin review workbenches showed **"Could not load source document"**
for jobs in two processes: **Claims Intake Forms** and **Accounts Payable
Invoices**. The user flagged this explicitly as a real, unacceptable bug
("User can't view the PDF!!!"), not a benign seed quirk.

### Root Cause

These two processes were never part of `scripts/seed.py`'s
`PROCESS_SCENARIOS` (which defines only 3 processes: Group Benefits,
Drug Prior Authorization, and the cheque human-in-the-loop process).
They were leftover artifacts from an **earlier session's manual/ad-hoc
test-data seeding** (checkpoint 003), done at a time when CU was
believed unreachable — job and process documents were inserted directly
into MongoDB via `store.upsert_process`/`store.upsert_job` to populate
UI screens with variety, **without ever uploading a corresponding blob**
to Azurite. Confirmed via `BlobService.list_blob_names()` (the app's
API-version-pinned wrapper) that the `documents` container held exactly
13 blobs, all under the 3 canonical seeded processes — zero blobs
existed for either orphaned process's `blobPath`s. One of the orphaned
jobs (`invoice-acme-0095.pdf`) was also independently stuck in `queued`
status.

### Fix

Now that CU is genuinely live (per the fix above), this synthetic
workaround data is obsolete and permanently broken by construction (no
document was ever real). Deleted both orphaned processes — and their
jobs and any partial blobs — via the app's own
`DELETE /processes/{processId}` endpoint (authenticated with
`X-Service-Token`, which cascades job + blob cleanup before removing the
process document), rather than patching them with mismatched
substitute files. This restores the app to a fully-consistent state
where every process/job is either a genuine `seed.py` scenario or a
real, live-triggered upload — no DB-only fabrications.

### Verification

- `GET /processes` now returns exactly the 3 canonical processes.
- Every remaining job (13 total) across all 3 processes is `status:
  succeeded`, with no stragglers stuck in `queued`.
- Scripted a full sweep of `GET /processes/{id}/jobs/{id}/document`
  across all 13 jobs: **13/13 return 200** (previously 0/8 for the
  orphaned jobs).
- Live Playwright: logged in as IT Admin, confirmed zero console errors
  on `/dashboard` and `/review-queue`, opened a real flagged job from
  the Review Queue (`Bluewave_Logistics_Partners_issue_handwritten.pdf`,
  43% average confidence, 14 fields needing adjudication) and confirmed
  the source-document pane renders the actual PDF with OCR field
  overlays — no "Could not load source document" error.
- Re-ran the full Vitest suite: **76/76 tests pass**, no regressions.

