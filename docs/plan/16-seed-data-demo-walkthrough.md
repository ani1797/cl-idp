# Task 16 — Seed Data & DEMO.md Walkthrough

## Status

Done

## Objective

Provide a one-command seed script that creates representative business
processes and a `DEMO.md` walkthrough, so a new contributor (or a demo
audience) can see the whole system working within minutes without having
to invent test data themselves.

## Spec References

- `docs/spec/TECHNOLOGY.md` — "Seed script + samples" bullet under Local
  Development Environment.
- `docs/spec/DECISIONS.md` — #39.

## Scope

**In scope:**
- `apps/api/scripts/seed.py` (or similar): creates 2-3 example business
  processes (e.g. "Invoice Intake" over `prebuilt-invoice` +
  `prebuilt-receipt`, and a second process over a different analyzer
  combination) via the real API, waits for routing analyzers to become
  `ready`, then triggers a few sample uploads against them using the
  `samples/` documents from task 15a (invoice, receipt, an unrelated
  document to demonstrate the unclassified path) so the seeded system has
  a mix of succeeded/unclassified/needs-review jobs to look at
  immediately.
- Root `DEMO.md`: a step-by-step happy-path walkthrough a human follows
  manually in the browser (distinct from the automated Playwright suite)
  — start services, run seed script, open the web app, walk through
  process-list → process-detail → upload → inference-review → approve →
  process-jobs filtering — with screenshots or described expected UI
  state at each step.
- Idempotency: running the seed script twice either skips existing
  processes (matched by name) or clearly errors rather than creating
  duplicates that violate the uniqueness constraint confusingly.

**Out of scope:** any new product functionality; this task only exercises
what tasks 00-15a already built (note: this task does NOT depend on 15b, the deferred CI-dispatch task, since 15b only concerns proving CI execution, not the samples/ or working system).

## Dependencies

- Task 15a (full system + `samples/` documents must exist and work
  end-to-end).
- Task 17 (UI shell reconciliation) — `DEMO.md`'s described/screenshotted
  UI state should reflect the corrected app shell (sidebar/top bar), not
  task 09's placeholder header, so the walkthrough matches what a reader
  will actually see. This is intentionally the last task.

## Subtasks

1. Write the seed script using the real HTTP API (not direct Cosmos
   writes, so it also serves as a smoke test of the API surface).
2. Handle routing-analyzer-ready polling within the script (reuse the same
   documented interval, no need to over-engineer).
3. Trigger sample uploads and wait for job completion within the script,
   printing a summary at the end (processes created, jobs triggered, any
   violations flagged).
4. Write `DEMO.md` with concrete, followable steps and expected outcomes
   at each step, cross-referencing screen names from `docs/spec/screen/`.
5. Test idempotency: run the script twice, confirm the second run's
   behavior is sensible (skip/clear error, not silent duplication
   or an unhandled 409 crash).

## Acceptance Criteria

- **Given** a freshly started stack (`docker compose up -d` + API + web +
  worker running), **when** `uv run python scripts/seed.py` is executed,
  **then** it completes without error and prints a summary of what it
  created.
- **Given** the seeded system, **when** the web app is opened at `/`,
  **then** at least 2 processes are visible, at least one with a
  `succeeded` job showing outstanding confidence violations and at least
  one `unclassified` job.
- **Given** the seed script is run a second time without any manual
  cleanup, **when** it executes, **then** it does not crash on the `409`
  name collision and clearly reports that the process already exists.
- **Given** `DEMO.md`, **when** followed step-by-step by someone unfamiliar
  with the codebase, **then** they reach the two-pane review screen and
  successfully approve a field, entirely from the written instructions.

## Test Instructions

```bash
docker compose up -d
cd apps/api
uv run uvicorn app.main:app --reload &
uv run python -m app.worker.main &
uv run python scripts/seed.py
```

```bash
cd ../web && npm run dev &
```

Then manually follow `DEMO.md` from the repo root exactly as written,
confirming each described screen state actually matches what appears.

## Definition of Done

- [x] Seed script runs cleanly against a fresh stack and produces a mixed
      set of job outcomes (succeeded-with-violations, unclassified).
- [x] Seed script is safely re-runnable.
- [x] `DEMO.md` walkthrough followed verbatim by a fresh reader reaches
      the review screen and completes an approval.
- [x] This is the final task — after it, the system matches the full
      spec surface in `docs/spec/`.
