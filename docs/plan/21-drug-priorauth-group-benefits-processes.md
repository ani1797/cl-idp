# Task 21 — Drug Prior Auth & Group Benefits Processes

## Status

Done

## Objective

Using the two custom analyzers built in task 20, create **two separate
business processes** in the running app — one restricted to
`drug_prior_auth_glp1`, one restricted to `group_benefits_application` —
and verify each end-to-end: routing-analyzer provisioning, sample upload,
inference, and review, using every file in the corresponding `samples/`
folder.

## Spec References

- `docs/spec/features/onboarding-business-process.md` — process
  create/provisioning flow.
- `docs/spec/screen/process-form.md`, `docs/spec/screen/process-detail.md`
  — how `allowedAnalyzerIds` and routing-analyzer status are surfaced.
- `docs/spec/features/pipeline-trigger-api.md` — upload/trigger contract
  used for sample verification.
- `docs/plan/16-seed-data-demo-walkthrough.md` — reuse the same
  real-HTTP-API-driven-script pattern (not direct DB writes) for creating
  processes and triggering uploads.

## Scope

**In scope:**
- A script (or reuse/extend `apps/api/scripts/seed.py` if that's already
  built — check its status before duplicating logic) that, via the real
  API:
  1. Creates process **"Drug Prior Authorization (GLP-1)"** with
     `allowedAnalyzerIds: ["drug_prior_auth_glp1"]`, a reasonable
     confidence threshold (e.g. 70%), and an owner email.
  2. Creates process **"Group Benefits Application"** with
     `allowedAnalyzerIds: ["group_benefits_application"]`, same threshold
     convention, and an owner email.
  3. Polls both until `routingAnalyzerStatus` is `ready` (or reports
     `failed` clearly — do not hang indefinitely).
  4. Triggers an upload for every file in `samples/drug-prior-authorization/`
     against process 1, and every file in `samples/group-benefits/`
     against process 2, then waits for each job to complete.
  5. Prints a summary: jobs created, final status per job, and any
     confidence violations per job.
- Manually (or via Playwright, if the e2e suite from 15a already exists)
  walking through `process-detail` → `process-jobs` → `inference-review`
  for at least one job per process, confirming: fields render, grounding
  boxes align with the source PDF, and a field can be approved.
- Confirming the group-benefits "issue"/handwritten samples produce
  sensible (imperfect but reviewable) confidence violations rather than
  hard failures — this demonstrates the review workflow, it is not a bug
  to "fix" the OCR accuracy.

**Out of scope:**
- Any change to the routing-analyzer provisioning logic, worker pipeline,
  or review/retry API — this task only exercises what tasks 03-08 already
  built, same framing as task 16.
- Retraining or modifying the custom analyzer schemas (that's task 20;
  come back to it if a schema gap is discovered here, don't quietly patch
  around it in this task).
- CI dispatch (15b) or the broader `DEMO.md` walkthrough (16) — this is
  scoped strictly to these two new processes.

## Dependencies

- Task 20 (both custom analyzer IDs exist and are `ready`).
- Tasks 03-08 (process CRUD, provisioning, trigger/upload pipeline, worker,
  jobs/review APIs — all already `Done`).
- A running stack (`docker compose up -d`, API, worker) — same
  prerequisites as task 16's test instructions.

## Subtasks

1. Check whether `apps/api/scripts/seed.py` (task 16) already exists and
   is generic enough to parameterize with a `(name, analyzerIds, samples
   dir)` list; if so extend it, otherwise write a small standalone script
   under `apps/api/scripts/` to avoid coupling to unrelated seed data.
2. Create both processes via `POST /processes`, capturing the returned
   process IDs.
3. Poll `GET /processes/{processId}` until `routingAnalyzerStatus` settles
   for both.
4. For each sample file, `POST` the trigger/upload endpoint against the
   matching process, collecting job IDs.
5. Poll each job until it reaches a terminal status; print a summary
   table (file, process, job status, `unclassified`, confidence
   violations count).
6. Open the web app and manually verify `process-detail`, `process-jobs`,
   and `inference-review` for at least one job per process.

## Acceptance Criteria

- **Given** a fresh run of the script, **when** it completes, **then**
  both processes exist with `routingAnalyzerStatus: ready` and every
  sample file has a corresponding completed job.
- **Given** the drug-prior-authorization samples, **when** analyzed,
  **then** the succeeded job's `detectedForm` matches
  `drug_prior_auth_glp1` and extracted fields are visible in
  `inference-review`.
- **Given** the group-benefits samples (including "issue"/handwritten
  ones), **when** analyzed, **then** jobs complete as `succeeded` with
  `detectedForm: group_benefits_application`, and any low-confidence
  fields appear as `confidenceViolations` reviewable in the UI rather than
  causing job failure.
- **Given** the web app, **when** a reviewer opens `inference-review` for
  one job per process, **then** they can view the source document,
  compare it against extracted values, and approve a field.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run uvicorn app.main:app --reload &
uv run python -m app.worker.main &
uv run python scripts/seed_custom_analyzer_processes.py   # or extended seed.py
```

```bash
cd ../web && npm run dev &
```

Then open the web app, navigate to each of the two new processes, and
manually confirm `process-jobs` shows the triggered samples and
`inference-review` renders correctly for at least one job per process.

## Definition of Done

- [x] Both processes created and reach `routingAnalyzerStatus: ready`.
- [x] Every file in both `samples/` subfolders triggers a completed job
      against its matching process.
- [x] Manual walkthrough of `inference-review` confirmed for at least one
      job per process, including a successful field approval.
- [x] Script committed under `apps/api/scripts/` and safely re-runnable
      (matches task 16's idempotency bar — a second run does not crash or
      duplicate processes).
