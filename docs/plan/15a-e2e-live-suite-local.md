# Task 15a — Live-CU E2E Suite & CI (Local Verification)

## Status

Done

## ⚠️ Plan Reconciliation Note (post-t14/t13 wave)

This task was split from the original "Task 15 — Live-CU E2E Suite & CI".
When work reached this point, the repo had **no git history at all** (no
`.git`, no remote, nothing pushed to GitHub) — so the original Definition
of Done item "live workflow passes at least once via actual CI execution"
was not achievable without first deciding to initialize/push a real GitHub
repo and provision live-CU secrets there. The user was asked and explicitly
chose **local_only**: build and verify everything locally; defer proof of
actual GitHub Actions execution as a separate, explicitly-deferred task.

See `docs/plan/15b-ci-dispatch-deferred.md` for the deferred remainder.
**This task (15a) covers everything that can be built and verified without
a real pushed repo**, including writing the CI workflow YAML files
themselves (their correctness can be partially checked locally/via
`act`-style tooling or just review, even though they can't be *dispatched*
without a real remote).

## Objective

Build the Playwright end-to-end suite spanning frontend + API against the
real, fully-assembled system, and wire the split CI pipeline: fast
lint/type-check/unit suite on every PR, full live-CU suite (including
Playwright) on `main`/nightly/manual dispatch. Verify everything **locally**
(docker-compose emulators + real CU credentials + `npx playwright test`);
do NOT attempt actual GitHub Actions dispatch (see 15b).

## Spec References

- `docs/spec/TECHNOLOGY.md` — Testing section, CI/CD section.
- `docs/spec/DECISIONS.md` — #30 (live-only testing), #31 (CI split).

## Scope

**In scope:**
- Playwright test suite covering the full happy path end to end:
  1. Create a process with a real analyzer selection.
  2. Wait for `routingAnalyzerStatus: ready` (via UI polling, real
     timing).
  3. Upload a real sample document from `docs/spec/assets` or a new
     `samples/` directory.
  4. Wait for job completion, land on `inference-review`.
  5. Approve a flagged field, edit another, Save.
  6. Navigate to `process-jobs`, filter by `reviewed=true`, confirm the
     job appears.
  7. Upload an unrelated document, confirm the unclassified path.
  8. Force a failure path if feasible (e.g. a corrupt file that passes
     client checks but fails CU) and confirm Retry.
- `.github/workflows/ci.yml` (extends task 00's skeleton): PR-triggered
  job unchanged in spirit but now with real lint/type-check/unit targets
  from every prior task; a **second** workflow or job, triggered on
  `push` to `main`, `schedule` (nightly), and `workflow_dispatch`, that
  runs the full backend `@pytest.mark.live` suite and the Playwright
  suite, using repository secrets for `CU_ENDPOINT`/`CU_API_KEY`.
- Test data/fixtures: at least one invoice-like sample, one receipt-like
  sample, one clearly unrelated document, checked into a `samples/`
  directory (also reused by task 16's seed script and DEMO.md).

**Out of scope:** the seed script / DEMO.md content itself (task 16, which
depends on this task's sample documents existing).

## Dependencies

- Task 08 (full backend feature set complete).
- Task 13 (full frontend feature set complete).

## Subtasks

1. Set up Playwright project (`apps/web` or a top-level `e2e/` package),
   configured to boot both the API and web dev servers (or against
   docker-compose'd real services) for the test run.
2. Write the happy-path spec (steps 1-6 above).
3. Write the unclassified-path spec (step 7).
4. Write the failed/retry-path spec (step 8) — if a genuinely reliable
   failure trigger isn't feasible against live CU, document why and
   substitute an equivalent forced-failure mechanism (e.g. a test-only
   endpoint or env flag) rather than skipping failure coverage entirely.
5. Curate `samples/` documents (checking real-world-safe, non-sensitive
   content only).
6. Split the GitHub Actions workflow into the two triggers described
   above; confirm the PR-triggered job needs zero secrets and the
   main/nightly/dispatch job is the only one referencing repository
   secrets. Write the YAML and review it carefully, but do not attempt to
   dispatch it (no real remote exists yet — see 15b).
7. Run the full suite locally end-to-end (against docker-compose emulators
   + real CU credentials) and record the results as this task's proof of
   correctness, since actual CI dispatch is deferred to 15b.

## Acceptance Criteria

- **Given** a local environment with real CU credentials and docker-compose
  emulators running, **when** the Playwright suite is run locally, **then**
  it provisions, uploads, reviews, and confirms filtering, entirely through
  the UI, and passes.
- **Given** the unclassified-path test, **when** run, **then** it
  confirms the UI shows the "doesn't match any form" explanatory panel,
  not an error.
- **Given** the failed/retry-path test, **when** run, **then** it
  confirms the UI shows the error + Retry action and that Retry produces
  a new visible job.
- **Given** the two-workflow CI YAML, **when** reviewed, **then** the
  PR-triggered job references zero secrets and the main/nightly/dispatch
  job is the only one referencing repository secrets (verified by
  inspection since it cannot be dispatched yet).

## Test Instructions

```bash
# Local run (needs CU credentials + docker-compose emulators up)
docker compose up -d
cd apps/web  # or wherever the e2e project lives
npx playwright test --headed   # watch it run for the first local verification
npx playwright test            # headless, for repeatable runs
```

Actual GitHub Actions dispatch (`gh workflow run live-suite.yml` / `gh run
watch`) is explicitly **out of scope** for this task — see
`docs/plan/15b-ci-dispatch-deferred.md`.

## Definition of Done

- [x] Playwright suite covers happy path, unclassified path, and failed/
      retry path.
- [x] CI workflow YAML written and reviewed (PR job needs zero secrets;
      main/nightly/dispatch job is the only one referencing secrets) —
      NOT dispatched (deferred, see 15b).
- [x] `samples/` directory contains real, reusable test documents free of
      sensitive/real personal data.
- [x] Full Playwright suite run locally at least once against real CU +
      docker-compose emulators, with output captured as evidence.
