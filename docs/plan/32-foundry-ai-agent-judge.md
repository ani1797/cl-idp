# Task 32 — Azure Foundry AI Agent Judge (Pre-Judgement)

## Status

Done

## Why This Exists

The review queue only ever showed reviewers *that* a field was
low-confidence, not *whether it was actually wrong*. Many flagged fields
are false positives — the extraction is correct but the model's own
confidence score was low (poor scan quality, an unusual layout, etc.) —
and reviewers had no signal to distinguish those from genuine mistakes
until they opened the document and checked by hand.

The user asked for an LLM-based **pre-judgement** step: for every field a
job flags for review (confidence below the process threshold), an Azure
Foundry AI Agent independently reads the source document's OCR text and
renders a verdict — `ok` (the extraction matches, likely a false
positive) or `fix` (the extraction is genuinely wrong, with a suggested
correction) — surfaced on the UI as a `JUDGE RECOMMENDS: OK | FIX` pill.
Explicitly **a pre-judgement, not a replacement**: it runs automatically
before a human ever opens the job, but never clears a violation,
auto-applies a value, or gates the existing review action — the human
still has the final word.

## Approach

### Evidence Strategy (Spiked First)

Before writing any production code, `apps/api/scripts/spikes/judge_spike.py`
ran live against the real dev Foundry resource to settle two open
questions: what evidence to give the model, and how to shape the response
schema so verdicts are self-consistent. Findings, carried into the
implementation:

- **Evidence = Content Understanding's own markdown/OCR text**, not page
  images. CU already extracts this during the original analysis
  (`extraction_content["markdown"]`), so no second expensive
  vision-model call or page-image plumbing is needed — the judge reads
  the same text CU itself would have reasoned over.
- **Response schema field order matters.** Asking the model for `verdict`
  before `rationale`/`matches` produced self-contradictory replies
  (`verdict: "ok"` with a rationale describing a mismatch). Reordering the
  JSON schema to `extractedValue → matches → rationale → verdict →
  suggestedValue` — forcing the model to commit to its reasoning before
  naming the verdict — eliminated this.

### Backend

- **Models** (`app/models/public.py`): `JudgeVerdict` (`ok`/`fix`/
  `unknown`), `JudgeStatus` (`completed`/`failed`), `JudgeFinding`,
  `JudgeReview`; `Job.judge: JudgeReview | None`.
- **Config** (`app/config.py`, `.env.example`): `JUDGE_ENABLED`,
  `JUDGE_PROJECT_ENDPOINT`, `JUDGE_MODEL_DEPLOYMENT`, `JUDGE_AGENT_NAME`,
  `JUDGE_TIMEOUT_SECONDS`, `JUDGE_MAX_FIELDS`.
- **`app/judge/schema.py`**: the strict response JSON schema plus a
  **tolerant parser** (`parse_judge_findings` / `build_judge_review`) that
  never raises except on a wholly unparseable reply — individual
  malformed findings degrade to `unknown` instead of failing the whole
  review (hallucinated paths dropped, missing flagged paths backfilled,
  invalid verdict strings coerced, `fix` without a usable value
  downgraded).
- **`app/judge/prompt.py`**: `collect_flagged_fields()` resolves
  `confidenceViolations` paths against the job's field tree (capped at
  `JUDGE_MAX_FIELDS`) and `build_user_message()` assembles the markdown +
  flagged-field evidence sent to the agent.
- **`app/judge/client.py`**: `JudgeClient` wraps `azure-ai-projects`'
  `AIProjectClient` against the Foundry **project** endpoint (a different
  shape than the CU **account** endpoint, derived via
  `project_endpoint_from_cu_endpoint()`). It uses the newer **Foundry
  Agent Service** "prompt agent" surface
  (`project.agents.create_version(agent_name=..., definition=
  PromptAgentDefinition(...))`) rather than the classic Assistants API —
  a versioned agent created this way is visible under the Foundry
  portal's **Agents** tab, unlike a classic `Assistant` object. Calls go
  through an agent-scoped OpenAI client
  (`project.get_openai_client(agent_name=..., allow_preview=True)`) using
  a single stateless `openai_client.responses.create(input=...,
  timeout=JUDGE_TIMEOUT_SECONDS)` call per adjudication — no
  thread/run/poll lifecycle and nothing to clean up afterward. The
  response JSON schema is bound to the agent at `create_version` time
  (`PromptAgentDefinition.text`), not passed per-call, because the
  Responses API rejects a per-call `text` format override once a request
  is agent-scoped (`400 invalid_payload`).
- **Worker** (`app/worker/main.py`): `run_judge()` — best-effort, called
  from `finalize_success()` only when `confidenceViolations` is non-empty
  and markdown evidence exists; any `JudgeError` is caught and turned into
  a `status: "failed"` `JudgeReview` rather than failing the job.
  `app/worker/result_mapping.py` gained `MappedJobResult.markdown` as the
  evidence bridge from the raw CU result.
- **OpenAPI** (`docs/spec/api/openapi.yaml`): `Job.judge` plus
  `JudgeReview`/`JudgeStatus`/`JudgeVerdict`/`JudgeFinding` schemas;
  regenerated `packages/shared/src/generated/api.ts`.

### Frontend

- **`components/brand/judge-badge.tsx`**: `JudgeBadge` (base pill —
  renders **nothing** unless `status === "completed"` and the
  recommendation is exactly `ok`/`fix`; an `unknown`/`failed` outcome is
  treated as "no judge" rather than shown as an ambiguous third pill
  state, since the user's spec only asked for `OK | FIX`),
  `JudgeReviewBadge` (job-level rollup), `JudgeFindingBadge` (per-field,
  looked up by path). Reuses the existing `confidence-pass`/
  `confidence-critical` color tokens and the `gavel` icon — no new design
  tokens.
- **`inference-review-page.tsx`**: `JudgeFindingBadge` next to each flagged
  field's confidence badge, with the finding's `rationale` surfaced as a
  hover tooltip rather than inline clutter. On a `fix` finding with a
  `suggestedValue`, the suggested value itself is shown explicitly as
  `Suggested: <value>` text next to an adjacent "Use suggestion" button, so
  the reviewer sees exactly what will be filled in before clicking anything
  — not just inferred from the rationale tooltip's prose. Clicking "Use
  suggestion" applies it through the existing `onValueChange` path — same
  as typing a correction by hand, so it's still a plain draft edit (visible
  in the field's input, reversible via "Reset") that only flows into the
  normal review payload and audit trail once the reviewer clicks "Apply &
  Approve" — never auto-applied or silently persisted. `JudgeReviewBadge`
  next to the job status in the header (`ReviewPanel` and
  `JobHeaderStrip`, including the nothing-to-review/already-reviewed
  states).
- **`review-queue-page.tsx`**: `JudgeReviewBadge` next to each row's
  "needs review" badge in the queue table.

## Scope

**In scope:** everything listed above — models, schema, client, prompt,
worker wiring, OpenAPI contract, pill component, and its wiring into the
inference-review and review-queue screens; automated tests for all of the
above; this plan file and the spec updates in `DATA-MODEL.md`,
`TECHNOLOGY.md`, `screen/inference-review.md`.

**Out of scope (explicitly deferred):**

- Any change to the human review contract (`PUT .../review`) — the judge
  never auto-applies `suggestedValue` or clears a violation.
- Re-running the judge on re-review, or re-adjudicating edited values —
  it reflects a single read at extraction time.
- A dedicated review-queue spec doc — none existed before this change
  either; `review-queue-page.tsx` remains undocumented in `docs/spec/`
  beyond this plan file, consistent with its state before this task.
- Any CI/live-deployment change — this task did not deploy to the Azure
  production environment; it was validated against the live Foundry dev
  resource during the spike and client implementation only (see Test
  Instructions).

## Key Design Points

- **Pre-judgement, not gate.** Every integration point (worker, API
  schema, UI) was built so the judge is purely additive: disabling
  `JUDGE_ENABLED`, a judge failure, or an unparseable reply all degrade to
  exactly the pre-existing behavior (no pill, job proceeds normally) —
  never a blocked save, a failed job, or a misleading error surfaced to
  the reviewer.
- **Only flagged fields, never the full extraction** — both for cost (an
  invoice with 40 fields and 2 violations only costs 2 fields' worth of
  judge reasoning) and because an "all green, 2 unreviewed" result is a
  distraction; the judge's job is specifically to help with the fields a
  human would otherwise have to open the document for.
- **Tolerant-by-default parsing** over strict validation-and-reject,
  because a judge that silently disappears half the time a model's JSON
  is slightly malformed is worse than one that degrades individual
  findings to `unknown` and keeps the rest of the review useful.

## Test Instructions

```bash
cd apps/api
uv run pytest tests/test_judge.py     # 22 tests: schema parsing, prompt
                                        # assembly, endpoint derivation,
                                        # run_judge worker wiring (fake client)
uv run pytest                          # full suite — 208/210 passing;
                                        # the 2 pre-existing failures
                                        # (test_observability_pii,
                                        # test_worker_e2e) are @pytest.mark.live
                                        # tests failing identically with this
                                        # change stashed out (unrelated live
                                        # CU resource state)
uv run ruff check .

cd ../web
npx vitest run components/brand/judge-badge.test.tsx \
  components/review-queue-page.test.tsx \
  components/inference-review-page.test.tsx    # 30 tests covering the pill
                                                # and the "Use suggestion" action
npx vitest run                          # full suite — 115/115 passing
npx tsc --noEmit
npx eslint .
```

Live-resource validation (not part of the automated suite, run manually
during implementation against the real dev Foundry project): CU analysis
of a sample invoice PDF with deliberately-wrong field values fed through
`JudgeClient.adjudicate()` → `build_judge_review()` produced correct `fix`
verdicts with accurate `suggestedValue`s; confirmed only one persistent
`cl-idp-review-judge` agent is created across repeated client
construction (no duplicate-agent leak).

A second, later live-testing pass (requested explicitly: "utilize all
your testing methods") exercised the full deployed stack rather than just
the client in isolation: real `JUDGE_*` config enabled, `api`/`worker`/
`web` Docker images rebuilt and redeployed, a realistic job seeded with a
real captured `JudgeReview` directly into the running Mongo/Azurite, then
driven end-to-end through a real login and Playwright browser session.
This caught and fixed two issues that unit tests alone could not have
surfaced:

- The running `api`/`worker`/`web` images were stale (built before the
  `judge` field/UI existed), so `GET .../jobs/{id}` 500'd with a Pydantic
  `extra_forbidden` error on the stored `judge` field. Fixed by rebuilding
  all three images — not a code defect, an environment-staleness issue.
- The "Use suggestion" one-click-apply action and the rationale tooltip
  (both specified above) had been scoped in the plan but never actually
  implemented during the initial build. Added both, verified live in the
  browser that clicking "Use suggestion" replaces the field's value with
  the judge's `suggestedValue` exactly, and added an automated regression
  test for it.

After both fixes, confirmed live in the browser (screenshots taken): the
header rollup pill, the three per-field pills (`OK`/`FIX`/`OK` matching
the seeded review exactly), the rationale tooltip, the "Use suggestion"
button, and the review-queue rollup pill all render and behave correctly
against the real running stack. Seeded test data was deleted afterward
and confirmed gone (404).

## Definition of Done

- [x] `app/judge/{__init__,schema,prompt,client}.py` written.
- [x] `JudgeVerdict`/`JudgeStatus`/`JudgeFinding`/`JudgeReview`/`Job.judge`
      models added and round-tripped through `model_dump`/`model_validate`.
- [x] `JUDGE_*` settings added to `app/config.py` and documented in
      `.env.example`.
- [x] Worker wiring: `run_judge()` called from `finalize_success()`,
      best-effort, never fails the job.
- [x] OpenAPI schema + generated TS client updated.
- [x] `JudgeBadge`/`JudgeReviewBadge`/`JudgeFindingBadge` built and wired
      into `inference-review-page.tsx` and `review-queue-page.tsx`,
      including the "Use suggestion" apply action and rationale tooltip.
- [x] `apps/api/tests/test_judge.py` written and passing (22/22); full
      backend suite passing except 2 pre-existing, unrelated live-Azure
      failures (verified identical on `main` without this change).
- [x] `components/brand/judge-badge.test.tsx` written; `review-queue-page
      .test.tsx` and `inference-review-page.test.tsx` extended; full
      frontend suite passing (115/115), `tsc --noEmit` and `eslint` clean.
- [x] `DATA-MODEL.md`, `TECHNOLOGY.md`, `screen/inference-review.md`
      updated.
- [x] Live-tested end-to-end against the real running Docker stack and a
      real browser session, not just unit/integration tests.
- [x] This task file created and registered in `docs/plan/README.md`.
- [x] Deployed to the live Azure production environment
      (`rg-cl-idp-prod-eus2`): `infra/main.bicep` wires `JUDGE_*` app
      settings into the worker Function App only, a new
      `infra/modules/rbac-ai-agents.bicep` grants the worker identity the
      `Foundry User` role on the existing Foundry account/project (needed
      for the Agents SDK, distinct from `Cognitive Services User`), and
      `judgeEnabled=true` is set in `main.parameters.json`. Deployed via
      `az deployment sub create` after a clean `what-if`; confirmed live
      that `clidpprod-worker` has the new app settings and the `Foundry
      User` role assignment resolves to the worker's service principal.
- [x] Post-deploy suggestion-accuracy re-verification: re-ran
      `scripts/live_judge_smoke2.py` against the live
      `clidpprod-foundry`/`clidpprod-project` (the same project now backing
      production) with a deliberately corrupted `VendorName` value
      ("Globex Industrial" vs. the document's "Contoso Supplies"). The
      judge correctly returned `verdict=fix` with
      `suggestedValue="Contoso Supplies"` for the corrupted field and
      `verdict=ok` for the untouched `InvoiceId`. Re-seeded a job with
      this review via `scripts/seed_judge_job.py` and confirmed in the
      browser (Playwright) that the "Use suggestion" button on the
      `VendorName` row replaces the input's "Globex Industrial" with the
      judge's "Contoso Supplies" suggestion. Test process/job cleaned up
      afterward.
- [x] UI clarity follow-up: added an explicit `Suggested: <value>` label
      next to the "Use suggestion" button in `inference-review-page.tsx`
      so the proposed correction is visible before a reviewer clicks
      anything (previously only inferable from the free-form rationale
      tooltip). Verified via `inference-review-page.test.tsx` (14/14),
      full frontend suite (115/115), `tsc --noEmit`/`eslint` clean, and a
      live Playwright check against the rebuilt local dev stack showing
      `"Suggested: Contoso Supplies"` rendered next to the button while
      the input still held the wrong value.
- [x] Production rebuild/redeploy pass (the `web`/`api` images and the
      worker's Bicep-managed settings had been updated earlier, but the
      live App Services were still serving container images built
      *before* the judge feature, and the worker Function App's actual
      zip-deployed code package had never been refreshed at all — only
      its app settings had). Rebuilt and pushed fresh, uniquely-tagged
      images (`clidp-web:20261002104000` via local `docker build
      --build-context shared=./packages/shared` + push, `clidp-api
      :20261002104000` via `az acr build`) to `clidpprodacr`, confirmed
      the web image's compiled bundle contains the new "Suggested:"
      label, updated `webImageTag`/`apiImageTag` in
      `infra/main.parameters.json`, redeployed via `az deployment sub
      create` after a clean `what-if`, redeployed the worker's code via
      `infra/scripts/deploy-worker.sh` (zip-deploy, status 4/success),
      restarted `clidpprod-web`/`clidpprod-api` to force a fresh image
      pull, and confirmed live: both App Services report the new image
      tag via `az webapp config container show`, both return HTTP 200,
      and `clidpprod-worker` reports `state=Running`.
- [x] Post-redeploy incident found and fixed: a user-uploaded job sat in
      the `jobs` queue indefinitely (`dequeueCount: 0`). Root cause:
      `apps/worker/requirements.txt` was a stale snapshot predating the
      judge feature, so it lacked `azure-ai-agents` (and `argon2-cffi`,
      added for auth around the same time) — the Function App's Python
      worker failed to index `jobs_worker` entirely
      (`ModuleNotFoundError: No module named 'azure.ai.agents'`,
      confirmed via an Application Insights trace/exception query), so
      the queue trigger never fired for anyone, not just judge-related
      jobs. Fixed by regenerating `apps/worker/requirements.txt` via `uv
      export --no-dev --no-hashes --format requirements-txt` from
      `apps/api/pyproject.toml`/`uv.lock` (the same mechanism noted in
      the file's own header comment), redeploying via
      `infra/scripts/deploy-worker.sh`, and confirming via Application
      Insights that `Functions.jobs_worker` now indexes and executes
      successfully, with the `jobs` queue back to empty.
- [x] **Migrated the judge agent from the classic Assistants API to the
      Foundry Agent Service** (per explicit user request: "migrate the
      classic assistants to new agents so we can see them in my
      foundry"). Rewrote `app/judge/client.py` to use `azure-ai-projects`'
      `AIProjectClient`/`project.agents.create_version(... ,
      PromptAgentDefinition(...))` and an agent-scoped OpenAI client
      (`project.get_openai_client(agent_name=..., allow_preview=True)`
      + `openai_client.responses.create(input=...)`) instead of
      `azure-ai-agents`'s `AgentsClient`/threads/runs — the versioned
      agent this creates is visible under the Foundry portal's **Agents**
      tab, unlike the old classic `Assistant` object. Key discovery: the
      Responses API rejects a per-call `text` JSON-schema override once a
      request is agent-scoped (`400 invalid_payload: "Not allowed when
      agent is specified"`), so the schema moved onto
      `PromptAgentDefinition.text` at `create_version` time instead.
      `pyproject.toml`/`uv.lock`/`apps/worker/requirements.txt` updated:
      `azure-ai-agents` removed, `azure-ai-projects`+`openai` added.
      Validated live against `clidpprod-foundry`/`clidpprod-project` via
      `scripts/live_judge_smoke2.py` (correct `ok`/`fix` verdicts with
      accurate `suggestedValue`); the old classic agent
      (`asst_q5RaHZpcz5vbr9KU7D6TZE9N`, `cl-idp-review-judge`) was left in
      place as a harmless orphan rather than force-deleted through a
      non-`infra/` script, per the "deployments only via infra/"
      constraint.
- [x] **Switched the judge off `gpt-4.1-mini`** (per explicit user
      request: "use model other than gpt-4.1-mini as the judge"), onto
      **`gpt-5-mini`** (`2025-08-07`, GA, supports Responses/agents). Real
      subscription quota was confirmed via `az cognitiveservices usage
      list -l eastus2` (not the misleading `maxCapacity` field from
      `list-models`) before choosing it. `infra/modules/content-
      understanding.bicep` gained `judgeModelName`/`judgeModelVersion`/
      `judgeModelCapacity` params and a conditional `judgeModelDeployment`
      resource (created only when the judge model differs from CU's
      `modelName`), giving the judge its own isolated RPM/TPM deployment
      so it can never compete with Content Understanding's deployment for
      capacity — the suspected root cause of earlier intermittent judge
      failures. `JUDGE_MODEL_DEPLOYMENT` default updated to `gpt-5-mini`
      in `app/config.py` and `.env.example`. Deployed through the
      documented `az deployment sub create` mechanism (not a direct `az
      cognitiveservices` CLI call); confirmed `provisioningState:
      Succeeded` with no drift against an earlier one-off manual
      deployment of the same model/SKU/capacity.
- [x] **Wired Foundry agent tracing into Application Insights** (per
      explicit user request: "the foundry isn't yet connected with app
      insights... agent traces should be saved as well"). Added an
      `AppInsights`-category connection at both the Foundry **account**
      and **project** level
      (`accountAppInsightsConnection`/`projectAppInsightsConnection` in
      `infra/modules/content-understanding.bicep`, mirroring Microsoft's
      own `foundry-samples` Bicep pattern), pointed at the same shared
      Application Insights component the api/worker/web tiers already use
      (`modules/log-analytics.bicep`, now exposing an `appInsightsId`
      output). Granted the project's system-assigned identity
      `Log Analytics Reader` + `Privileged Monitoring Data Reader` on that
      Application Insights component (the latter specifically required to
      read GenAI trace *content*, not just metadata) so the Foundry
      portal's **Tracing** view can surface the judge agent's runs. This
      enables zero-code OpenTelemetry tracing for every judge agent call —
      judge traces now land in the same Application Insights instance as
      the rest of the stack's telemetry. Deployed via `az deployment sub
      create`; confirmed live via `az rest` that both
      `clidpprod-foundry-appinsights` and `clidpprod-project-appinsights`
      connections exist. Documented in `TECHNOLOGY.md`'s judge section and
      RBAC Permissions table.
