# Implementation Plan

This directory breaks the specs in `docs/spec/` into sequenced, independently
reviewable/testable tasks. Each task is one file, numbered in build order.
Read `docs/spec/README.md` first if you haven't — every task below cites the
spec sections it implements and assumes that context.

Granularity is **coarse** (each task is a cohesive vertical slice, roughly
1-3 days of solo work) since this is built by a single implementer/agent at a
time, but tasks are split into a **backend track** and a **frontend track**
that become parallelizable once their shared foundations (00, 01, 02, 09) are
done — pick up both tracks with separate sessions/agents if you ever do have
a second pair of hands.

## Status Legend

Each task file has a `## Status` line: `Not Started` / `In Progress` /
`Blocked` / `Done`. Update it as you go — this is the source of truth for
progress, not this README.

## Sequencing & Dependency Graph

```
00 repo-foundation-devex
 ├─▶ 01 cu-verification-spike (needs real CU credentials)
 │     ├─▶ 01b cu-spec-reconciliation
 │     │     └─▶ 04 backend-cu-provisioning
 │     └─▶ 03 backend-process-crud-analyzers
 │           └─▶ 04 backend-cu-provisioning ◀── needs 01b too
 │                 └─▶ 06 backend-worker-inference-pipeline ◀── needs 05 too
 ├─▶ 02 backend-core-scaffold
 │     ├─▶ 03 backend-process-crud-analyzers
 │     └─▶ 05 backend-trigger-upload-pipeline ◀── needs 03 too (readiness check)
 │           └─▶ 06 backend-worker-inference-pipeline
 │                 ├─▶ 07 backend-jobs-query-api
 │                 │     └─▶ 08 backend-review-retry-api
 │                 └─▶ 14 observability (threads through 03/05/06/08)
 └─▶ 09 frontend-scaffold
       └─▶ 10 frontend-process-list-form ◀── needs 03
             └─▶ 11 frontend-process-detail ◀── needs 04, 05, 06
                   └─▶ 12 frontend-process-jobs ◀── needs 07
                         └─▶ 13 frontend-inference-review ◀── needs 08

15a e2e-live-suite-local ◀── needs 08 (backend complete) and 13 (frontend complete)
 └─▶ 15b ci-dispatch-deferred (BLOCKED — see note below)
17 ui-shell-reconciliation ◀── needs 13 (frontend complete)
 └─▶ 18 verification-remediation ◀── needs 17 too
19 fix-inference-review-document-viewer ◀── needs 13; DEFERRED, do not
                                              auto-dispatch (see note below)
22 fix-pdf-viewer-blob-url-race ◀── needs 13; related to 19, addresses a
                                      specific reported bug (see note below)
16 seed-data-demo-walkthrough ◀── needs 15a AND 17 (demo should show the
                                    corrected UI shell, not the placeholder)

20 custom-analyzer-training-drug-priorauth-group-benefits ◀── needs 01, 01b, 04
 └─▶ 21 drug-priorauth-group-benefits-processes ◀── needs 03-08 too

23 aggregate-confidence-review-gate ◀── needs 06-08; affects 13

24 custom-analyzer-authoring-api ◀── needs 04, 20
 └─▶ 25 custom-analyzer-authoring-ui ◀── needs 13, 17, 24

26 full-stack-containerization ◀── needs 00, 02, 06, 09 (Dockerfiles for
                                     API/worker/web + compose wiring)
```

> **Plan reconciliation note (post-audit, task 19):** the user reported
> directly that the `inference-review` screen's source document viewer
> (PDF/image rendering, built in task 13) is broken in real usage, and
> explicitly asked for a fix to be scheduled for later rather than picked
> up in the current wave. Task **19** captures this — it is a real,
> independent task with its own scope, but is intentionally left
> unscheduled/undispatched until the user gives an explicit go-ahead, the
> same treatment given to `docs/plan/15b-ci-dispatch-deferred.md`. It does
> not block 16/17/18 or anything else in the graph; it is tracked
> separately so it isn't lost. See
> `docs/plan/19-fix-inference-review-document-viewer.md`.

> **Plan addendum (task 22):** the user later reported a concrete,
> reproducible-looking symptom of the same viewer area — an intermittent
> `ResponseException: Unexpected server response (0)` error loading the
> PDF blob URL on `inference-review`, occurring randomly rather than
> consistently — and asked for a task to fix it. Task **22** captures
> this with a specific suspected root cause (an object-URL revocation
> race in `useObjectUrl`) that is more actionable than task 19's general
> investigation scope, and is **not** deferred like 19. See
> `docs/plan/22-fix-pdf-viewer-blob-url-race.md`.

> **Plan reconciliation note (post-audit, tasks 17/18):** after tasks
> 00-15a landed, an audit found (a) several tasks marked `Done` with
> unchecked Definition-of-Done checkboxes — verification steps that were
> never actually performed — and (b) the frontend never replaced task 09's
> placeholder header/nav with the shared app-shell (sidebar + top bar) shown
> in every `docs/assets/references/` mockup. Task **17** builds the real
> shell; task **18** performs the missing verification steps (ideally after
> 17, so manual walkthroughs reflect the corrected UI). Task **16** now also
> depends on **17** so the demo walkthrough documents the real shell, not
> the stub header. See `docs/plan/17-ui-shell-reconciliation.md` and
> `docs/plan/18-verification-remediation.md`.

> **Plan reconciliation note (post-wave, before task 15):** the original
> single "Task 15" required proving the live suite passes via actual
> GitHub Actions execution. When work reached this point, the repo had no
> git history/remote at all. The user was asked and explicitly chose to
> verify everything **locally only**, deferring real CI dispatch
> indefinitely rather than have an agent unilaterally init/push a repo or
> provision credentials as secrets. Task 15 was therefore split into
> **15a** (buildable/verifiable now — Playwright suite, `samples/`, CI
> YAML written but not dispatched) and **15b** (blocked/deferred — actual
> git+GitHub+secrets+dispatch, requires explicit future user go-ahead).
> Task 16 depends only on **15a**, since it only needs the `samples/`
> directory and a working system, not proof of CI execution. See
> `docs/plan/15a-e2e-live-suite-local.md` and
> `docs/plan/15b-ci-dispatch-deferred.md`.

> **Plan addendum (tasks 20/21):** the user asked to train custom
> (schema-based, not prebuilt-wrapping) CU analyzers against the sample
> documents in `samples/drug-prior-authorization/` and
> `samples/group-benefits/`, and use each as the sole allowed analyzer for
> its own business process. Task **20** designs the field schemas and
> provisions/verifies the two custom analyzers directly against CU; task
> **21** creates the two processes and verifies them end-to-end with the
> sample files. Both build entirely on already-`Done` infrastructure
> (01/01b's verified CU mechanics, 03-08's process/provisioning/worker/
> review APIs) and require no application code changes. See
> `docs/plan/20-custom-analyzer-training-drug-priorauth-group-benefits.md`
> and `docs/plan/21-drug-priorauth-group-benefits-processes.md`.

> **Plan addendum (tasks 24/25):** the user asked for new screens letting
> admins **author** custom CU analyzers from the web UI itself — today
> that only happens via `apps/api/scripts/train_custom_analyzers.py` (task
> 20), run by an operator with direct CU credentials. Two new screens were
> spec'd: `docs/spec/screen/custom-analyzers-list.md` (browse/manage,
> designed from scratch, new local mockup at
> `docs/assets/references/custom-analyzers-list.html`/`.png`) and
> `docs/spec/screen/analyzer-training.md` (the three-pane schema authoring/
> testing/publishing workbench, formalizing the user-provided mockup at
> `docs/assets/references/analyzer-training.html`/`.png`, reconciling its
> placeholder pipeline copy with the real CU field-schema contract from
> task 20). `docs/spec/screen/process-form.md` was additively updated to
> note that only `ready` analyzers are ever offered in the picker. Task
> **24** builds the backend control-plane API both screens need (draft
> CRUD, sample management, test-run against a temporary app-owned
> analyzer, publish to a real live analyzer); task **25** builds the two
> screens against it. Stitch (the usual mockup-generation tool) was
> unavailable this session — the new `custom-analyzers-list` mockup was
> hand-authored locally (same Tailwind design tokens/sidebar/header chrome
> as every other reference mockup) instead, per explicit user instruction
> to keep this design pass local. See
> `docs/plan/24-custom-analyzer-authoring-api.md` and
> `docs/plan/25-custom-analyzer-authoring-ui.md`.

> **Plan addendum (task 26):** the user asked to be able to run the whole
> system containerized on their machine. Today's `docker-compose.yml`
> only containerizes the local dependency emulators (Cosmos DB Emulator,
> Azurite, Mailpit) — the API, worker, and web app all run as bare host
> processes. Task **26** adds real Dockerfiles for the API/worker (shared
> image, different `command`) and the web app (production Next.js build),
> and wires them into `docker-compose.yml` behind an opt-in Compose
> profile so the existing emulator-only default workflow used by every
> other task's test instructions is unaffected. It documents (and
> resolves) a confirmed Cosmos-emulator TLS-verification gotcha specific
> to reaching the emulator via its Docker service DNS name instead of
> `localhost`, and requires `CU_API_KEY` for the containerized path since
> `az login`-based credentials aren't available inside a fresh container.
> See `docs/plan/26-full-stack-containerization.md`.

## Parallel Tracks

Once **00**, **01**, and **02** are done, two tracks can proceed
concurrently:

| Track    | Tasks (in order) |
|----------|-------------------|
| Backend  | 03 → 04 → 05 → 06 → 07 → 08 → 14 |
| Frontend | 09 → 10 → 11 → 12 → 13 |

The frontend track only *blocks* on a backend task when it needs that
endpoint to be real (noted per-task as "needs backend stub/real API"); until
then, frontend tasks can build against the hand-written OpenAPI contract
(`docs/spec/api/openapi.yaml`) and a generated TS client with mocked
responses, so frontend work is never fully stalled waiting on backend.

Task **14 (observability)** is written as a cross-cutting checklist applied
incrementally to 03/05/06/08 rather than a big-bang task at the end — see
that file for how to sequence it without blocking the tracks above.

## Task Index

| # | Task | Track | Depends on |
|---|------|-------|------------|
| 00 | [Repo Foundation & Dev Environment](./00-repo-foundation-devex.md) | shared | — |
| 01 | [CU Verification Spike](./01-cu-verification-spike.md) | shared | 00 |
| 01b | [CU Spec Reconciliation](./01b-cu-spec-reconciliation.md) | shared | 01 |
| 02 | [Backend Core Scaffold](./02-backend-core-scaffold.md) | backend | 00 |
| 03 | [Process CRUD & Analyzer Discovery API](./03-backend-process-crud-analyzers.md) | backend | 01, 02 |
| 04 | [CU Routing/Derived Analyzer Provisioning](./04-backend-cu-provisioning.md) | backend | 01, 01b, 03 |
| 05 | [Trigger & Upload Pipeline](./05-backend-trigger-upload-pipeline.md) | backend | 02, 03 |
| 06 | [Worker: Inference Pipeline](./06-backend-worker-inference-pipeline.md) | backend | 01, 04, 05 |
| 07 | [Jobs Query API](./07-backend-jobs-query-api.md) | backend | 06 |
| 08 | [Review & Retry API](./08-backend-review-retry-api.md) | backend | 07 |
| 09 | [Frontend Scaffold](./09-frontend-scaffold.md) | frontend | 00 |
| 10 | [process-list & process-form Screens](./10-frontend-process-list-form.md) | frontend | 03, 09 |
| 11 | [process-detail Screen](./11-frontend-process-detail.md) | frontend | 04, 05, 06, 10 |
| 12 | [process-jobs Screen](./12-frontend-process-jobs.md) | frontend | 07, 11 |
| 13 | [inference-review Screen](./13-frontend-inference-review.md) | frontend | 08, 12 |
| 14 | [Observability Threading](./14-observability.md) | backend | 03, 05, 06, 08 |
| 15a | [Live-CU E2E Suite & CI (Local Verification)](./15a-e2e-live-suite-local.md) | shared | 08, 13 |
| 15b | [Live GitHub Actions CI Dispatch (Deferred)](./15b-ci-dispatch-deferred.md) | shared | 15a — **blocked**, needs explicit future user go-ahead |
| 17 | [UI Shell Reconciliation](./17-ui-shell-reconciliation.md) | frontend | 13 |
| 18 | [Verification Remediation](./18-verification-remediation.md) | shared | 17 |
| 19 | [Fix Inference-Review Document Viewer](./19-fix-inference-review-document-viewer.md) | frontend | 13 — **Done**, resolved by task 22, independently re-verified 2026-09-05 |
| 16 | [Seed Data & DEMO.md](./16-seed-data-demo-walkthrough.md) | shared | 15a, 17 |
| 20 | [Custom Analyzer Training: Drug Prior Auth & Group Benefits](./20-custom-analyzer-training-drug-priorauth-group-benefits.md) | shared | 01, 01b, 04 |
| 21 | [Drug Prior Auth & Group Benefits Processes](./21-drug-priorauth-group-benefits-processes.md) | shared | 03-08, 20 |
| 22 | [Fix PDF Viewer Blob URL Race](./22-fix-pdf-viewer-blob-url-race.md) | frontend | 13; related to 19 |
| 23 | [Aggregate Confidence Review Gate](./23-aggregate-confidence-review-gate.md) | backend/shared | 06-08; affects 13 |
| 24 | [Custom Analyzer Authoring: Backend API](./24-custom-analyzer-authoring-api.md) | backend | 04, 20 |
| 25 | [Custom Analyzer Authoring: Frontend](./25-custom-analyzer-authoring-ui.md) | frontend | 13, 17, 24 |
| 26 | [Full-Stack Containerization](./26-full-stack-containerization.md) | shared | 00, 02, 06, 09 |

## Conventions Used In Every Task File

- **Spec References** — exact files/sections to re-read before starting.
- **Scope** — explicit in/out to prevent overlap with neighboring tasks.
- **Acceptance Criteria** — Given/When/Then, written to be checked by
  someone who did *not* write the code.
- **Test Instructions** — concrete commands to run and what you should
  observe, so completion is demonstrable, not just claimed.
- **Definition of Done** — the checklist gate before marking `Done`.
